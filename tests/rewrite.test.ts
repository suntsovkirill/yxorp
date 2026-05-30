import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, fetchYxorp } from './helpers/create-yxorp';
import http from 'http';

const fixtures = path.resolve(__dirname, 'fixtures');

let target: http.Server;
let targetPort: number;
let yxorp: { port: number; stop: () => Promise<void> };

beforeAll(async () => {
  const targetServer = await startTargetServer();
  target = targetServer.server;
  targetPort = targetServer.port;
});

afterAll(async () => {
  if (yxorp) await yxorp.stop();
  await stopTargetServer(target);
});

describe('Rewrite by file', () => {
  beforeAll(async () => {
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      rewriteRules: [
        {
          method: 'GET',
          path: '/api/user',
          file: path.join(fixtures, 'mock-data.json'),
          statusCode: 200,
        },
      ],
    });
  });

  it('replaces response body with file content', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toEqual({ mocked: true, source: 'file', value: 42 });
  });
});

describe('Rewrite by script', () => {
  beforeAll(async () => {
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      rewriteRules: [
        {
          method: 'GET',
          path: '/api/user',
          script: path.join(fixtures, 'rewrite-script.js'),
        },
      ],
    });
  });

  it('modifies response body via rewrite script', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.name).toBe('Alice'); // original data preserved
    expect(data.rewritten).toBe(true);
    expect(data.source).toBe('rewrite-script');
    expect(data.originalSource).toBeUndefined(); // overwritten
  });
});

describe('Rewrite with custom status code', () => {
  beforeAll(async () => {
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      rewriteRules: [
        {
          method: 'GET',
          path: '/api/user',
          file: path.join(fixtures, 'mock-data.json'),
          statusCode: 201,
        },
      ],
    });
  });

  it('overrides status code in rewrite', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(201);
  });
});

describe('Rewrite disabled rule', () => {
  beforeAll(async () => {
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      rewriteRules: [
        {
          method: 'GET',
          path: '/api/user',
          file: path.join(fixtures, 'mock-data.json'),
          disable: true,
        },
      ],
    });
  });

  it('passes through original response for disabled rewrite rule', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.name).toBe('Alice');
    expect(data.mocked).toBeUndefined();
  });
});
