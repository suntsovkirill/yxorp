import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';
import { HarWriter } from '../src/services/har-writer';

let target: http.Server;
let yxorp: YxorpInstance;
let harPath: string;
let harWriter: HarWriter;

beforeAll(async () => {
  const targetServer = await startTargetServer({
    '/gzip': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync(JSON.stringify({ zipped: true })));
    },
    '/binary': (_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    },
  });
  target = targetServer.server;

  // A directory that doesn't exist yet — HarWriter creates it.
  harPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-har-')), 'out', 'traffic.har');
  harWriter = new HarWriter(harPath, '9.9.9');

  yxorp = await createYxorp({
    target: `http://localhost:${targetServer.port}`,
    mockRules: [{ method: 'GET', path: '/mocked', json: { mocked: true } }],
  }, { capture: [harWriter.add] });

  await fetchYxorp(yxorp.port, '/api/echo?q=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  await fetchYxorp(yxorp.port, '/gzip');
  await fetchYxorp(yxorp.port, '/binary');
  await fetchYxorp(yxorp.port, '/mocked');
  await new Promise(resolve => setTimeout(resolve, 100));
  harWriter.flush();
});

afterAll(async () => {
  await yxorp.stop();
  await stopTargetServer(target);
  fs.rmSync(path.dirname(path.dirname(harPath)), { recursive: true, force: true });
});

describe('HarWriter', () => {
  const read = () => JSON.parse(fs.readFileSync(harPath, 'utf-8'));
  const entry = (url: string) => read().log.entries.find((e: any) => new URL(e.request.url).pathname === url);

  it('writes a HAR 1.2 document', () => {
    const har = read();
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator).toEqual({ name: 'yxorp', version: '9.9.9' });
    expect(har.log.entries).toHaveLength(4);
  });

  it('records the request with its query string and body', () => {
    const { request, response, _handledBy } = entry('/api/echo');
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`http://localhost:${yxorp.port}/api/echo?q=1`);
    expect(request.queryString).toEqual([{ name: 'q', value: '1' }]);
    expect(request.postData).toEqual({ mimeType: 'application/json', text: '{"a":1}' });
    expect(response.status).toBe(200);
    expect(response.headers).toContainEqual({ name: 'x-echo-method', value: 'POST' });
    expect(_handledBy).toBe('stream');
  });

  it('stores response bodies decoded', () => {
    const { response } = entry('/gzip');
    expect(JSON.parse(response.content.text)).toEqual({ zipped: true });
    expect(response.content.encoding).toBeUndefined();
  });

  it('stores binary bodies as base64', () => {
    const { response } = entry('/binary');
    expect(response.content).toMatchObject({ mimeType: 'image/png', encoding: 'base64', text: 'iVBORw==' });
  });

  it('includes mocked responses, labelled', () => {
    const mocked = entry('/mocked');
    expect(mocked._handledBy).toBe('mock');
    expect(JSON.parse(mocked.response.content.text)).toEqual({ mocked: true });
  });
});
