import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';

export class RawBodyMiddleware implements Middleware<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]> {
  public use(proxyRes: IncomingMessage, _req: IncomingMessage, _res: ServerResponse, next: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
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
        proxyRes.rawBody = Buffer.concat(body);
        next();
        reject(err);
      });
    });
  }
}
