import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
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
      res.end(JSON.stringify({ from: 'alt-target' }));
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
});
