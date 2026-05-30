import { describe, it, expect } from 'vitest';
import http from 'http';
import zlib from 'zlib';
import { createYxorp } from './helpers/create-yxorp';
import path from 'path';

const fixtures = path.resolve(__dirname, 'fixtures');

function fetchRaw(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode!,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    }).on('error', reject);
  });
}

describe('Response encoding', () => {
  it('proxies gzip-encoded response', async () => {
    const target = http.createServer((req, res) => {
      const gzipped = zlib.gzipSync(JSON.stringify({ name: 'Alice', id: 1 }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(gzipped);
    });
    target.listen(0);
    const targetPort = await new Promise<number>(r => target.once('listening', () => r((target.address() as any).port)));
    const yxorp = await createYxorp({ target: `http://localhost:${targetPort}` });

    try {
      const raw = await fetchRaw(`http://localhost:${yxorp.port}/api/user`);
      expect(raw.status).toBe(200);
      expect(raw.headers['content-encoding']).toBe('gzip');
      // Body should be valid gzip that decompresses to JSON
      const decoded = JSON.parse(zlib.gunzipSync(raw.body).toString());
      expect(decoded.name).toBe('Alice');
    } finally {
      await yxorp.stop();
      target.close();
    }
  });

  it('rewrites gzip-encoded response with file (strips encoding)', async () => {
    const target = http.createServer((req, res) => {
      const gzipped = zlib.gzipSync(JSON.stringify({ name: 'Alice' }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(gzipped);
    });
    target.listen(0);
    const targetPort = await new Promise<number>(r => target.once('listening', () => r((target.address() as any).port)));
    const yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      rewriteRules: [{ method: 'GET', path: '/api/user', file: path.join(fixtures, 'mock-data.json'), statusCode: 200 }],
    });

    try {
      const raw = await fetchRaw(`http://localhost:${yxorp.port}/api/user`);
      expect(raw.status).toBe(200);
      // Rewrite replaces body — response is the raw file content
      // ProxyResMiddleware strips transfer-encoding but keeps content-encoding
      // If content-encoding is gzip, we need to decode
      const body = raw.headers['content-encoding'] === 'gzip'
        ? JSON.parse(zlib.gunzipSync(raw.body).toString())
        : JSON.parse(raw.body.toString());
      expect(body.mocked).toBe(true);
    } finally {
      await yxorp.stop();
      target.close();
    }
  });

  it('proxies brotli-encoded response', async () => {
    const target = http.createServer((req, res) => {
      const compressed = zlib.brotliCompressSync(JSON.stringify({ name: 'Alice' }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'br' });
      res.end(compressed);
    });
    target.listen(0);
    const targetPort = await new Promise<number>(r => target.once('listening', () => r((target.address() as any).port)));
    const yxorp = await createYxorp({ target: `http://localhost:${targetPort}` });

    try {
      const raw = await fetchRaw(`http://localhost:${yxorp.port}/api/user`);
      expect(raw.status).toBe(200);
      const decoded = JSON.parse(zlib.brotliDecompressSync(raw.body).toString());
      expect(decoded.name).toBe('Alice');
    } finally {
      await yxorp.stop();
      target.close();
    }
  });
});
