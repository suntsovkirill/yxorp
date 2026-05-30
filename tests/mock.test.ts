import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';
import http from 'http';

const fixtures = path.resolve(__dirname, 'fixtures');

let target: http.Server;
let targetPort: number;

beforeAll(async () => {
  const targetServer = await startTargetServer();
  target = targetServer.server;
  targetPort = targetServer.port;
});

afterAll(async () => {
  await stopTargetServer(target);
});

describe('Mock by file', () => {
  let yxorp: YxorpInstance;

  beforeAll(async () => {
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      mockRules: [
        {
          method: 'GET',
          path: '/api/mock-file',
          file: path.join(fixtures, 'mock-data.json'),
          statusCode: 200,
        },
      ],
    });
  });

  afterAll(async () => {
    await yxorp.stop();
  });

  it('returns mocked JSON file', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/mock-file');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('json');
    expect(JSON.parse(res.body)).toEqual({ mocked: true, source: 'file', value: 42 });
  });

  it('does not reach target server for mocked routes', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/mock-file');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).mocked).toBe(true);
  });
});

describe('Mock by script', () => {
  let yxorp: YxorpInstance;

  beforeAll(async () => {
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      mockRules: [
        {
          method: 'GET',
          path: '/api/mock-script',
          script: path.join(fixtures, 'mock-script.js'),
        },
        {
          method: 'POST',
          path: '/api/mock-dynamic/:rest',
          script: path.join(fixtures, 'mock-dynamic.js'),
        },
      ],
    });
  });

  afterAll(async () => {
    await yxorp.stop();
  });

  it('returns response from mock script', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/mock-script');
    expect(res.statusCode).toBe(201);
    expect(res.headers['content-type']).toContain('json');
    expect(JSON.parse(res.body)).toEqual({ mocked: true, source: 'script', value: 99 });
  });

  it('handles POST with pattern matching', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/mock-dynamic/123', { method: 'POST' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.mocked).toBe(true);
    expect(data.source).toBe('dynamic');
    expect(data.timestamp).toBeTypeOf('number');
  });

  it('falls through to proxy when no mock matches', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: 1, name: 'Alice' });
  });
});

describe('Mock with custom status code', () => {
  let yxorp: YxorpInstance;

  beforeAll(async () => {
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      mockRules: [
        {
          method: 'GET',
          path: '/api/error',
          file: path.join(fixtures, 'mock-data.json'),
          statusCode: 418,
        },
      ],
    });
  });

  afterAll(async () => {
    await yxorp.stop();
  });

  it('returns custom status code from mock rule', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/error');
    expect(res.statusCode).toBe(418);
  });
});

describe('Mock disabled rule', () => {
  let yxorp: YxorpInstance;

  beforeAll(async () => {
    yxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      mockRules: [
        {
          method: 'GET',
          path: '/api/user',
          file: path.join(fixtures, 'mock-data.json'),
          statusCode: 200,
          disable: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await yxorp.stop();
  });

  it('passes through to target for disabled rules', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: 1, name: 'Alice' });
  });
});
