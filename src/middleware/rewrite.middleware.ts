import { Service } from 'typedi';
import { IncomingMessage, ServerResponse } from 'http';
import { SUPPORTED_ENCODING, encodeBuffer, decodeBuffer } from 'http-encoding'
import fs from 'fs/promises';
import path from 'path';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';

type RewriteFunction = (body: Buffer, proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse) => Promise<Buffer> | Buffer;

@Service({
  global: true
})
export class RewriteMiddleware implements Middleware<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private logger: LoggerService,
  ) {
  }

  public async use(proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    const rewriteRule = req?.rewriteRule;

    try {
      if (!rewriteRule) {
        next();
        return;
      }

      const encoding = proxyRes.headers['content-encoding'] as SUPPORTED_ENCODING;
      const response: Buffer = proxyRes.rawBody || Buffer.from('');

      if ('script' in rewriteRule) {
        const file = await fs.readFile(path.resolve(rewriteRule.script));
        const encodedResponse = await decodeBuffer(response, encoding);
        const func = new Function('body, proxyRes, req, res', 'var result;' + file + ';return result;') as RewriteFunction;

        const rewritedResponse: Buffer = await func(encodedResponse, proxyRes, req, res);
        proxyRes.rawBody = await encodeBuffer(rewritedResponse, encoding);

        this.logger.info(`[REWRITE BY SCRIPT] ${proxyRes.statusCode} ${req.url}`);

        next();
        return;
      }

      if ('file' in rewriteRule) {
        const file = await fs.readFile(path.resolve(rewriteRule.file));
        proxyRes.rawBody = await encodeBuffer(file, encoding);
        res.statusCode = rewriteRule.statusCode || res.statusCode;

        this.logger.info(`[REWRITE BY FILE] ${proxyRes.statusCode} ${req.url}`);

        next();
        return;
      }

      next();
    } catch (e) {
      this.logger.error(e);
      next();
    }
  }

}
