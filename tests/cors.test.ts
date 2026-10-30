import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createYxorp, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';

const ORIGIN = 'http://localhost:5173';

let target: http.Server;
let targetPort: number;
let preflightsSeenByTarget = 0;

beforeAll(async () => {
  // A target with production-only CORS headers, which a localhost frontend can't use.
  target = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') preflightsSeenByTarget++;
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': 'https://prod.example.com',
      vary: 'Accept-Encoding',
    });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => target.listen(0, resolve));
  targetPort = (target.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => target.close(() => resolve()));
});

describe('cors: true', () => {
  let yxorp: YxorpInstance;

  beforeAll(async () => {
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      cors: true,
      mockRules: [{ method: 'GET', path: '/mocked', json: { mocked: true } }],
    });
  });

  afterAll(async () => {
    await yxorp.stop();
  });

  it('answers a preflight itself, allowing what the browser asks for', async () => {
    const before = preflightsSeenByTarget;
    const res = await fetchYxorp(yxorp.port, '/api/items', {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type, x-token',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toBe('PUT');
    expect(res.headers['access-control-allow-headers']).toBe('content-type, x-token');
    expect(res.headers['access-control-max-age']).toBe('600');
    expect(preflightsSeenByTarget).toBe(before);
  });

  it('overrides the target CORS headers on proxied responses and merges Vary', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/items', { headers: { origin: ORIGIN } });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers.vary).toBe('Origin, Accept-Encoding');
  });

  it('adds CORS headers to mocked responses', async () => {
    const res = await fetchYxorp(yxorp.port, '/mocked', { headers: { origin: ORIGIN } });
    expect(JSON.parse(res.body)).toEqual({ mocked: true });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('leaves requests without an Origin untouched', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/items');
    expect(res.headers['access-control-allow-origin']).toBe('https://prod.example.com');
  });

  it('passes a plain OPTIONS request (not a preflight) through to the target', async () => {
    const before = preflightsSeenByTarget;
    await fetchYxorp(yxorp.port, '/api/items', { method: 'OPTIONS', headers: { origin: ORIGIN } });
    expect(preflightsSeenByTarget).toBe(before + 1);
  });
});

describe('cors options', () => {
  let yxorp: YxorpInstance;

  beforeAll(async () => {
    yxorp = await createYxorp({
      target: 'http://127.0.0.1:1',
      cors: { origin: [ORIGIN], credentials: false, maxAge: 60, exposeHeaders: ['x-total-count'] },
    });
  });

  afterAll(async () => {
    await yxorp.stop();
  });

  it('applies credentials, maxAge and exposeHeaders', async () => {
    const res = await fetchYxorp(yxorp.port, '/x', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'GET' },
    });

    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['access-control-max-age']).toBe('60');
    expect(res.headers['access-control-expose-headers']).toBe('x-total-count');
  });

  it('adds CORS headers to error responses so the page can read them', async () => {
    const res = await fetchYxorp(yxorp.port, '/x', { headers: { origin: ORIGIN } });
    expect(res.statusCode).toBe(502);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('ignores origins that are not allowed', async () => {
    const res = await fetchYxorp(yxorp.port, '/x', {
      method: 'OPTIONS',
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'GET' },
    });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.statusCode).toBe(502);
  });
});
