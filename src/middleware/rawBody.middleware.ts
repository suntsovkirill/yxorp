import { Service } from 'typedi';
import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';

@Service({
  global: true
})
export class RawBodyMiddleware implements Middleware<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]> {
  public use(proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const body: Uint8Array[] = [];

    proxyRes.on('data', (chunk: Uint8Array) => {
      body.push(chunk);
    });

    proxyRes.on('end', () => {
      proxyRes.rawBody = Buffer.concat(body);
      next();
    });
  }

}
