import { Service } from 'typedi';
import { IncomingMessage, ServerResponse } from 'http';
import { Duplex } from 'stream';
import { BootstrapMiddleware } from '../middleware/bootstrap.middleware';
import { ProxyMiddleware } from '../middleware/proxy.middleware';
import { RawBodyMiddleware } from '../middleware/rawBody.middleware';
import { ProxyResMiddleware } from '../middleware/proxyRes.middleware';
import { RewriteMiddleware } from '../middleware/rewrite.middleware';
import { MockMiddleware } from '../middleware/mock.middleware';
import { StaticMiddleware } from '../middleware/static.middleware';
import { HttpServer } from './http-server.service';
import { HttpProxy } from './http-proxy.service';
import { RemoteRulesMatcher } from './rules-matchers/remote-rules-matcher.service';
import { Config } from './config.service';
import { LoggerService } from './logger.service';


@Service({
  global: true
})
export class YxorpServer {
  constructor(
    private httpServer: HttpServer,
    private httpProxy: HttpProxy,
    private remoteRulesMatcher: RemoteRulesMatcher,
    private config: Config,
    private logger: LoggerService,
  ) {
    this.httpServer.use(
      StaticMiddleware,
      BootstrapMiddleware,
      MockMiddleware,
      ProxyMiddleware
    );
    this.httpProxy.use(
      BootstrapMiddleware,
      RawBodyMiddleware,
      RewriteMiddleware,
      ProxyResMiddleware,
    );

    this.httpProxy.on('proxyRes', this.onProxyRes);
    this.httpServer.addListener('upgrade', this.onServerUpgrade);
  }

  private onProxyRes = (proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse) => {
    this.httpProxy.execute(proxyRes, req, res);
  }

  private onServerUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = req.url || '';

    const proxyOptions = this.config.get().proxyOptions;
    const remoteRule = this.remoteRulesMatcher.match(url, true);
    const target = remoteRule
      ? this.remoteRulesMatcher.toPath(url, remoteRule)
      : undefined;

    const options = {
      ...proxyOptions,
      prependPath: !target,
      target: target || proxyOptions.target,
    }

    this.httpProxy.ws(
      req, socket, head, options, (error) => this.logger.info(error)
    );
  }

  public listen = this.httpServer.listen.bind(this.httpServer) as typeof this.httpServer.listen;

}

