import fs from 'fs';
import path from 'path';
import { Config } from './services/config.service';
import { LoggerService } from './services/logger.service';
import { RemoteRulesMatcher } from './services/rules-matchers/remote-rules-matcher.service';
import { RewriteRulesMatcher } from './services/rules-matchers/rewrite-rules-matcher.service';
import { MockRulesMatcher } from './services/rules-matchers/mock-rules-matcher.service';
import { createServer } from './services/yxorp-server.service';
import { ConfigFile, YxorpConfig } from './types/yxorp-config';
import { resolveConfig } from './services/config-resolver';
import { watchConfig } from './services/config-watcher';

// --- Config resolution ---
let configDir: string;
let configPath: string;
let config: ConfigFile;

try {
  const resolved = resolveConfig(process.cwd(), process.argv);
  configDir = resolved.configDir;
  configPath = resolved.configPath;
  config = resolved.config;
} catch(e: any) {
  console.error(e.message || e);
  process.exit(1);
}

// Change CWD to config directory so relative paths in config work correctly
if (configDir !== process.cwd()) {
  process.chdir(configDir);
}

function buildProxyConfig(cfg: ConfigFile): YxorpConfig {
  const proxyOptions: Record<string, any> = {
    target: cfg.target,
    changeOrigin: true,
    followRedirects: true,
    secure: false,
    ws: true,
    selfHandleResponse: true,
  };

  if (cfg.proxyHeaders) {
    proxyOptions.headers = cfg.proxyHeaders;
  }

  return { ...cfg, proxyOptions };
}

config?.scripts?.forEach(script => {
  require(path.resolve(script));
});

// Manual composition — no DI container
const logger = new LoggerService();
const appConfig = new Config();
appConfig.set(buildProxyConfig(config));

const mockRulesMatcher = new MockRulesMatcher(appConfig);
const rewriteRulesMatcher = new RewriteRulesMatcher(appConfig);
const remoteRulesMatcher = new RemoteRulesMatcher(appConfig);

const { listen } = createServer(
  appConfig,
  logger,
  rewriteRulesMatcher,
  mockRulesMatcher,
  remoteRulesMatcher,
);

listen(config.proxyPort, () => {
  console.log(`Yxorp server started successfully on http://localhost:${config.proxyPort}`);
});

// --- Config hot-reload ---
watchConfig(
  configPath,
  (newConfig) => {
    appConfig.set(buildProxyConfig(newConfig));
    logger.info('Config reloaded');
  },
  (e: any) => logger.error(`Config reload failed: ${e.message || e}`),
);
