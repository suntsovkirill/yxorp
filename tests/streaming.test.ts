import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import http from 'http';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, fetchYxorp } from './helpers/create-yxorp';

const fixtures = path.resolve(__dirname, 'fixtures');

describe('Streaming pass-through', () => {
  it('streams chunks incrementally instead of buffering the whole body', async () => {
    // The target sends its second chunk only AFTER the client confirms receipt
    // of the first. If yxorp buffered the body, the client would not see the
    // first chunk until the upstream ended — so this latch would never release
    // and the test would time out. Completing at all proves it streams.
    let confirmFirstChunk!: () => void;
    const firstChunkSeen = new Promise<void>((resolve) => { confirmFirstChunk = resolve; });

    const target = await startTargetServer({
      '/sse': (_req, res) => {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write('data: first\n\n');
        firstChunkSeen.then(() => {
          res.write('data: second\n\n');
          res.end();
        });
      },
    });
    const yxorp = await createYxorp({ target: `http://localhost:${target.port}` });

    try {
      const chunks: string[] = [];
      let headers: http.IncomingHttpHeaders = {};

      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          { hostname: 'localhost', port: yxorp.port, path: '/sse' },
          (res) => {
            headers = res.headers;
            expect(res.statusCode).toBe(200);
            res.on('data', (chunk) => {
              chunks.push(chunk.toString());
              if (chunks.length === 1) confirmFirstChunk();
            });
            res.on('end', () => resolve());
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end();
      });

      expect(chunks[0]).toContain('first');
      expect(chunks.join('')).toContain('second');
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // The SSE content-type is forwarded verbatim, so a client can tell the
      // response is a stream.
      expect(headers['content-type']).toContain('text/event-stream');
      // A streamed response of unknown length is framed with chunked
      // transfer-encoding and carries no synthetic content-length.
      expect(headers['transfer-encoding']).toBe('chunked');
      expect(headers['content-length']).toBeUndefined();
    } finally {
      await yxorp.stop();
      await stopTargetServer(target.server);
    }
  }, 10000);
});

describe('Rewrite still buffers', () => {
  let target: http.Server;
  let targetPort: number;
  let yxorp: { port: number; stop: () => Promise<void> };

  beforeAll(async () => {
    const targetServer = await startTargetServer();
    target = targetServer.server;
    targetPort = targetServer.port;
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      rewriteRules: [
        { method: 'GET', path: '/api/user', file: path.join(fixtures, 'mock-data.json'), statusCode: 200 },
      ],
    });
  });

  afterAll(async () => {
    if (yxorp) await yxorp.stop();
    await stopTargetServer(target);
  });

  it('buffers and sets content-length when a rewrite rule matches', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(200);
    // Rewritten responses take the buffering path, which reconstructs the body
    // with a known length — so content-length is present, unlike streamed ones.
    expect(res.headers['content-length']).toBeDefined();
    const data = JSON.parse(res.body);
    expect(data).toEqual({ mocked: true, source: 'file', value: 42 });
  });
});
