import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import { KNOWN_PROFILE_KEYS, KNOWN_RULE_KEYS, KNOWN_TOP_LEVEL_KEYS, validateConfig } from '../src/services/config-validator';

const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../schema.json'), 'utf-8'));
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);

const base = { target: 'https://api.example.com', proxyPort: 3000 };

describe('schema.json', () => {
  it('knows exactly the keys the validator knows', () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...KNOWN_TOP_LEVEL_KEYS].sort());

    const definitionFor = { remoteRules: 'remoteRule', staticRules: 'staticRule', mockRules: 'responseRule', rewriteRules: 'responseRule', requestRules: 'requestRule' } as const;

    for (const [section, keys] of Object.entries(KNOWN_RULE_KEYS)) {
      const definition = schema.definitions[definitionFor[section as keyof typeof definitionFor]];
      expect(Object.keys(definition.properties).sort(), section).toEqual([...keys].sort());
    }

    expect(Object.keys(schema.definitions.profile.properties).sort()).toEqual([...KNOWN_PROFILE_KEYS].sort());
  });

  const valid = [
    base,
    { ...base, proxyPort: '8080', secure: true, changeOrigin: false, cors: true, https: { key: 'k.pem', cert: 'c.pem' } },
    { ...base, cors: { origin: ['http://localhost:5173'], credentials: false, maxAge: 60, exposeHeaders: ['x-a'] } },
    {
      ...base,
      $schema: './schema.json',
      remoteRules: [{ path: '/legacy/:id', target: 'http://localhost:4000/v2/:id', ws: false }],
      staticRules: [{ path: '/assets', directory: './static', caseInsensitive: true, directoryIndex: 'index.html' }],
      mockRules: [
        { method: 'GET', path: '/a', file: './a.json', statusCode: 201, headers: { 'x-a': '1' }, delay: 100 },
        { method: 'post', path: '/b', script: './b.mjs', match: { query: { page: '2' }, headers: { 'x-user': 'admin' } } },
        { method: 'GET', path: '/c', json: { ok: true } },
        { method: 'GET', path: '/d', body: 'text', disable: true },
      ],
      rewriteRules: [{ method: 'GET', path: '/e', json: [] }],
      requestRules: [{ method: 'POST', path: '/f', headers: { 'x-a': '1', cookie: null }, query: { debug: '1' }, json: { a: 1 } }],
      chaos: { delay: { min: 10, max: 100 }, errorRate: 0.1, errorStatus: 500, dropRate: 0.01, paths: ['/api/*rest'] },
      profiles: {
        empty: { mockRules: [{ method: 'GET', path: '/g', json: [] }], chaos: { delay: 5 } },
        flaky: { chaos: { errorRate: 0.5 } },
      },
      profile: 'empty',
    },
  ];

  it.each(valid.map((config, index) => [index, config]))('accepts valid config #%s, like the validator', (_index, config) => {
    expect(validateConfig(config)).toEqual([]);
    expect(validateSchema(config), JSON.stringify(validateSchema.errors)).toBe(true);
  });

  const invalid: Record<string, unknown> = {
    'missing target': { proxyPort: 3000 },
    'target without protocol': { ...base, target: 'localhost:8080' },
    'port out of range': { ...base, proxyPort: 70000 },
    'header value not a string': { ...base, proxyHeaders: { 'x-a': 1 } },
    'two body sources': { ...base, mockRules: [{ method: 'GET', path: '/a', file: './a.json', json: {} }] },
    'no body source': { ...base, rewriteRules: [{ method: 'GET', path: '/a' }] },
    'bad statusCode': { ...base, mockRules: [{ method: 'GET', path: '/a', json: {}, statusCode: 600 }] },
    'negative delay': { ...base, mockRules: [{ method: 'GET', path: '/a', json: {}, delay: -1 }] },
    'remote target without host': { ...base, remoteRules: [{ path: '/a', target: '/v2' }] },
    'static rule without directory': { ...base, staticRules: [{ path: '/a' }] },
    'https without cert': { ...base, https: { key: 'k.pem' } },
    'cors not boolean/object': { ...base, cors: 'yes' },
    'request rule with json and body': { ...base, requestRules: [{ method: 'GET', path: '/a', json: {}, body: '' }] },
    'chaos rate above 1': { ...base, chaos: { errorRate: 2 } },
    'chaos unknown key': { ...base, chaos: { errorrate: 0.5 } },
    'invalid rule inside a profile': { ...base, profiles: { p: { mockRules: [{ method: 'GET', path: '/a' }] } } },
  };

  it.each(Object.entries(invalid))('rejects %s, like the validator', (_name, config) => {
    expect(validateConfig(config)).not.toEqual([]);
    expect(validateSchema(config)).toBe(false);
  });
});
