import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, fetchYxorp } from './helpers/create-yxorp';
import http from 'http';

let target: http.Server;
let targetPort: number;
let yxorp: { port: number; stop: () => Promise<void> };

beforeAll(async () => {
  const targetServer = await startTargetServer();
  target = targetServer.server;
  targetPort = targetServer.port;

  yxorp = await createYxorp({
    target: `http://localhost:${targetPort}`,
  });
});

afterAll(async () => {
  await yxorp.stop();
  await stopTargetServer(target);
});

describe('Basic proxy', () => {
  it('proxies GET requests to target', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toEqual({ id: 1, name: 'Alice' });
  });

  it('proxies GET with unknown path', async () => {
    const res = await fetchYxorp(yxorp.port, '/some/random/path');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('target: /some/random/path');
  });

  it('proxies POST with body', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.method).toBe('POST');
    expect(JSON.parse(data.body)).toEqual({ hello: 'world' });
  });

  it('proxies error status codes', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/status-error');
    expect(res.statusCode).toBe(404);
    const data = JSON.parse(res.body);
    expect(data.error).toBe('not found');
  });

  it('preserves response headers', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/headers');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-custom-header']).toBe('from-target');
  });
});

describe('Unreachable target', () => {
  let unreachableYxorp: { port: number; stop: () => Promise<void> };

  beforeAll(async () => {
    // Nothing listens on this port — connection attempts fail with ECONNREFUSED.
    unreachableYxorp = await createYxorp({ target: 'http://127.0.0.1:1' });
  });

  afterAll(async () => {
    await unreachableYxorp.stop();
  });

  it('responds with 502 instead of hanging', async () => {
    const res = await fetchYxorp(unreachableYxorp.port, '/anything');
    expect(res.statusCode).toBe(502);
  });
});
