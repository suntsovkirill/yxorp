import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createYxorp, fetchYxorp } from './helpers/create-yxorp';

describe('proxyHeaders', () => {
  let target: http.Server;
  let targetPort: number;
  let receivedHeaders: Record<string, string>;

  beforeAll(async () => {
    // Target that records request headers
    target = http.createServer((req, res) => {
      receivedHeaders = {};
      for (const [key, val] of Object.entries(req.headers)) {
        receivedHeaders[key] = String(val);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => target.listen(0, resolve));
    const addr = target.address() as any;
    targetPort = addr.port;
  });

  afterAll(async () => {
    target.close();
  });

  it('sends custom headers to target', async () => {
    const yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      proxyHeaders: {
        'user-agent': 'MyCustomAgent/1.0',
        'x-api-key': 'secret-123',
      },
    });

    try {
      await fetchYxorp(yxorp.port, '/api/test');
      expect(receivedHeaders['user-agent']).toBe('MyCustomAgent/1.0');
      expect(receivedHeaders['x-api-key']).toBe('secret-123');
    } finally {
      await yxorp.stop();
    }
  });

  it('does not send custom headers when proxyHeaders is not set', async () => {
    const yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
    });

    try {
      await fetchYxorp(yxorp.port, '/api/test');
      expect(receivedHeaders['x-api-key']).toBeUndefined();
    } finally {
      await yxorp.stop();
    }
  });
});

describe('Hop-by-hop response headers', () => {
  let target: http.Server;
  let targetPort: number;

  beforeAll(async () => {
    // Target that responds with hop-by-hop headers, plus a custom header
    // dynamically named in the `Connection` header value.
    target = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'connection': 'close, X-Removed-By-Connection',
        'keep-alive': 'timeout=999',
        'x-removed-by-connection': 'should-not-appear',
        'x-keep': 'should-pass-through',
      });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => target.listen(0, resolve));
    const addr = target.address() as any;
    targetPort = addr.port;
  });

  afterAll(async () => {
    target.close();
  });

  it('strips hop-by-hop headers and headers named in Connection', async () => {
    const yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
    });

    try {
      const res = await fetchYxorp(yxorp.port, '/api/test');
      // yxorp's own server may emit its own Connection/Keep-Alive headers —
      // what matters is the *target's* hop-by-hop values aren't forwarded.
      expect(res.headers['keep-alive']).not.toBe('timeout=999');
      expect(res.headers['x-removed-by-connection']).toBeUndefined();
      expect(res.headers['x-keep']).toBe('should-pass-through');
    } finally {
      await yxorp.stop();
    }
  });
});
