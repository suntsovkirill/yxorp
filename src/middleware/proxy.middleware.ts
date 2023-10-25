import { Service } from 'typedi';
import { IncomingMessage, ServerResponse } from 'http';
import { HttpProxy } from '../services/http-proxy.service';
import { RemoteRulesMatcher } from '../services/rules-matchers/remote-rules-matcher.service';
import { Config } from '../services/config.service';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';


@Service({
  global: true
})
export class ProxyMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private httpProxy: HttpProxy,
    private remoteRulesMatcher: RemoteRulesMatcher,
    private config: Config,
    private logger: LoggerService,
  ) {
  }

  public use(req: IncomingMessage, res: ServerResponse) {
    const url = req.url || '';

    const proxyOptions = this.config.get().proxyOptions;
    const remoteRule = this.remoteRulesMatcher.match(url);
    const target = remoteRule
      ? this.remoteRulesMatcher.toPath(url, remoteRule)
      : undefined;

    const options = {
      ...proxyOptions,
      prependPath: !target,
      target: target || proxyOptions.target,
    };

    this.httpProxy.web(
      req, res, options, (error) => this.logger.error(error)
    );
  }

}
