import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';
import { elapsedMs } from '../utils/request-timing';

export class ProxyResMiddleware implements Middleware<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private logger: LoggerService,
  ) {
  }

  public use(proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse): void {
    try {
      // Skip transfer-encoding since we reconstruct the body with known length
      for (let key in proxyRes.headers) {
        if (key === 'transfer-encoding') continue;
        res.setHeader(key, proxyRes.headers[key] as any);
      }

      res.statusCode = proxyRes.statusCode as number;
      res.statusMessage = proxyRes.statusMessage as string;

      const response: Buffer = proxyRes.rawBody || Buffer.from('');

      res.removeHeader('content-length');
      res.setHeader('content-length', response.length);
      res.end(response);

      // RewriteMiddleware already logs rewritten responses — log here only for plain pass-through,
      // so every proxied request gets exactly one log line.
      if (!req.rewriteRule) {
        this.logger.info(`proxy         ${res.statusCode} ${req.method} ${req.url} ${elapsedMs(req)}ms`);
      }
    } catch(e) {
      this.logger.error(e);
    }
  }
}
