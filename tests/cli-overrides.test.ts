import { describe, it, expect } from 'vitest';
import { applyCliOverrides } from '../src/services/cli-overrides';
import { ConfigFile } from '../src/types/yxorp-config';

describe('cli-overrides', () => {
  const baseConfig: ConfigFile = { target: 'http://example.com', proxyPort: 3000 };

  it('returns the config unchanged when no override flags are present', () => {
    const result = applyCliOverrides(baseConfig, ['node', 'yxorp']);
    expect(result).toEqual(baseConfig);
  });

  it('overrides proxyPort with --port', () => {
    const result = applyCliOverrides(baseConfig, ['node', 'yxorp', '--port', '4000']);
    expect(result.proxyPort).toBe('4000');
    expect(result.target).toBe('http://example.com');
  });

  it('overrides target with --target', () => {
    const result = applyCliOverrides(baseConfig, ['node', 'yxorp', '--target', 'http://localhost:8080']);
    expect(result.target).toBe('http://localhost:8080');
    expect(result.proxyPort).toBe(3000);
  });

  it('applies both overrides together', () => {
    const result = applyCliOverrides(baseConfig, ['node', 'yxorp', '--port', '4000', '--target', 'http://localhost:8080']);
    expect(result).toMatchObject({ proxyPort: '4000', target: 'http://localhost:8080' });
  });

  it('ignores a trailing flag with no value', () => {
    const result = applyCliOverrides(baseConfig, ['node', 'yxorp', '--port']);
    expect(result.proxyPort).toBe(3000);
  });

  it('does not mutate the original config object', () => {
    const original = { ...baseConfig };
    applyCliOverrides(baseConfig, ['node', 'yxorp', '--port', '4000']);
    expect(baseConfig).toEqual(original);
  });
});
