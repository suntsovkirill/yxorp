import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateMocksFromOpenApi, readSpec, toPathPattern, writeMocksFromOpenApi } from '../src/services/openapi-mocks';
import { validateConfig } from '../src/services/config-validator';
import { matchPath } from '../src/utils/path-pattern';
import { createYxorp, fetchYxorp } from './helpers/create-yxorp';

const specs = path.resolve(__dirname, 'fixtures/openapi');

describe('generateMocksFromOpenApi (OpenAPI 3, YAML)', () => {
  const { mockRules, skipped } = generateMocksFromOpenApi(readSpec(path.join(specs, 'petstore.yaml')));
  const rule = (method: string, p: string) => mockRules.find(r => r.method === method && r.path === p) as any;

  it('makes one rule per operation, prefixed with the server path', () => {
    expect(mockRules.map(r => `${r.method} ${r.path}`)).toEqual([
      'GET /v1/pets',
      'POST /v1/pets',
      'GET /v1/pets/:petId',
      'DELETE /v1/pets/:petId',
      'GET /v1/pets/:"pet-id"/photo.:ext',
    ]);
  });

  it('builds a sample from the schema, following $ref, allOf, enum, example and formats', () => {
    expect(rule('GET', '/v1/pets').json).toEqual([{
      name: 'Fido',
      status: 'available',
      id: 0,
      born: '2024-01-01T00:00:00Z',
      owner: { email: 'user@example.com', pets: [expect.any(Object)] },
    }]);
  });

  it('uses inline and named examples, and keeps non-200 status codes', () => {
    expect(rule('POST', '/v1/pets')).toMatchObject({ statusCode: 201, json: { id: 7, name: 'Rex' } });
    expect(rule('GET', '/v1/pets/:petId').json).toEqual({ id: 1, name: 'Rex', tag: 'dog' });
    expect(rule('DELETE', '/v1/pets/:petId')).toMatchObject({ statusCode: 204, body: '' });
    expect(rule('GET', '/v1/pets/:"pet-id"/photo.:ext').body).toBe('a photo');
  });

  it('reports operations it could not mock', () => {
    expect(skipped).toEqual([
      'GET /health: no 2xx or default response',
      'GET /download: no JSON or text response content',
    ]);
  });

  it('produces rules that pass validation', () => {
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 0, mockRules })).toEqual([]);
  });

  it('honors an explicit base path', () => {
    const { mockRules: rules } = generateMocksFromOpenApi(readSpec(path.join(specs, 'petstore.yaml')), { basePath: '/' });
    expect(rules[0].path).toBe('/pets');
  });
});

describe('generateMocksFromOpenApi (Swagger 2, JSON)', () => {
  const { mockRules } = generateMocksFromOpenApi(readSpec(path.join(specs, 'swagger2.json')));

  it('uses basePath, examples and schema definitions', () => {
    expect(mockRules).toEqual([
      { method: 'GET', path: '/api/users/:id', json: { id: '00000000-0000-4000-8000-000000000000', active: true, score: 1.5 } },
      { method: 'GET', path: '/api/status', json: { ok: true } },
    ]);
  });

  it('rejects documents that are not OpenAPI', () => {
    expect(() => generateMocksFromOpenApi({ paths: {} })).toThrow('Not an OpenAPI 3 or Swagger 2 document');
  });
});

describe('toPathPattern', () => {
  it('turns {params} into :params that match real paths', () => {
    expect(toPathPattern('/files/{name}.{ext}')).toBe('/files/:name.:ext');
    expect(matchPath(toPathPattern('/a/{id}:batch'), '/a/5:batch')?.params).toEqual({ id: '5' });
  });
});

describe('writeMocksFromOpenApi', () => {
  it('writes a file that can be served as-is', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-openapi-'));
    const out = path.join(dir, 'mocks', 'openapi-mocks.json');

    try {
      writeMocksFromOpenApi(path.join(specs, 'petstore.yaml'), out);
      const { mockRules } = JSON.parse(fs.readFileSync(out, 'utf-8'));

      const yxorp = await createYxorp({ target: 'http://127.0.0.1:1', mockRules });

      try {
        const res = await fetchYxorp(yxorp.port, '/v1/pets/42');
        expect(JSON.parse(res.body)).toEqual({ id: 1, name: 'Rex', tag: 'dog' });
        expect((await fetchYxorp(yxorp.port, '/v1/pets', { method: 'POST' })).statusCode).toBe(201);
      } finally {
        await yxorp.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
