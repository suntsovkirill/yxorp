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
});
