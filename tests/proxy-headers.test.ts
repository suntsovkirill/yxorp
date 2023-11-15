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
