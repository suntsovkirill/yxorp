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
 * The server can't move to a new port without a restart, so a changed
 * `proxyPort` is reported and ignored; the running port is kept in the config.
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

    appConfig.set(buildProxyConfig({ ...config, proxyPort: runningPort }));
    logger.info('Config reloaded');
  };
}
