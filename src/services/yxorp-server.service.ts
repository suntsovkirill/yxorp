import { IncomingMessage, ServerResponse } from 'http';
import { Duplex } from 'stream';
import { HttpServer } from './http-server.service';
import { HttpProxy } from './http-proxy.service';
import { RemoteRulesMatcher } from './rules-matchers/remote-rules-matcher.service';
import { RewriteRulesMatcher } from './rules-matchers/rewrite-rules-matcher.service';
import { MockRulesMatcher } from './rules-matchers/mock-rules-matcher.service';
import { Config } from './config.service';
import { LoggerService } from './logger.service';
import { Pipeline } from './pipeline.service';
import { BootstrapMiddleware } from '../middleware/bootstrap.middleware';
import { RawBodyMiddleware } from '../middleware/rawBody.middleware';
import { ProxyResMiddleware } from '../middleware/proxyRes.middleware';
import { RewriteMiddleware } from '../middleware/rewrite.middleware';
import { ProxyMiddleware } from '../middleware/proxy.middleware';
import { MockMiddleware } from '../middleware/mock.middleware';
import { StaticMiddleware } from '../middleware/static.middleware';

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
    new RawBodyMiddleware(),
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
  const server = new HttpServer(serverPipeline);

  // 5. Attach proxy pipeline to proxyRes event
  proxy.on('proxyRes', ((proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse) => {
    proxy.execute(proxyRes, req, res);
  }) as any);

  // 6. WebSocket upgrade handling
  server.addListener('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || '';
    const proxyOptions = config.get().proxyOptions;
    const remoteRule = remoteRulesMatcher.match(url, true);
    const target = remoteRule
      ? remoteRulesMatcher.toPath(url, remoteRule)
      : undefined;

    const options = {
      ...proxyOptions,
      prependPath: !target,
      target: target || proxyOptions.target,
    };

    proxy.ws(req, socket, options, head).catch((error: any) => logger.info(error));
  });

  const listen = (port: string | number, callback?: () => void) => {
    server.listen(port, callback);
  };

  return { server, listen };
}
