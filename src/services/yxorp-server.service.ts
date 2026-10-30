import { IncomingMessage, ServerResponse } from 'http';
import { Duplex } from 'stream';
import { HttpServer } from './http-server.service';
import { HttpProxy } from './http-proxy.service';
import { RemoteRulesMatcher, RemoteTarget } from './rules-matchers/remote-rules-matcher.service';
import { RewriteRulesMatcher } from './rules-matchers/rewrite-rules-matcher.service';
import { MockRulesMatcher } from './rules-matchers/mock-rules-matcher.service';
import { Config } from './config.service';
import { LoggerService } from './logger.service';
import { Pipeline } from './pipeline.service';
import { BootstrapMiddleware } from '../middleware/bootstrap.middleware';
import { StreamMiddleware } from '../middleware/stream.middleware';
import { RawBodyMiddleware } from '../middleware/rawBody.middleware';
import { ProxyResMiddleware } from '../middleware/proxyRes.middleware';
import { RewriteMiddleware } from '../middleware/rewrite.middleware';
import { ProxyMiddleware } from '../middleware/proxy.middleware';
import { MockMiddleware } from '../middleware/mock.middleware';
import { StaticMiddleware } from '../middleware/static.middleware';
import { describeError, sendErrorResponse } from '../utils/error-response';
import { formatAccessLog } from '../utils/access-log';

export function createServer(
  config: Config,
  logger: LoggerService,
  rewriteRulesMatcher: RewriteRulesMatcher,
  mockRulesMatcher: MockRulesMatcher,
  remoteRulesMatcher: RemoteRulesMatcher,
): {
  server: HttpServer;
  listen: (port: string | number, callback?: () => void) => void;
} {
  // 1. Proxy pipeline (outgoing responses) — no deps on proxy/server
  const proxyPipeline = new Pipeline<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]>();
  proxyPipeline.use(
    new StreamMiddleware(logger),
    new RawBodyMiddleware(logger),
    new RewriteMiddleware(logger),
    new ProxyResMiddleware(logger),
  );

  // 2. HttpProxy wraps the proxy pipeline
  const proxy = new HttpProxy(proxyPipeline);

  // 3. Server pipeline (incoming requests)
  const serverPipeline = new Pipeline<[req: IncomingMessage, res: ServerResponse]>();
  serverPipeline.use(
    new StaticMiddleware(config, logger),
    new BootstrapMiddleware(rewriteRulesMatcher, mockRulesMatcher, logger),
    new MockMiddleware(logger),
    new ProxyMiddleware(proxy, remoteRulesMatcher, config, logger),
  );

  // 4. HttpServer wraps the server pipeline
  const server = new HttpServer(serverPipeline, logger);

  // 5. Attach proxy pipeline to proxyRes event
  proxy.on('proxyRes', (proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse) => {
    // proxy.execute() is async — an uncaught rejection here would otherwise
    // become an unhandled promise rejection and can crash the whole process,
    // leaving the client hanging with no response.
    proxy.execute(proxyRes, req, res).catch((e: any) => {
      logger.error(e);
      sendErrorResponse(res, 502, `failed to process the upstream response: ${describeError(e)}`);
    });
  });

  // 6. WebSocket upgrade handling
  // Record what the upstream answered so the access-log line (written when the
  // connection ends) shows 101 for an upgraded socket, or the upstream's status
  // for a refused upgrade.
  proxy.on('proxyReqWs', (proxyReq, req) => {
    proxyReq.once('upgrade', () => { req.wsStatusCode = 101; });
    proxyReq.once('response', (proxyRes) => { req.wsStatusCode = proxyRes.statusCode; });
  });

  server.addListener('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    req.startTime = Date.now();
    const url = req.url || '';
    const proxyOptions = config.get().proxyOptions;

    let remoteTarget: RemoteTarget | undefined;

    try {
      remoteTarget = remoteRulesMatcher.resolve(url, true);
    } catch (e) {
      // A malformed `remoteRules[].path` pattern would otherwise throw
      // synchronously here on every upgrade — fall back to the default target.
      logger.error(e);
    }

    const options = {
      ...proxyOptions,
      ...remoteTarget,
    };

    // ws() resolves once the client socket closes and rejects if the upstream
    // connection fails — httpxy only half-closes the client socket then
    // (`end()`), which can leave it open, so destroy it. It can also throw
    // synchronously (e.g. a target that isn't a valid URL) — inside this event
    // listener that would be an uncaught exception that crashes the process.
    const onError = (error: unknown) => {
      logger.error(error);
      socket.destroy();
      logger.info(formatAccessLog('ws', req.wsStatusCode ?? 502, req));
    };

    try {
      proxy.ws(req, socket, options, head).then(
        () => logger.info(formatAccessLog('ws', req.wsStatusCode ?? 502, req)),
        onError,
      );
    } catch (error) {
      onError(error);
    }
  });

  const listen = (port: string | number, callback?: () => void) => {
    server.listen(port, callback);
  };

  return { server, listen };
}
