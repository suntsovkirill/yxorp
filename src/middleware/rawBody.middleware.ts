import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';

export class RawBodyMiddleware implements Middleware<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private logger: LoggerService,
  ) {
  }

  public use(proxyRes: IncomingMessage, _req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    return new Promise((resolve) => {
      const body: Uint8Array[] = [];

      proxyRes.on('data', (chunk: Uint8Array) => {
        body.push(chunk);
      });

      proxyRes.on('end', () => {
        proxyRes.rawBody = Buffer.concat(body);
        next();
        resolve();
      });

      proxyRes.on('error', (err: Error) => {
        // The upstream response stream broke mid-flight — the body we have is
        // incomplete/unreliable. Don't continue through Rewrite/ProxyRes with
        // it (that could produce a broken-but-200-looking response); send a
        // clean error response instead and resolve cleanly so this doesn't
        // surface as an unhandled rejection racing with a normal response.
        this.logger.error(err);

        if (!res.headersSent) {
          res.statusCode = 502;
          res.end();
        }

        resolve();
      });
    });
  }
}
