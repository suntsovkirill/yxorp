import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import http from 'http';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';

const fixtures = path.resolve(__dirname, 'fixtures');

let target: http.Server;
let targetPort: number;
let yxorp: YxorpInstance;

beforeAll(async () => {
  const targetServer = await startTargetServer();
  target = targetServer.server;
  targetPort = targetServer.port;

  yxorp = await createYxorp({
    target: `http://localhost:${targetPort}`,
    mockRules: [
      { method: 'GET', path: '/inline/json', json: { id: 1, tags: ['a'] }, statusCode: 201, headers: { 'x-mock': 'yes' } },
      { method: 'GET', path: '/inline/body', body: 'plain text ✓' },
      { method: 'GET', path: '/inline/custom-type', body: '<p>hi</p>', headers: { 'content-type': 'text/html' } },
      { method: 'GET', path: '/file/override', file: path.join(fixtures, 'mock-data.json'), headers: { 'content-type': 'text/plain' } },
      { method: 'GET', path: '/slow', json: { slow: true }, delay: 150 },
      { method: 'POST', path: '/script/json', script: path.join(fixtures, 'mock-read-json.js') },
      { method: 'POST', path: '/script/stream', script: path.join(fixtures, 'mock-stream-body.js') },
      { method: 'GET', path: '/script/defaults', script: path.join(fixtures, 'mock-defaults.js'), statusCode: 202, headers: { 'x-mock': 'from-rule' } },
    ],
    rewriteRules: [
      { method: 'GET', path: '/api/user', json: { rewritten: true }, headers: { 'x-rewritten': 'yes' }, statusCode: 203 },
      { method: 'GET', path: '/api/headers', body: 'replaced', headers: { 'x-custom-header': 'from-rule' }, delay: 100 },
    ],
  });
});

afterAll(async () => {
  await yxorp.stop();
  await stopTargetServer(target);
});

describe('Inline mock bodies', () => {
  it('responds with an inline json value, status and headers', async () => {
    const res = await fetchYxorp(yxorp.port, '/inline/json');
    expect(res.statusCode).toBe(201);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['x-mock']).toBe('yes');
    expect(JSON.parse(res.body)).toEqual({ id: 1, tags: ['a'] });
  });

  it('responds with an inline text body', async () => {
    const res = await fetchYxorp(yxorp.port, '/inline/body');
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.body).toBe('plain text ✓');
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength('plain text ✓'));
  });

  it('lets rule headers override the default content type', async () => {
    expect((await fetchYxorp(yxorp.port, '/inline/custom-type')).headers['content-type']).toBe('text/html');
    expect((await fetchYxorp(yxorp.port, '/file/override')).headers['content-type']).toBe('text/plain');
  });
});

describe('delay', () => {
  it('waits before responding to a mocked request', async () => {
    const started = Date.now();
    const res = await fetchYxorp(yxorp.port, '/slow');
    expect(JSON.parse(res.body)).toEqual({ slow: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('waits before sending a rewritten response', async () => {
    const started = Date.now();
    await fetchYxorp(yxorp.port, '/api/headers');
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
  });
});

describe('Mock script request body helpers', () => {
  it('parses the request body with req.json(), readable more than once', async () => {
    const res = await fetchYxorp(yxorp.port, '/script/json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });

    expect(JSON.parse(res.body)).toEqual({ received: { name: 'Alice' }, again: '{"name":"Alice"}' });
  });

  it('still lets a script read the request stream itself', async () => {
    const res = await fetchYxorp(yxorp.port, '/script/stream', { method: 'POST', body: 'raw body' });
    expect(JSON.parse(res.body)).toEqual({ body: 'raw body' });
  });

  it('applies the rule statusCode and headers as defaults the script can override', async () => {
    const defaults = await fetchYxorp(yxorp.port, '/script/defaults');
    expect(defaults.statusCode).toBe(202);
    expect(defaults.headers['x-mock']).toBe('from-rule');

    const overridden = await fetchYxorp(yxorp.port, '/script/defaults?override=1');
    expect(overridden.statusCode).toBe(200);
    expect(overridden.headers['x-mock']).toBe('from-script');
  });
});

describe('Rewrite rule options', () => {
  it('replaces the body with inline json and sets status and headers', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(203);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['x-rewritten']).toBe('yes');
    expect(JSON.parse(res.body)).toEqual({ rewritten: true });
  });

  it('replaces the body with inline text and overrides upstream headers', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/headers');
    expect(res.body).toBe('replaced');
    expect(res.headers['x-custom-header']).toBe('from-rule');
    expect(res.headers['content-type']).toBe('text/plain');
  });
});
