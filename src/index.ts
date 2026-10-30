import fs from 'fs';
import path from 'path';
import { Config } from './services/config.service';
import { LoggerService, logLevelFromArgv } from './services/logger.service';
import { RemoteRulesMatcher } from './services/rules-matchers/remote-rules-matcher.service';
import { RewriteRulesMatcher } from './services/rules-matchers/rewrite-rules-matcher.service';
import { MockRulesMatcher } from './services/rules-matchers/mock-rules-matcher.service';
import { createServer } from './services/yxorp-server.service';
import { ConfigFile } from './types/yxorp-config';
import { resolveConfig } from './services/config-resolver';
import { watchConfig } from './services/config-watcher';
import { findConfigWarnings, validateConfig } from './services/config-validator';
import { applyCliOverrides, getArgValue } from './services/cli-overrides';
import { buildProxyConfig } from './services/proxy-config';
import { createConfigReloadHandler } from './services/config-reload';
import { HarWriter } from './services/har-writer';
import { initConfig } from './services/init-config';
import { Recorder } from './services/recorder';
import { CaptureListener } from './middleware/capture.middleware';

// --- Help flag ---
const HELP = `Usage: yxorp [options]
       yxorp init [--target <url>] [--port <port>]

A local reverse proxy for rewriting, mocking, and debugging API responses.

Commands:
  init               Create a starter yxorp.json in the current directory

Options:
  --config <path>    Config file (default: ./yxorp.json, then ./.yxorp/settings.json)
  --port <port>      Override "proxyPort" from the config
  --target <url>     Override "target" from the config
  --quiet            Log only warnings and errors
  --verbose          Log debug details (matched rules, proxy targets, error stacks)
  --har <file>       Save all traffic (headers and bodies) to a HAR file
  --record <dir>     Save proxied responses to <dir> plus mock rules replaying them (recorded.json)
  -v, --version      Print the version
  -h, --help         Print this help

Docs: https://github.com/suntsovkirill/yxorp#readme`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

// --- Version flag ---
const version: string = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')).version;

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(version);
  process.exit(0);
}

// --- init command ---
if (process.argv[2] === 'init') {
  try {
    const created = initConfig(process.cwd(), process.argv, version);
    console.log(`Created ${created} — edit "target", then run yxorp`);
    process.exit(0);
  } catch (e: any) {
    console.error(e.message || e);
    process.exit(1);
  }
}

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

// --- CLI overrides ---
// e.g. `yxorp --port 4000 --target http://localhost:8080` — flags win over config values.
config = applyCliOverrides(config, process.argv);

const configErrors = validateConfig(config);
if (configErrors.length) {
  console.error('Invalid config:');
  configErrors.forEach(err => console.error(`  - ${err}`));
  process.exit(1);
}

findConfigWarnings(config).forEach(warning => console.warn(`Warning: ${warning}`));

// --- Traffic capture flags ---
// Resolved against the directory yxorp was started from — before the chdir below.
const harArg = getArgValue(process.argv, '--har');
const recordArg = getArgValue(process.argv, '--record');
const harPath = harArg ? path.resolve(harArg) : undefined;
const recordDir = recordArg ? path.resolve(recordArg) : undefined;

// Change CWD to config directory so relative paths in config work correctly
if (configDir !== process.cwd()) {
  process.chdir(configDir);
}

// Manual composition — no DI container
const logger = new LoggerService({ level: logLevelFromArgv(process.argv) });
const appConfig = new Config();
appConfig.set(buildProxyConfig(config));

const mockRulesMatcher = new MockRulesMatcher(appConfig);
const rewriteRulesMatcher = new RewriteRulesMatcher(appConfig);
const remoteRulesMatcher = new RemoteRulesMatcher(appConfig);

const harWriter = harPath ? new HarWriter(harPath, version) : undefined;
const recorder = recordDir ? new Recorder(recordDir, configDir, logger) : undefined;
const capture: CaptureListener[] = [harWriter?.add, recorder?.record].filter((listener) => !!listener);

let created: ReturnType<typeof createServer>;

try {
  created = createServer(
    appConfig,
    logger,
    rewriteRulesMatcher,
    mockRulesMatcher,
    remoteRulesMatcher,
    { capture },
  );
} catch (e: any) {
  // e.g. an unreadable `https.key`/`https.cert` file
  console.error(e.message || e);
  process.exit(1);
}

const { server, listen } = created;

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE'
    ? `Port ${config.proxyPort} is already in use — set another "proxyPort" or pass --port`
    : `Server error: ${e.message}`);
  process.exit(1);
});

listen(config.proxyPort, () => {
  const scheme = config.https ? 'https' : 'http';
  console.log(`Yxorp server started successfully on ${scheme}://localhost:${config.proxyPort}`);

  if (harPath) console.log(`Saving traffic to ${harPath}`);
  if (recordDir) console.log(`Recording proxied responses to ${recordDir}`);
});

// --- Config hot-reload ---
const configWatcher = watchConfig(
  configPath,
  createConfigReloadHandler(appConfig, logger, process.argv),
  (e: any) => logger.error(`Config reload failed: ${e.message || e}`),
);

// --- Graceful shutdown ---
const SHUTDOWN_TIMEOUT_MS = 5000;
let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}, shutting down...`);
  configWatcher.close();

  try {
    harWriter?.flush();
  } catch (e: any) {
    logger.error(`Could not write ${harPath}: ${e.message || e}`);
  }

  // server.close()'s callback only fires once every open connection is
  // closed — keep-alive HTTP sockets and proxied WebSocket connections
  // (proxyOptions has `ws: true`) can keep it pending indefinitely. Force
  // an exit after a grace period so a stuck connection can't hang the process.
  const forceExitTimer = setTimeout(() => {
    logger.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  server.close(() => {
    clearTimeout(forceExitTimer);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
