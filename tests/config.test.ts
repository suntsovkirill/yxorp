import { describe, it, expect } from 'vitest';
import { Config } from '../src/services/config.service';
import { YxorpConfig } from '../src/types/yxorp-config';

describe('Config', () => {
  it('throws when get() is called before set()', () => {
    const config = new Config();
    expect(() => config.get()).toThrow();
  });

  it('returns the config after set()', () => {
    const config = new Config();
    const value: YxorpConfig = { target: 'http://example.com', proxyPort: 3000, proxyOptions: {} };

    config.set(value);

    expect(config.get()).toEqual(value);
  });
});
