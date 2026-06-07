import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/services/config-validator';

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
          .toContainEqual(expect.stringContaining('must declare either "file" or "script"'));
        expect(validateConfig({ ...base, [key]: [{ method: 'GET', path: '/x', file: './a.json', script: './a.js' }] }))
          .toContainEqual(expect.stringContaining('must declare only one of "file" or "script"'));
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

    it('reports the offending rule index in error messages', () => {
      const errors = validateConfig({ ...base, mockRules: [{ method: 'GET', path: '/ok', file: './a.json' }, { path: '/bad' }] });
      expect(errors).toContainEqual(expect.stringContaining('mockRules[1]'));
      expect(errors.some((e) => e.includes('mockRules[0]'))).toBe(false);
    });
  });
});
