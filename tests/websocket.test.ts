import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { Duplex } from 'stream';
import { createYxorp, createRecordingLogger, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';

/**
 * Sends a WebSocket upgrade request (without a WS client library — only the
 * HTTP handshake matters here) and resolves with what happened to it.
 */
function upgrade(port: number, path: string): Promise<
  | { kind: 'upgraded'; socket: Duplex }
  | { kind: 'response'; statusCode: number }
  | { kind: 'closed' }
> {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });

    req.on('upgrade', (_res, socket) => resolve({ kind: 'upgraded', socket }));
    req.on('response', (res) => {
      res.resume();
      resolve({ kind: 'response', statusCode: res.statusCode as number });
    });
    req.on('error', () => resolve({ kind: 'closed' }));
    req.on('close', () => resolve({ kind: 'closed' }));
    req.end();
  });
}

function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for condition'));
      setTimeout(check, 10);
    };
    check();
  });
}

describe('WebSocket proxying', () => {
  let target: http.Server;
  let targetPort: number;

  beforeAll(async () => {
    // Echo server: completes the upgrade handshake and echoes data back.
    target = http.createServer((_req, res) => res.end('not a websocket'));
    target.on('upgrade', (req, socket) => {
      if (req.url === '/refuse') {
        socket.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n');
        return;
      }

      socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n');
      socket.on('data', (chunk) => socket.write(chunk));
      socket.on('end', () => socket.end());
    });

    await new Promise<void>((resolve) => target.listen(0, resolve));
    targetPort = (target.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  describe('reachable target', () => {
    let yxorp: YxorpInstance;
    const { logger, messages } = createRecordingLogger();

    beforeAll(async () => {
      yxorp = await createYxorp({ target: `http://localhost:${targetPort}` }, { logger });
    });

    afterAll(async () => {
      await yxorp.stop();
    });

    it('proxies the upgrade and data in both directions', async () => {
      const result = await upgrade(yxorp.port, '/chat');
      expect(result.kind).toBe('upgraded');
      if (result.kind !== 'upgraded') return;

      const echoed = new Promise<string>((resolve) => result.socket.once('data', (chunk) => resolve(chunk.toString())));
      result.socket.write('ping');
      expect(await echoed).toBe('ping');

      result.socket.destroy();
    });

    it('writes one access-log line with status 101 when the connection ends', async () => {
      await waitFor(() => messages.some(m => m.message.startsWith('ws ')));

      const lines = messages.filter(m => m.message.startsWith('ws '));
      expect(lines).toHaveLength(1);
      expect(lines[0].message).toMatch(/^ws\s+101 GET \/chat \d+ms$/);
    });

    it('logs the upstream status for a refused upgrade', async () => {
      const result = await upgrade(yxorp.port, '/refuse');
      expect(result).toEqual({ kind: 'response', statusCode: 403 });

      await waitFor(() => messages.some(m => /^ws\s+403 GET \/refuse/.test(m.message)));
    });
  });

  describe('unreachable target', () => {
    let yxorp: YxorpInstance;
    const { logger, messages } = createRecordingLogger();

    beforeAll(async () => {
      // Nothing listens on this port — the upstream connection fails with ECONNREFUSED.
      yxorp = await createYxorp({ target: 'http://127.0.0.1:1' }, { logger });
    });

    afterAll(async () => {
      await yxorp.stop();
    });

    it('closes the client socket instead of leaving it open', async () => {
      expect(await upgrade(yxorp.port, '/chat')).toEqual({ kind: 'closed' });
    });

    it('logs the error and an access-log line', async () => {
      await waitFor(() => messages.some(m => /^ws\s+502 GET \/chat/.test(m.message)));
      expect(messages.some(m => m.level === 'error' && m.message.includes('ECONNREFUSED'))).toBe(true);
    });
  });

  describe('invalid target', () => {
    let yxorp: YxorpInstance;
    const { logger, messages } = createRecordingLogger();

    beforeAll(async () => {
      // httpxy throws synchronously on a target that isn't a URL — inside the
      // 'upgrade' listener that used to be an uncaught exception.
      yxorp = await createYxorp({ target: 'not a url' }, { logger });
    });

    afterAll(async () => {
      await yxorp.stop();
    });

    it('closes the client socket and keeps the server running', async () => {
      expect(await upgrade(yxorp.port, '/chat')).toEqual({ kind: 'closed' });
      expect(messages.some(m => m.level === 'error')).toBe(true);

      const res = await fetchYxorp(yxorp.port, '/still-alive');
      expect(res.statusCode).toBe(502);
    });
  });
});
