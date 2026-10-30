import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createRecordingLogger, createYxorp, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';
import { escapePathPattern, Recorder } from '../src/services/recorder';
import { matchPath } from '../src/utils/path-pattern';

let target: http.Server;
let yxorp: YxorpInstance;
let recordDir: string;

const readRules = () => JSON.parse(fs.readFileSync(path.join(recordDir, 'recorded.json'), 'utf-8')).mockRules;

beforeAll(async () => {
  const targetServer = await startTargetServer({
    '/api/list': (req, res) => {
      const page = new URL(req.url!, 'http://x').searchParams.get('page') || 'none';
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync(JSON.stringify({ page })));
    },
    '/api/v1:batch': (_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    },
    '/api/odd': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-custom' });
      res.end('custom');
    },
    '/api/events': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: hi\n\n');
    },
  });
  target = targetServer.server;

  recordDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-record-'));
  // Config dir = cwd, so recorded `file` paths resolve the same way when replayed below.
  const recorder = new Recorder(recordDir, process.cwd(), createRecordingLogger().logger);

  yxorp = await createYxorp({
    target: `http://localhost:${targetServer.port}`,
    mockRules: [{ method: 'GET', path: '/mocked', json: {} }],
  }, { capture: [recorder.record] });

  for (const url of ['/api/list', '/api/list?page=2', '/api/user', '/api/v1:batch', '/api/odd', '/api/events', '/mocked']) {
    await fetchYxorp(yxorp.port, url);
  }
  await fetchYxorp(yxorp.port, '/api/echo', { method: 'OPTIONS' });
  await new Promise(resolve => setTimeout(resolve, 200));
});

afterAll(async () => {
  await yxorp.stop();
  await stopTargetServer(target);
  fs.rmSync(recordDir, { recursive: true, force: true });
});

describe('Recorder', () => {
  it('writes a rule per recorded request, conditional rules first', () => {
    const rules = readRules();
    expect(rules.map((r: any) => [r.method, r.path, r.match])).toEqual([
      ['GET', '/api/list', { query: { page: '2' } }],
      ['GET', '/api/list', undefined],
      ['GET', '/api/user', undefined],
      ['GET', '/api/v1\\:batch', undefined],
      ['GET', '/api/odd', undefined],
    ]);
  });

  it('saves decoded bodies and keeps non-200 status codes and unusual content types', () => {
    const rules = readRules();
    const list = rules.find((r: any) => r.path === '/api/list' && !r.match);
    expect(list.file).toMatch(/GET_api_list\.json$/);
    expect(JSON.parse(fs.readFileSync(path.resolve(list.file), 'utf-8'))).toEqual({ page: 'none' });
    expect(list.headers).toBeUndefined();

    const batch = rules.find((r: any) => r.path === '/api/v1\\:batch');
    expect(batch.statusCode).toBe(404);

    const odd = rules.find((r: any) => r.path === '/api/odd');
    expect(odd.file).toMatch(/\.bin$/);
    expect(odd.headers).toEqual({ 'content-type': 'application/x-custom' });
  });

  it('replays the recorded responses without the target', async () => {
    const replay = await createYxorp({ target: 'http://127.0.0.1:1', mockRules: readRules() });

    try {
      expect(JSON.parse((await fetchYxorp(replay.port, '/api/list?page=2')).body)).toEqual({ page: '2' });
      expect(JSON.parse((await fetchYxorp(replay.port, '/api/list')).body)).toEqual({ page: 'none' });
      expect(JSON.parse((await fetchYxorp(replay.port, '/api/user')).body)).toEqual({ id: 1, name: 'Alice' });

      const batch = await fetchYxorp(replay.port, '/api/v1:batch');
      expect(batch.statusCode).toBe(404);
      expect(batch.body).toBe('nope');

      const odd = await fetchYxorp(replay.port, '/api/odd');
      expect(odd.headers['content-type']).toBe('application/x-custom');
    } finally {
      await replay.stop();
    }
  });

  it('keeps earlier recordings when a new recorder starts on the same directory', async () => {
    const restarted = new Recorder(recordDir, process.cwd(), createRecordingLogger().logger);

    await restarted.record({
      startedAt: new Date(),
      durationMs: 1,
      secure: false,
      handledBy: 'proxy',
      request: { method: 'GET', url: '/api/new', httpVersion: '1.1', headers: {}, body: { data: Buffer.alloc(0), truncated: false } },
      response: {
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': 'text/plain' },
        body: { data: Buffer.from('new'), truncated: false },
      },
    });

    const rules = readRules();
    expect(rules).toHaveLength(6);
    expect(rules.at(-1)).toMatchObject({ method: 'GET', path: '/api/new' });
  });
});

describe('escapePathPattern', () => {
  it('makes reserved characters match literally', () => {
    for (const pathname of ['/api/v1:batch', '/a(b)/c*', '/x+y', '/q?', '/{id}', '/a!b']) {
      expect(matchPath(escapePathPattern(pathname), pathname)).toBeDefined();
    }
  });
});
