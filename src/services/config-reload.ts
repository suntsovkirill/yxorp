import { Config } from './config.service';
import { LoggerService } from './logger.service';
import { applyCliOverrides } from './cli-overrides';
import { findConfigWarnings, validateConfig } from './config-validator';
import { buildProxyConfig } from './proxy-config';
import { ConfigFile } from '../types/yxorp-config';

/**
 * Returns the `onReload` callback for `watchConfig`. The reloaded file goes
 * through the same steps as at startup — CLI overrides, then validation — so
 * `--port`/`--target` keep winning over the file after every save.
 *
 * The server can't move to a new port or switch HTTP/HTTPS without a restart,
 * so a changed `proxyPort`/`https` is reported and ignored; the running values
 * are kept in the config.
 */
export function createConfigReloadHandler(
  appConfig: Config,
  logger: LoggerService,
  argv: string[],
): (newConfig: ConfigFile) => void {
  return (newConfig) => {
    const config = applyCliOverrides(newConfig, argv);
    const errors = validateConfig(config);

    if (errors.length) {
      logger.error('Config reload skipped — invalid config:');
      errors.forEach(err => logger.error(`  - ${err}`));
      return;
    }

    findConfigWarnings(config).forEach(warning => logger.warn(warning));

    const runningPort = appConfig.get().proxyPort;

    if (String(config.proxyPort) !== String(runningPort)) {
      logger.warn(`"proxyPort" changed to ${config.proxyPort} — restart yxorp to apply it; still listening on ${runningPort}`);
    }

    const runningHttps = appConfig.get().https;
    const runningHost = appConfig.get().host;

    if ((config.host ?? '') !== (runningHost ?? '')) {
      logger.warn(`"host" changed to ${config.host ?? '(default)'} — restart yxorp to apply it`);
    }

    if (JSON.stringify(config.https) !== JSON.stringify(runningHttps)) {
      logger.warn('"https" changed — restart yxorp to apply it; the server keeps its current protocol and certificate');
    }

    appConfig.set(buildProxyConfig({ ...config, proxyPort: runningPort, https: runningHttps, host: runningHost }, appConfig.get().configDir));
    logger.info('Config reloaded');
  };
}
