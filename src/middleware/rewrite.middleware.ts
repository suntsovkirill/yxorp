import { IncomingMessage, ServerResponse } from 'http';
import { SUPPORTED_ENCODING, encodeBuffer, decodeBuffer } from 'http-encoding';
import fs from 'fs/promises';
import path from 'path';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';
import { formatAccessLog } from '../utils/access-log';

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

        this.logRewrite(req, proxyRes);

        next();
        return;
      }

      if ('file' in rewriteRule) {
        const file = await fs.readFile(path.resolve(rewriteRule.file));
        proxyRes.rawBody = await encodeBuffer(file, encoding);
        if (rewriteRule.statusCode) {
          proxyRes.statusCode = rewriteRule.statusCode;
        }

        this.logRewrite(req, proxyRes);

        next();
        return;
      }

      next();
    } catch (e) {
      this.logger.error(e);

      // Even on failure the response still goes out via ProxyResMiddleware —
      // make sure the request still gets exactly one access-log line.
      this.logRewrite(req, proxyRes);

      next();
    }
  }

  /**
   * Logs the access line for a rewritten response and marks the request as
   * logged, so ProxyResMiddleware (which would otherwise also log plain
   * pass-through responses) knows to stay silent — including on the error path
   * above, where the rewrite itself failed but the response still went out.
   */
  private logRewrite(req: IncomingMessage, proxyRes: IncomingMessage): void {
    req.rewriteLogged = true;
    this.logger.info(formatAccessLog('rewrite', proxyRes.statusCode, req));
  }
}
