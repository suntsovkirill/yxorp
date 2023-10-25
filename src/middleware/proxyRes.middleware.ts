import { Service } from 'typedi';
import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';


@Service({
  global: true
})
export class ProxyResMiddleware implements Middleware<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private logger: LoggerService,
  ) {
  }

  public use(proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse): void {
    try {
      for (let key in proxyRes.headers) {
        res.setHeader(key, proxyRes.headers[key] as any);
      }

      res.statusCode = proxyRes.statusCode as number;
      res.statusMessage = proxyRes.statusMessage as string;

      const response: Buffer = proxyRes.rawBody || Buffer.from('');

      res.setHeader('content-length', response.length);
      res.end(response);
    } catch(e) {
      this.logger.error(e);
    }
  }

}
