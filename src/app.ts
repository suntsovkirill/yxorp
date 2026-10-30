import path from 'path';
import { Config } from './services/config.service';
import { LoggerService } from './services/logger.service';
import { RemoteRulesMatcher } from './services/rules-matchers/remote-rules-matcher.service';
import { RewriteRulesMatcher } from './services/rules-matchers/rewrite-rules-matcher.service';
import { MockRulesMatcher } from './services/rules-matchers/mock-rules-matcher.service';
import { createServer } from './services/yxorp-server.service';
import { findConfigWarnings, validateConfig } from './services/config-validator';
import { applyCliOverrides, getArgValue } from './services/cli-overrides';
import { buildProxyConfig } from './services/proxy-config';
import { createConfigReloadHandler } from './services/config-reload';
import { loadConfigFile } from './services/config-loader';
import { watchConfig } from './services/config-watcher';
import { HarWriter } from './services/har-writer';
import { Recorder } from './services/recorder';
import { CaptureListener } from './middleware/capture.middleware';
import { ConfigFile, YxorpConfig } from './types/yxorp-config';
import { readVersion } from './utils/version';
import { EventEmitter } from 'events';
import { TrafficLog } from './ui/traffic-log';
import { startUiServer, UiServer } from './ui/ui-server';
import { ConfigEditor } from './ui/config-editor';

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
  /** Start the web UI — wins over the config's `ui`. */
  ui?: boolean | { port?: number };
}

export interface YxorpServer {
  /** The proxy's URL, e.g. `http://127.0.0.1:3000`. */
  url: string;
  /** The port actually listened on (useful with `proxyPort: 0`). */
  port: number;
  /** The live runtime config. */
  config: Config;
  /** The state mock/rewrite scripts share as `ctx.store`. */
  store: Map<string, any>;
  /** The web UI's URL, when it's running. */
  uiUrl?: string;
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

  const uiOption = options.ui ?? config.ui;
  const harWriter = options.har ? new HarWriter(path.resolve(options.har), readVersion()) : undefined;
  const recorder = options.record ? new Recorder(path.resolve(options.record), configDir, logger) : undefined;
  const traffic = uiOption ? new TrafficLog() : undefined;
  const capture: CaptureListener[] = [harWriter?.add, recorder?.record, traffic?.add].filter((listener) => !!listener);

  const { server, store } = createServer(
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

  // Fires 'config' after every reload — the web UI refreshes on it.
  const events = new EventEmitter();
  const reloadHandler = createConfigReloadHandler(appConfig, logger, argv);
  let lastLoaded = JSON.stringify(fileConfig);

  const onReload = (newConfig: ConfigFile) => {
    // An edit from the web UI reloads right away; the file watcher then sees
    // the same change again — skip reloads that change nothing.
    const loaded = JSON.stringify(newConfig);

    if (loaded === lastLoaded) {
      return;
    }

    lastLoaded = loaded;
    reloadHandler(newConfig);
    events.emit('config');
  };

  const watcher = options.configPath
    ? watchConfig(
      path.resolve(options.configPath),
      onReload,
      (e: any) => logger.error(`Config reload failed: ${e.message || e}`),
    )
    : undefined;

  const scheme = config.https ? 'https' : 'http';
  const urlHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  const url = `${scheme}://${urlHost}:${port}`;

  let ui: UiServer | undefined;

  if (traffic && uiOption) {
    const configPath = options.configPath ? path.resolve(options.configPath) : undefined;

    try {
      ui = await startUiServer({
        port: typeof uiOption === 'object' ? uiOption.port : undefined,
        version: readVersion(),
        appConfig,
        store,
        traffic,
        events,
        // Replay through the loopback interface even when listening on all of them.
        proxyUrl: `${scheme}://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : urlHost}:${port}`,
        // After an edit, reload right away rather than waiting for the file watcher.
        editor: configPath ? new ConfigEditor(configPath, argv, () => onReload(loadConfigFile(configPath).config)) : undefined,
        profileFromCli: getArgValue(argv, '--profile') !== undefined,
        logger,
      });
    } catch (e) {
      watcher?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw e;
    }
  }

  return {
    url,
    port,
    config: appConfig,
    store,
    uiUrl: ui?.url,
    close: async () => {
      watcher?.close();
      harWriter?.flush();
      await ui?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export type { ConfigFile, YxorpConfig };
