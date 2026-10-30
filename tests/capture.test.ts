import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http, { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import zlib from 'zlib';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, createRecordingLogger, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';
import { CaptureMiddleware, CapturedExchange } from '../src/middleware/capture.middleware';
import { Pipeline } from '../src/services/pipeline.service';

const fixtures = path.resolve(__dirname, 'fixtures');

let target: http.Server;
let yxorp: YxorpInstance;
const exchanges: CapturedExchange[] = [];

/** Waits for the exchange of a request (capture emits it just after the response finishes). */
async function captured(method: string, url: string): Promise<CapturedExchange> {
  for (let i = 0; i < 100; i++) {
    const found = exchanges.find(e => e.request.method === method && e.request.url === url);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`No exchange captured for ${method} ${url}`);
}

beforeAll(async () => {
  const targetServer = await startTargetServer({
    '/gzip': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync(JSON.stringify({ zipped: true })));
    },
  });
  target = targetServer.server;

  yxorp = await createYxorp({
    target: `http://localhost:${targetServer.port}`,
    staticRules: [{ path: '/static', directory: fixtures }],
    mockRules: [
      { method: 'GET', path: '/mocked', json: { mocked: true }, headers: { 'x-mock': '1' } },
      { method: 'POST', path: '/mocked-script', script: path.join(fixtures, 'mock-read-json.js') },
    ],
    rewriteRules: [{ method: 'GET', path: '/api/items', json: ['rewritten'] }],
  }, { capture: [(exchange) => { exchanges.push(exchange); }] });
});

afterAll(async () => {
  await yxorp.stop();
  await stopTargetServer(target);
});

describe('traffic capture', () => {
  it('captures a proxied request and response, bodies included', async () => {
    await fetchYxorp(yxorp.port, '/api/echo?x=1', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello' });
    const exchange = await captured('POST', '/api/echo?x=1');

    expect(exchange.handledBy).toBe('stream');
    expect(exchange.secure).toBe(false);
    expect(exchange.request.headers['content-type']).toBe('text/plain');
    expect(exchange.request.body.data.toString()).toBe('hello');
    expect(exchange.response.statusCode).toBe(200);
    expect(exchange.response.headers['x-echo-method']).toBe('POST');
    expect(JSON.parse(exchange.response.body.data.toString())).toMatchObject({ method: 'POST', body: 'hello' });
    expect(exchange.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps an encoded response body as sent', async () => {
    await fetchYxorp(yxorp.port, '/gzip');
    const exchange = await captured('GET', '/gzip');

    expect(exchange.response.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(zlib.gunzipSync(exchange.response.body.data).toString())).toEqual({ zipped: true });
  });

  it('labels mocked, rewritten and static responses', async () => {
    await fetchYxorp(yxorp.port, '/mocked');
    await fetchYxorp(yxorp.port, '/api/items');
    await fetchYxorp(yxorp.port, '/static/hello.html');

    const mocked = await captured('GET', '/mocked');
    expect(mocked.handledBy).toBe('mock');
    expect(mocked.response.headers['x-mock']).toBe('1');
    expect(JSON.parse(mocked.response.body.data.toString())).toEqual({ mocked: true });

    expect((await captured('GET', '/api/items')).handledBy).toBe('rewrite');
    expect((await captured('GET', '/static/hello.html')).handledBy).toBe('static');
  });

  it('captures a request body read by a mock script', async () => {
    await fetchYxorp(yxorp.port, '/mocked-script', { method: 'POST', body: '{"a":1}' });
    const exchange = await captured('POST', '/mocked-script');
    expect(exchange.request.body.data.toString()).toBe('{"a":1}');
  });
});

describe('CaptureMiddleware', () => {
  let server: http.Server;
  let port: number;
  const seen: CapturedExchange[] = [];

  beforeAll(async () => {
    const pipeline = new Pipeline<[IncomingMessage, ServerResponse]>();
    pipeline.use(
      new CaptureMiddleware([(exchange) => { seen.push(exchange); }], createRecordingLogger().logger, 8),
      {
        use: (_req, res) => {
          res.writeHead(201, ['X-Flat', 'flat-value']);
          res.write('0123');
          res.end('456789', 'utf-8');
        },
      },
    );

    server = http.createServer((req, res) => { void pipeline.execute(req, res); });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('truncates bodies over the limit and records writeHead headers', async () => {
    const res = await fetchYxorp(port, '/');
    expect(res.body).toBe('0123456789');

    for (let i = 0; i < 100 && !seen.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    expect(seen[0].response.statusCode).toBe(201);
    expect(seen[0].response.headers['x-flat']).toBe('flat-value');
    expect(seen[0].response.body).toEqual({ data: Buffer.from('01234567'), truncated: true });
  });
});
