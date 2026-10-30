import { describe, it, expect } from 'vitest';
import { findConfigWarnings, validateConfig } from '../src/services/config-validator';

describe('config-validator', () => {
  it('accepts a minimal valid config', () => {
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 3000 })).toEqual([]);
  });

  it('accepts proxyPort as a numeric string', () => {
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: '3000' })).toEqual([]);
  });

  it('accepts a fully populated config', () => {
    const config = {
      target: 'https://api.example.com',
      proxyPort: 3000,
      proxyHeaders: { 'user-agent': 'test' },
      remoteRules: [],
      staticRules: [],
      mockRules: [],
      rewriteRules: [],
    };

    expect(validateConfig(config)).toEqual([]);
  });

  it('rejects a non-object config', () => {
    expect(validateConfig(null)).toHaveLength(1);
    expect(validateConfig([])).toHaveLength(1);
    expect(validateConfig('string')).toHaveLength(1);
  });

  it('requires a non-empty target', () => {
    expect(validateConfig({ proxyPort: 3000 })).toContainEqual(expect.stringContaining('"target"'));
    expect(validateConfig({ target: '', proxyPort: 3000 })).toContainEqual(expect.stringContaining('"target"'));
    expect(validateConfig({ target: '   ', proxyPort: 3000 })).toContainEqual(expect.stringContaining('"target"'));
    expect(validateConfig({ target: 123, proxyPort: 3000 })).toContainEqual(expect.stringContaining('"target"'));
  });

  it('requires a valid proxyPort', () => {
    expect(validateConfig({ target: 'https://api.example.com' })).toContainEqual(expect.stringContaining('"proxyPort"'));
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 'not-a-port' })).toContainEqual(expect.stringContaining('"proxyPort"'));
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: -1 })).toContainEqual(expect.stringContaining('"proxyPort"'));
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 3.5 })).toContainEqual(expect.stringContaining('"proxyPort"'));
  });

  it('rejects a proxyPort outside the valid 0-65535 range', () => {
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 65536 })).toContainEqual(expect.stringContaining('"proxyPort"'));
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: '99999' })).toContainEqual(expect.stringContaining('"proxyPort"'));
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 65535 })).toEqual([]);
  });

  it('rejects a non-object proxyHeaders', () => {
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 3000, proxyHeaders: 'nope' }))
      .toContainEqual(expect.stringContaining('"proxyHeaders"'));
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 3000, proxyHeaders: [] }))
      .toContainEqual(expect.stringContaining('"proxyHeaders"'));
  });

  it('rejects non-array rule sections', () => {
    for (const key of ['remoteRules', 'staticRules', 'mockRules', 'rewriteRules']) {
      expect(validateConfig({ target: 'https://api.example.com', proxyPort: 3000, [key]: {} }))
        .toContainEqual(expect.stringContaining(`"${key}"`));
    }
  });

  it('requires target to be an absolute http(s) URL', () => {
    expect(validateConfig({ target: 'localhost:8080', proxyPort: 3000 }))
      .toContainEqual(expect.stringContaining('absolute http(s) URL'));
    expect(validateConfig({ target: 'api.example.com', proxyPort: 3000 }))
      .toContainEqual(expect.stringContaining('absolute http(s) URL'));
    expect(validateConfig({ target: 'http://localhost:8080/base', proxyPort: 3000 })).toEqual([]);
  });

  it('requires proxyHeaders values to be strings', () => {
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 3000, proxyHeaders: { 'x-count': 1 } }))
      .toContainEqual(expect.stringContaining('"proxyHeaders.x-count" must be a string'));
  });

  it('validates secure and changeOrigin as booleans', () => {
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 3000, secure: true, changeOrigin: false })).toEqual([]);
    expect(validateConfig({ target: 'https://api.example.com', proxyPort: 3000, secure: 'yes' }))
      .toContainEqual(expect.stringContaining('"secure"'));
  });

  it('validates cors and https', () => {
    const base = { target: 'https://api.example.com', proxyPort: 3000 };

    expect(validateConfig({ ...base, cors: true })).toEqual([]);
    expect(validateConfig({ ...base, cors: { origin: ['http://localhost:5173'], credentials: false, maxAge: 60, exposeHeaders: ['x-a'] } })).toEqual([]);
    expect(validateConfig({ ...base, cors: 'yes' })).toContainEqual(expect.stringContaining('"cors" must be'));
    expect(validateConfig({ ...base, cors: { origins: '*' } })).toContainEqual(expect.stringContaining('unknown key "origins"'));
    expect(validateConfig({ ...base, cors: { maxAge: -5 } })).toContainEqual(expect.stringContaining('"cors.maxAge"'));

    expect(validateConfig({ ...base, https: { key: './key.pem', cert: './cert.pem' } })).toEqual([]);
    expect(validateConfig({ ...base, https: { key: './key.pem' } })).toContainEqual(expect.stringContaining('"https.cert"'));
  });

  it('reports multiple errors at once', () => {
    const errors = validateConfig({ proxyPort: 'nope' });
    expect(errors.length).toBeGreaterThan(1);
  });

  describe('rule entry shapes', () => {
    const base = { target: 'https://api.example.com', proxyPort: 3000 };

    it('requires path and method on mock/rewrite rules', () => {
      for (const key of ['mockRules', 'rewriteRules']) {
        expect(validateConfig({ ...base, [key]: [{ path: '/x', file: './a.json' }] }))
          .toContainEqual(expect.stringContaining('"method"'));
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', file: './a.json' }] }))
          .toContainEqual(expect.stringContaining('"path"'));
      }
    });

    it('requires exactly one of file/script on mock/rewrite rules', () => {
      for (const key of ['mockRules', 'rewriteRules']) {
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x' }] }))
          .toContainEqual(expect.stringContaining('must declare one of "file", "script", "json" or "body"'));
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x', file: './a.json', script: './a.js' }] }))
          .toContainEqual(expect.stringContaining('must declare only one of "file", "script", "json" or "body", not "file" and "script"'));
      }
    });

    it('accepts a valid mock/rewrite rule', () => {
      for (const key of ['mockRules', 'rewriteRules']) {
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x', file: './a.json' }] })).toEqual([]);
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x', script: './a.js' }] })).toEqual([]);
      }
    });

    it('requires target on remoteRules entries', () => {
      expect(validateConfig({ ...base, remoteRules: [{ path: '/x' }] }))
        .toContainEqual(expect.stringContaining('"target"'));
      expect(validateConfig({ ...base, remoteRules: [{ path: '/x', target: 'http://localhost:4000' }] })).toEqual([]);
    });

    it('requires directory on staticRules entries', () => {
      expect(validateConfig({ ...base, staticRules: [{ path: '/x' }] }))
        .toContainEqual(expect.stringContaining('"directory"'));
      expect(validateConfig({ ...base, staticRules: [{ path: '/x', directory: './static' }] })).toEqual([]);
    });

    it('rejects malformed path-to-regexp patterns', () => {
      expect(validateConfig({ ...base, remoteRules: [{ path: '/api/:[bad', target: 'http://localhost:4000' }] }))
        .toContainEqual(expect.stringContaining('invalid "path" pattern'));
    });

    it('requires remoteRules targets to be absolute URLs', () => {
      expect(validateConfig({ ...base, remoteRules: [{ path: '/x/:id', target: '/v2/:id' }] }))
        .toContainEqual(expect.stringContaining('must be an absolute URL'));
      expect(validateConfig({ ...base, remoteRules: [{ path: '/x/:id', target: 'http://localhost:4000/v2/:id' }] })).toEqual([]);
      expect(validateConfig({ ...base, remoteRules: [{ path: '/ws', target: 'ws://localhost:4000', ws: true }] })).toEqual([]);
    });

    it('accepts inline json/body sources and rejects invalid ones', () => {
      for (const key of ['mockRules', 'rewriteRules']) {
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x', json: { ok: true } }] })).toEqual([]);
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x', json: null }] })).toEqual([]);
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x', body: 'plain' }] })).toEqual([]);
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x', body: { a: 1 } }] }))
          .toContainEqual(expect.stringContaining('"body" that must be a string'));
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x', json: {}, body: '' }] }))
          .toContainEqual(expect.stringContaining('not "json" and "body"'));
      }
    });

    it('validates delay, headers and match', () => {
      const rule = { method: 'GET', path: '/x', json: {} };

      expect(validateConfig({ ...base, mockRules: [{ ...rule, delay: 250, headers: { 'x-a': '1' }, match: { query: { page: '2' }, headers: { 'x-user': 'admin' } } }] }))
        .toEqual([]);
      expect(validateConfig({ ...base, mockRules: [{ ...rule, delay: -1 }] }))
        .toContainEqual(expect.stringContaining('"delay" must be a non-negative integer'));
      expect(validateConfig({ ...base, mockRules: [{ ...rule, headers: { 'x-a': 1 } }] }))
        .toContainEqual(expect.stringContaining('"headers" value for "x-a" must be a string'));
      expect(validateConfig({ ...base, mockRules: [{ ...rule, match: { query: { page: 2 } } }] }))
        .toContainEqual(expect.stringContaining('"match.query" value for "page" must be a string'));
      expect(validateConfig({ ...base, mockRules: [{ ...rule, match: { body: { operationName: 'GetUser' } } }] })).toEqual([]);
      expect(validateConfig({ ...base, mockRules: [{ ...rule, match: { cookies: {} } }] }))
        .toContainEqual(expect.stringContaining('"match" has an unknown key "cookies"'));
      expect(validateConfig({ ...base, mockRules: [{ ...rule, match: [] }] }))
        .toContainEqual(expect.stringContaining('"match" must be an object'));
    });

    it('rejects an unknown HTTP method', () => {
      expect(validateConfig({ ...base, mockRules: [{ method: 'FETCH', path: '/x', file: './a.json' }] }))
        .toContainEqual(expect.stringContaining('unknown HTTP "method" "FETCH"'));
      expect(validateConfig({ ...base, mockRules: [{ method: 'patch', path: '/x', file: './a.json' }] })).toEqual([]);
    });

    it('rejects a statusCode outside 100-599', () => {
      for (const statusCode of [99, 600, '200', 200.5]) {
        expect(validateConfig({ ...base, mockRules: [{ method: 'GET', path: '/x', file: './a.json', statusCode }] }))
          .toContainEqual(expect.stringContaining('"statusCode"'));
      }
      expect(validateConfig({ ...base, rewriteRules: [{ method: 'GET', path: '/x', file: './a.json', statusCode: 418 }] })).toEqual([]);
    });

    it('rejects non-boolean flags', () => {
      expect(validateConfig({ ...base, mockRules: [{ method: 'GET', path: '/x', file: './a.json', disable: 'yes' }] }))
        .toContainEqual(expect.stringContaining('"disable" must be true or false'));
      expect(validateConfig({ ...base, remoteRules: [{ path: '/x', target: 'http://localhost:4000', ws: 1 }] }))
        .toContainEqual(expect.stringContaining('"ws" must be true or false'));
      expect(validateConfig({ ...base, staticRules: [{ path: '/x', directory: './s', caseInsensitive: 'true' }] }))
        .toContainEqual(expect.stringContaining('"caseInsensitive" must be true or false'));
    });

    it('treats static rule paths as plain prefixes, not patterns', () => {
      expect(validateConfig({ ...base, staticRules: [{ path: '/assets(v2)', directory: './static' }] })).toEqual([]);
    });

    it('reports the offending rule index in error messages', () => {
      const errors = validateConfig({ ...base, mockRules: [{ method: 'GET', path: '/ok', file: './a.json' }, { path: '/bad' }] });
      expect(errors).toContainEqual(expect.stringContaining('mockRules[1]'));
      expect(errors.some((e) => e.includes('mockRules[0]'))).toBe(false);
    });
  });

  describe('warnings', () => {
    const base = { target: 'https://api.example.com', proxyPort: 3000 };

    it('has no warnings for known keys', () => {
      expect(findConfigWarnings({
        ...base,
        $schema: './schema.json',
        secure: true,
        mockRules: [{ method: 'GET', path: '/x', file: './a.json', statusCode: 200, disable: false }],
        staticRules: [{ path: '/s', directory: './s', caseInsensitive: true, directoryIndex: 'index.html' }],
        remoteRules: [{ path: '/r', target: 'http://localhost:4000', ws: true }],
      })).toEqual([]);
    });

    it('warns about unknown top-level and rule keys', () => {
      const warnings = findConfigWarnings({
        ...base,
        mockRule: [],
        rewriteRules: [{ method: 'GET', path: '/x', file: './a.json', statuscode: 201 }],
      });

      expect(warnings).toEqual([
        'Unknown config key "mockRule" is ignored',
        'Unknown key "statuscode" in "rewriteRules[0]" is ignored',
      ]);
    });

    it('does not count unknown keys as errors', () => {
      expect(validateConfig({ ...base, mockRule: [] })).toEqual([]);
    });
  });
});
