import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, createRecordingLogger, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';
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

  it('matches the rule by path, ignoring the query string', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user?fields=name');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ mocked: true, source: 'file', value: 42 });
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

describe('Rewrite script return values', () => {
  let instance: YxorpInstance;
  const { logger, messages } = createRecordingLogger();

  beforeAll(async () => {
    instance = await createYxorp({
      target: `http://localhost:${targetPort}`,
      rewriteRules: [
        { method: 'GET', path: '/api/user', script: path.join(fixtures, 'rewrite-string.js') },
        { method: 'GET', path: '/api/items', script: path.join(fixtures, 'rewrite-object.js') },
        { method: 'GET', path: '/api/headers', script: path.join(fixtures, 'rewrite-no-return.js') },
        { method: 'GET', path: '/api/echo', script: path.join(fixtures, 'rewrite-not-function.js') },
      ],
    }, { logger });
  });

  afterAll(async () => {
    await instance.stop();
  });

  it('accepts a string and sets content-length in bytes, not characters', async () => {
    const res = await fetchYxorp(instance.port, '/api/user');
    expect(JSON.parse(res.body)).toEqual({ greeting: 'Привет, Alice' });
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(res.body));
  });

  it('JSON-serializes a returned object', async () => {
    const res = await fetchYxorp(instance.port, '/api/items');
    expect(JSON.parse(res.body)).toEqual({ count: 2, rewritten: 'объект' });
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(res.body));
  });

  it('keeps the original body and warns when the script returns nothing', async () => {
    const res = await fetchYxorp(instance.port, '/api/headers');
    expect(res.body).toBe('headers test');
    expect(messages.some(m => m.level === 'warn' && m.message.includes('returned nothing'))).toBe(true);
  });

  it('logs an error and passes the response through when the script does not export a function', async () => {
    const res = await fetchYxorp(instance.port, '/api/echo');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).method).toBe('GET');
    expect(messages.some(m => m.level === 'error' && m.message.includes('does not export a function'))).toBe(true);
  });
});
