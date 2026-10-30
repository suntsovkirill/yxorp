import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import { createRecordingLogger, createYxorp, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';
import { matchesPartially } from '../src/services/rules-matchers/method-path-rules-matcher';

const fixtures = path.resolve(__dirname, 'fixtures');

let target: http.Server;
let targetUrl: string;

/** Echoes what the target received: method, url, headers, body. */
beforeAll(async () => {
  target = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
    });
  });
  await new Promise<void>((resolve) => target.listen(0, resolve));
  targetUrl = `http://localhost:${(target.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => target.close(() => resolve()));
});

describe('requestRules', () => {
  let yxorp: YxorpInstance;
  const { logger, messages } = createRecordingLogger();

  beforeAll(async () => {
    yxorp = await createYxorp({
      target: targetUrl,
      requestRules: [
        { method: 'GET', path: '/api/users', headers: { authorization: 'Bearer test-token', cookie: null }, query: { debug: '1', tracking: null } },
        { method: 'POST', path: '/api/orders', json: { replaced: true } },
        { method: 'PUT', path: '/api/text', body: 'plain' },
      ],
    }, { logger });
  });

  afterAll(async () => {
    await yxorp.stop();
  });

  it('sets and removes headers and query params', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/users?tracking=abc&page=2', { headers: { cookie: 'session=1', 'x-keep': 'yes' } });
    const received = JSON.parse(res.body);

    expect(received.url).toBe('/api/users?page=2&debug=1');
    expect(received.headers.authorization).toBe('Bearer test-token');
    expect(received.headers.cookie).toBeUndefined();
    expect(received.headers['x-keep']).toBe('yes');
  });

  it('logs the URL the client requested', async () => {
    messages.length = 0;
    await fetchYxorp(yxorp.port, '/api/users?tracking=abc');
    expect(messages.some(m => /GET \/api\/users\?tracking=abc /.test(m.message))).toBe(true);
  });

  it('replaces the body with json, fixing content-type and content-length', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/orders', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'original body' });
    const received = JSON.parse(res.body);

    expect(received.body).toBe('{"replaced":true}');
    expect(received.headers['content-type']).toBe('application/json');
    expect(received.headers['content-length']).toBe(String('{"replaced":true}'.length));
  });

  it('replaces the body with text', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/text', { method: 'PUT', body: 'original' });
    expect(JSON.parse(res.body).body).toBe('plain');
  });

  it('leaves other requests alone', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/other?tracking=abc', { method: 'POST', body: 'untouched' });
    const received = JSON.parse(res.body);
    expect(received.url).toBe('/api/other?tracking=abc');
    expect(received.body).toBe('untouched');
  });
});

describe('match.body', () => {
  let yxorp: YxorpInstance;

  const graphql = (operationName: string, variables: object = {}) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' } as Record<string, string>,
    body: JSON.stringify({ operationName, query: `query ${operationName} { x }`, variables }),
  });

  beforeAll(async () => {
    yxorp = await createYxorp({
      target: targetUrl,
      mockRules: [
        { method: 'POST', path: '/graphql', match: { body: { operationName: 'GetUser', variables: { id: '1' } } }, json: { data: { user: 'first' } } },
        { method: 'POST', path: '/graphql', match: { body: { operationName: 'GetUser' } }, json: { data: { user: 'any' } } },
        { method: 'POST', path: '/echo-json', match: { body: { echo: true } }, script: path.join(fixtures, 'mock-read-json.js') },
      ],
      requestRules: [
        { method: 'POST', path: '/graphql', match: { body: { operationName: 'Tagged' } }, headers: { 'x-tagged': 'yes' } },
      ],
    });
  });

  afterAll(async () => {
    await yxorp.stop();
  });

  it('picks mock rules by fields of the JSON body, nested ones included', async () => {
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/graphql', graphql('GetUser', { id: '1' }))).body)).toEqual({ data: { user: 'first' } });
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/graphql', graphql('GetUser', { id: '2' }))).body)).toEqual({ data: { user: 'any' } });
  });

  it('still proxies the full original body when no rule matches', async () => {
    const request = graphql('GetPosts');
    request.headers['content-length'] = String(Buffer.byteLength(request.body));
    const received = JSON.parse((await fetchYxorp(yxorp.port, '/graphql', request)).body);

    expect(received.body).toBe(request.body);
    expect(received.headers['content-length']).toBe(String(Buffer.byteLength(request.body)));
  });

  it('proxies a non-JSON body intact', async () => {
    const received = JSON.parse((await fetchYxorp(yxorp.port, '/graphql', { method: 'POST', body: 'not json' })).body);
    expect(received.body).toBe('not json');
  });

  it('lets mock scripts read the already-read body with req.json()', async () => {
    const res = await fetchYxorp(yxorp.port, '/echo-json', { method: 'POST', body: '{"echo":true,"n":1}' });
    expect(JSON.parse(res.body)).toEqual({ received: { echo: true, n: 1 }, again: '{"echo":true,"n":1}' });
  });

  it('works for request rules too', async () => {
    const received = JSON.parse((await fetchYxorp(yxorp.port, '/graphql', graphql('Tagged'))).body);
    expect(received.headers['x-tagged']).toBe('yes');
    expect(JSON.parse(received.body).operationName).toBe('Tagged');
  });
});

describe('matchesPartially', () => {
  it('matches subsets of objects, exact arrays and primitives', () => {
    expect(matchesPartially({ a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(matchesPartially({ a: { b: 'x' } }, { a: { b: 'x', c: 1 } })).toBe(true);
    expect(matchesPartially({ a: 1 }, { a: '1' })).toBe(false);
    expect(matchesPartially({ a: 1 }, undefined)).toBe(false);
    expect(matchesPartially([1, { id: 2 }], [1, { id: 2, x: 0 }])).toBe(true);
    expect(matchesPartially([1], [1, 2])).toBe(false);
    expect(matchesPartially({ a: [] }, { a: {} })).toBe(false);
    expect(matchesPartially(null, null)).toBe(true);
  });
});
