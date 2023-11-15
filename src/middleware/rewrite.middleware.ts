import { IncomingMessage, ServerResponse } from 'http';
import { SUPPORTED_ENCODING, encodeBuffer, decodeBuffer } from 'http-encoding';
import fs from 'fs/promises';
import path from 'path';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';

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
        const fullPath = path.resolve(rewriteRule.script);
        delete require.cache[require.resolve(fullPath)];
        const handler = require(fullPath);

        if (typeof handler === 'function') {
          const encodedResponse = await decodeBuffer(response, encoding);
          const rewritedResponse: Buffer = await handler(encodedResponse, proxyRes, req, res);
          proxyRes.rawBody = await encodeBuffer(rewritedResponse, encoding);
        }

        this.logger.info(`rewrite       ${proxyRes.statusCode} ${req.method} ${req.url}`);

        next();
        return;
      }

      if ('file' in rewriteRule) {
        const file = await fs.readFile(path.resolve(rewriteRule.file));
        proxyRes.rawBody = await encodeBuffer(file, encoding);
        if (rewriteRule.statusCode) {
          proxyRes.statusCode = rewriteRule.statusCode;
        }

        this.logger.info(`rewrite       ${proxyRes.statusCode} ${req.method} ${req.url}`);

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
