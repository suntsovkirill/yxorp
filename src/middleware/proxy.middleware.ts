import { IncomingMessage, ServerResponse } from 'http';
import { HttpProxy } from '../services/http-proxy.service';
import { RemoteRulesMatcher } from '../services/rules-matchers/remote-rules-matcher.service';
import { Config } from '../services/config.service';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';

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

    let target: string | undefined;

    try {
      const remoteRule = this.remoteRulesMatcher.match(url);
      target = remoteRule
        ? this.remoteRulesMatcher.toPath(url, remoteRule)
        : undefined;
    } catch (e) {
      // A malformed `remoteRules[].path` pattern would otherwise throw
      // synchronously here on every request — fall back to the default target.
      this.logger.error(e);
    }

    const options = {
      ...proxyOptions,
      prependPath: !target,
      target: target || proxyOptions.target,
    };

    this.httpProxy.web(req, res, options).catch((error: any) => {
      // httpxy rejects web()'s promise when the proxy has no 'error' listener
      // (e.g. target ECONNREFUSED/DNS failure) — without this, the client
      // would otherwise hang forever waiting for a response that never comes.
      this.logger.error(error);

      if (!res.headersSent) {
        res.statusCode = 502;
        res.end();
      }
    });
  }
}
