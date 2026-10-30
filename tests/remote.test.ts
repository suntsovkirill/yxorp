import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, fetchYxorp } from './helpers/create-yxorp';
import http from 'http';

let mainTarget: http.Server;
let mainTargetPort: number;
let altTarget: http.Server;
let altTargetPort: number;
let yxorp: { port: number; stop: () => Promise<void> };

beforeAll(async () => {
  const main = await startTargetServer();
  mainTarget = main.server;
  mainTargetPort = main.port;

  const alt = await startTargetServer({
    '/api/special': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ from: 'alt-target', url: req.url }));
    },
  });
  altTarget = alt.server;
  altTargetPort = alt.port;

  yxorp = await createYxorp({
    target: `http://localhost:${mainTargetPort}`,
    remoteRules: [
      {
        path: '/api/special',
        target: `http://localhost:${altTargetPort}`,
      },
      {
        path: '/legacy/:id',
        target: `http://localhost:${altTargetPort}/v2/items/:id`,
      },
      {
        path: '/tagged/:id',
        target: `http://localhost:${altTargetPort}/v2/:id?source=yxorp`,
      },
    ],
  });
});

afterAll(async () => {
  await yxorp.stop();
  await stopTargetServer(mainTarget);
  await stopTargetServer(altTarget);
});

describe('Remote rules', () => {
  it('routes matching requests to alternative target', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/special');
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.from).toBe('alt-target');
  });

  it('routes non-matching requests to default target', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.name).toBe('Alice');
  });

  it('matches by path and forwards the query string to a target without a path', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/special?page=2');
    expect(JSON.parse(res.body)).toEqual({ from: 'alt-target', url: '/api/special?page=2' });
  });

  it('replaces the request path with the target path compiled from params', async () => {
    const res = await fetchYxorp(yxorp.port, '/legacy/5');
    expect(res.body).toBe('target: /v2/items/5');
  });

  it('keeps the query string out of params and appends it to the target path', async () => {
    const res = await fetchYxorp(yxorp.port, '/legacy/5?q=1&sort=asc');
    expect(res.body).toBe('target: /v2/items/5?q=1&sort=asc');
  });

  it('merges the target query string with the request query string', async () => {
    const tagged = await fetchYxorp(yxorp.port, '/tagged/9');
    expect(tagged.body).toBe('target: /v2/9?source=yxorp');

    const withQuery = await fetchYxorp(yxorp.port, '/tagged/9?q=1');
    expect(withQuery.body).toBe('target: /v2/9?source=yxorp&q=1');
  });
});
