import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from '../src/services/config.service';
import { createConfigReloadHandler } from '../src/services/config-reload';
import { buildProxyConfig } from '../src/services/proxy-config';
import { createRecordingLogger } from './helpers/create-yxorp';

describe('config reload', () => {
  let appConfig: Config;

  beforeEach(() => {
    appConfig = new Config();
    appConfig.set(buildProxyConfig({ target: 'http://from-file:8080', proxyPort: 3000 }));
  });

  it('applies the reloaded config', () => {
    const { logger } = createRecordingLogger();
    const onReload = createConfigReloadHandler(appConfig, logger, ['node', 'yxorp']);

    onReload({
      target: 'http://changed:8080',
      proxyPort: 3000,
      mockRules: [{ method: 'GET', path: '/a', file: './a.json' }],
    });

    expect(appConfig.get().target).toBe('http://changed:8080');
    expect(appConfig.get().proxyOptions.target).toBe('http://changed:8080');
    expect(appConfig.get().mockRules).toHaveLength(1);
  });

  it('keeps CLI overrides after a reload', () => {
    const { logger } = createRecordingLogger();
    const argv = ['node', 'yxorp', '--target', 'http://from-cli:9000', '--port=4000'];
    appConfig.set(buildProxyConfig({ target: 'http://from-cli:9000', proxyPort: '4000' }));
    const onReload = createConfigReloadHandler(appConfig, logger, argv);

    onReload({ target: 'http://from-file:8080', proxyPort: 3000, proxyHeaders: { 'x-a': '1' } });

    expect(appConfig.get().target).toBe('http://from-cli:9000');
    expect(appConfig.get().proxyOptions.target).toBe('http://from-cli:9000');
    expect(appConfig.get().proxyPort).toBe('4000');
    expect(appConfig.get().proxyHeaders).toEqual({ 'x-a': '1' });
  });

  it('warns that a changed proxyPort needs a restart and keeps the running port', () => {
    const { logger, messages } = createRecordingLogger();
    const onReload = createConfigReloadHandler(appConfig, logger, ['node', 'yxorp']);

    onReload({ target: 'http://from-file:8080', proxyPort: 5000 });

    expect(appConfig.get().proxyPort).toBe(3000);
    expect(messages.some(m => m.level === 'warn' && m.message.includes('restart'))).toBe(true);
  });

  it('does not warn when proxyPort is unchanged', () => {
    const { logger, messages } = createRecordingLogger();
    const onReload = createConfigReloadHandler(appConfig, logger, ['node', 'yxorp']);

    onReload({ target: 'http://from-file:8080', proxyPort: '3000' });

    expect(messages.some(m => m.level === 'warn')).toBe(false);
  });

  it('skips an invalid config and keeps the current one', () => {
    const { logger, messages } = createRecordingLogger();
    const onReload = createConfigReloadHandler(appConfig, logger, ['node', 'yxorp']);

    onReload({ target: '', proxyPort: 3000 });

    expect(appConfig.get().target).toBe('http://from-file:8080');
    expect(messages.some(m => m.level === 'error')).toBe(true);
  });

  it('validates the config with CLI overrides applied', () => {
    // A file missing "target" is fine as long as --target supplies it — same as at startup.
    const { logger } = createRecordingLogger();
    const onReload = createConfigReloadHandler(appConfig, logger, ['node', 'yxorp', '--target', 'http://from-cli:9000']);

    onReload({ proxyPort: 3000 } as any);

    expect(appConfig.get().target).toBe('http://from-cli:9000');
  });

  it('warns about unknown keys in the reloaded config', () => {
    const { logger, messages } = createRecordingLogger();
    const onReload = createConfigReloadHandler(appConfig, logger, ['node', 'yxorp']);

    onReload({ target: 'http://from-file:8080', proxyPort: 3000, mockRule: [] } as any);

    expect(messages).toContainEqual({ level: 'warn', message: 'Unknown config key "mockRule" is ignored' });
  });
});
