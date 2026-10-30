import path from 'path';
import { LoggerService, logLevelFromArgv } from './services/logger.service';
import { resolveConfig } from './services/config-resolver';
import { getArgValue } from './services/cli-overrides';
import { initConfig } from './services/init-config';
import { writeMocksFromOpenApi } from './services/openapi-mocks';
import { startYxorp, YxorpConfigError, YxorpServer } from './app';
import { readVersion } from './utils/version';

const HELP = `Usage: yxorp [options]
       yxorp init [--target <url>] [--port <port>]
       yxorp openapi <spec.json|yaml> [--out <file>] [--base-path <path>]

A local reverse proxy for rewriting, mocking, and debugging API responses.

Commands:
  init               Create a starter yxorp.json in the current directory
  openapi <spec>     Generate mock rules from an OpenAPI/Swagger spec (default: openapi-mocks.json)

Options:
  --config <path>    Config file (default: ./yxorp.json, then ./.yxorp/settings.json)
  --port <port>      Override "proxyPort" from the config
  --target <url>     Override "target" from the config
  --host <host>      Override "host" (default 127.0.0.1; 0.0.0.0 to accept other devices)
  --quiet            Log only warnings and errors
  --verbose          Log debug details (matched rules, proxy targets, error stacks)
  --har <file>       Save all traffic (headers and bodies) to a HAR file
  --record <dir>     Save proxied responses to <dir> plus mock rules replaying them (recorded.json)
  --ui [port]        Start the web UI on http://127.0.0.1:<port> (default 4040)
  -v, --version      Print the version
  -h, --help         Print this help

Docs: https://github.com/suntsovkirill/yxorp#readme`;

const SHUTDOWN_TIMEOUT_MS = 5000;

/** `--ui` → true, `--ui 5050` / `--ui=5050` → { port: 5050 }, absent → undefined (the config decides). */
function parseUiFlag(argv: string[]): boolean | { port: number } | undefined {
  const value = getArgValue(argv, '--ui');

  if (value !== undefined && /^\d+$/.test(value)) {
    return { port: Number(value) };
  }

  return argv.includes('--ui') || value !== undefined ? true : undefined;
}

async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  const version = readVersion();

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(version);
    return;
  }

  if (argv[2] === 'init') {
    const created = initConfig(process.cwd(), argv, version);
    console.log(`Created ${created} — edit "target", then run yxorp`);
    return;
  }

  if (argv[2] === 'openapi') {
    const spec = argv[3];

    if (!spec || spec.startsWith('--')) {
      throw new Error('Usage: yxorp openapi <spec.json|yaml> [--out <file>] [--base-path <path>]');
    }

    const out = path.resolve(getArgValue(argv, '--out') ?? 'openapi-mocks.json');
    const { mockRules, skipped } = writeMocksFromOpenApi(path.resolve(spec), out, { basePath: getArgValue(argv, '--base-path') });

    console.log(`Wrote ${mockRules.length} mock rule(s) to ${out}`);
    skipped.forEach(reason => console.warn(`Skipped ${reason}`));
    const relative = path.relative(process.cwd(), out).split(path.sep).join('/');
    console.log(`Use them by adding "${relative.startsWith('.') ? relative : `./${relative}`}" to "include" in your config.`);
    return;
  }

  const { configPath, configDir } = resolveConfig(process.cwd(), argv);

  // Resolved against the directory yxorp was started from — before the chdir below.
  const harArg = getArgValue(argv, '--har');
  const recordArg = getArgValue(argv, '--record');
  const har = harArg ? path.resolve(harArg) : undefined;
  const record = recordArg ? path.resolve(recordArg) : undefined;

  // Relative paths in the config resolve against its directory anyway; this
  // keeps scripts that use process.cwd()-relative paths working as before.
  process.chdir(configDir);

  const logger = new LoggerService({ level: logLevelFromArgv(argv) });

  let server: YxorpServer;

  try {
    server = await startYxorp({
      configPath,
      argv,
      logger,
      har,
      record,
      ui: parseUiFlag(argv),
    });
  } catch (e: any) {
    if (e?.code === 'EADDRINUSE') {
      throw new Error(`Port ${e.port} is already in use — set another "proxyPort" or pass --port`, { cause: e });
    }

    throw e;
  }

  console.log(`Yxorp server started successfully on ${server.url}`);

  if (server.uiUrl) console.log(`Web UI: ${server.uiUrl}`);

  if (har) console.log(`Saving traffic to ${har}`);
  if (record) console.log(`Recording proxied responses to ${record}`);

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down...`);

    // close() waits for open connections — keep-alive HTTP sockets and
    // proxied WebSockets can keep it pending indefinitely, so force an exit
    // after a grace period.
    const forceExitTimer = setTimeout(() => {
      logger.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    server.close()
      .then(() => process.exit(0))
      .catch((e) => {
        logger.error(e);
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main(process.argv).catch((e: any) => {
  console.error(e instanceof YxorpConfigError ? e.message : e?.message || e);
  process.exit(1);
});
