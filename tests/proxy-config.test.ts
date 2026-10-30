import { describe, it, expect } from 'vitest';
import { buildProxyConfig } from '../src/services/proxy-config';

describe('buildProxyConfig', () => {
  const base = { target: 'https://api.example.com', proxyPort: 3000 };

  it('defaults to not verifying TLS and rewriting the Host header', () => {
    const { proxyOptions } = buildProxyConfig(base);
    expect(proxyOptions.secure).toBe(false);
    expect(proxyOptions.changeOrigin).toBe(true);
  });

  it('passes secure and changeOrigin through from the config', () => {
    const { proxyOptions } = buildProxyConfig({ ...base, secure: true, changeOrigin: false });
    expect(proxyOptions.secure).toBe(true);
    expect(proxyOptions.changeOrigin).toBe(false);
  });

  it('sends proxyHeaders with every proxied request', () => {
    const { proxyOptions } = buildProxyConfig({ ...base, proxyHeaders: { 'x-a': '1' } });
    expect(proxyOptions.headers).toEqual({ 'x-a': '1' });
  });
});
