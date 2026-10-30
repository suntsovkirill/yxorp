import path from 'path';
import { Config } from './services/config.service';
import { LoggerService } from './services/logger.service';
import { RemoteRulesMatcher } from './services/rules-matchers/remote-rules-matcher.service';
import { RewriteRulesMatcher } from './services/rules-matchers/rewrite-rules-matcher.service';
import { MockRulesMatcher } from './services/rules-matchers/mock-rules-matcher.service';
import { createServer } from './services/yxorp-server.service';
import { findConfigWarnings, validateConfig } from './services/config-validator';
import { applyCliOverrides } from './services/cli-overrides';
import { buildProxyConfig } from './services/proxy-config';
import { createConfigReloadHandler } from './services/config-reload';
import { loadConfigFile } from './services/config-loader';
import { watchConfig } from './services/config-watcher';
import { HarWriter } from './services/har-writer';
import { Recorder } from './services/recorder';
import { CaptureListener } from './middleware/capture.middleware';
import { ConfigFile, YxorpConfig } from './types/yxorp-config';
import { readVersion } from './utils/version';

export const DEFAULT_HOST = '127.0.0.1';

export interface YxorpOptions {
  /**
   * Config file to load. It's validated, and watched: edits apply to the
   * running server. Relative paths in it resolve against its directory.
   */
  configPath?: string;
  /** A config object instead of a file (not watched). */
  config?: ConfigFile;
  /** Base directory for relative paths in `config` (default: the current directory). */
  configDir?: string;
  /**
   * Command-line arguments whose overrides (`--port`, `--target`, `--host`)
   * win over the config — also after every reload.
   */
  argv?: string[];
  /** Logger; by default a console logger at the `info` level. */
  logger?: LoggerService;
  /** Save all traffic to this HAR file. */
  har?: string;
  /** Record proxied responses (and replaying mock rules) into this directory. */
  record?: string;
}

export interface YxorpServer {
  /** The proxy's URL, e.g. `http://127.0.0.1:3000`. */
  url: string;
  /** The port actually listened on (useful with `proxyPort: 0`). */
  port: number;
  /** The live runtime config. */
  config: Config;
  /** Stops watching, writes the HAR file, and closes the server. */
  close(): Promise<void>;
}

/** Thrown when the config is invalid; `errors` lists every problem. */
export class YxorpConfigError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid config:\n${errors.map(error => `  - ${error}`).join('\n')}`);
    this.name = 'YxorpConfigError';
  }
}

/**
 * Starts a yxorp proxy — the same thing the `yxorp` command runs, for use from
 * code (e.g. integration tests):
 *
 * ```ts
 * const proxy = await startYxorp({ config: { target: 'https://api.example.com', proxyPort: 0, mockRules: [...] } });
 * // ... point the app at proxy.url ...
 * await proxy.close();
 * ```
 */
export async function startYxorp(options: YxorpOptions): Promise<YxorpServer> {
  const argv = options.argv ?? [];
  const logger = options.logger ?? new LoggerService();

  let fileConfig: ConfigFile;
  let configDir: string;

  if (options.configPath) {
    const configPath = path.resolve(options.configPath);
    fileConfig = loadConfigFile(configPath).config;
    configDir = path.dirname(configPath);
  } else if (options.config) {
    fileConfig = options.config;
    configDir = path.resolve(options.configDir ?? process.cwd());
  } else {
    throw new Error('startYxorp() needs either `configPath` or `config`');
  }

  const config = applyCliOverrides(fileConfig, argv);
  const errors = validateConfig(config);

  if (errors.length) {
    throw new YxorpConfigError(errors);
  }

  findConfigWarnings(config).forEach(warning => logger.warn(warning));

  const appConfig = new Config();
  appConfig.set(buildProxyConfig(config, configDir));

  const harWriter = options.har ? new HarWriter(path.resolve(options.har), readVersion()) : undefined;
  const recorder = options.record ? new Recorder(path.resolve(options.record), configDir, logger) : undefined;
  const capture: CaptureListener[] = [harWriter?.add, recorder?.record].filter((listener) => !!listener);

  const { server } = createServer(
    appConfig,
    logger,
    new RewriteRulesMatcher(appConfig),
    new MockRulesMatcher(appConfig),
    new RemoteRulesMatcher(appConfig),
    { capture },
  );

  const host = config.host ?? DEFAULT_HOST;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(config.proxyPort), host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const port = (server.address() as { port: number }).port;

  const watcher = options.configPath
    ? watchConfig(
      path.resolve(options.configPath),
      createConfigReloadHandler(appConfig, logger, argv),
      (e: any) => logger.error(`Config reload failed: ${e.message || e}`),
    )
    : undefined;

  const scheme = config.https ? 'https' : 'http';
  const urlHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;

  return {
    url: `${scheme}://${urlHost}:${port}`,
    port,
    config: appConfig,
    close: () => {
      watcher?.close();
      harWriter?.flush();

      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export type { ConfigFile, YxorpConfig };
