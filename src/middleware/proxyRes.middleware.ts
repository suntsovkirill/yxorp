import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';
import { formatAccessLog } from '../utils/access-log';
import { isHopByHopHeader } from '../utils/headers';

export class ProxyResMiddleware implements Middleware<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private logger: LoggerService,
  ) {
  }

  public use(proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse): void {
    try {
      // Hop-by-hop headers (incl. transfer-encoding, since we reconstruct the
      // body with a known length) must not be forwarded to the client.
      for (let key in proxyRes.headers) {
        if (isHopByHopHeader(key, proxyRes.headers)) continue;
        res.setHeader(key, proxyRes.headers[key] as any);
      }

      res.statusCode = proxyRes.statusCode as number;
      res.statusMessage = proxyRes.statusMessage as string;

      const response: Buffer = proxyRes.rawBody || Buffer.from('');

      res.removeHeader('content-length');
      res.setHeader('content-length', response.length);
      res.end(response);

      // RewriteMiddleware already logs rewritten responses (success AND failure —
      // it sets req.rewriteLogged in both cases) — log here only for plain
      // pass-through, so every proxied request gets exactly one log line.
      if (!req.rewriteLogged) {
        this.logger.info(formatAccessLog('proxy', res.statusCode, req));
      }
    } catch(e) {
      this.logger.error(e);
    }
  }
}
