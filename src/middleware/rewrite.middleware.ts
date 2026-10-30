import { IncomingMessage, ServerResponse } from 'http';
import { SUPPORTED_ENCODING, encodeBuffer, decodeBuffer } from 'http-encoding';
import path from 'path';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';
import { logAccess } from '../utils/access-log';
import { loadScript } from '../services/script-loader';
import { delay } from '../utils/delay';
import { readRuleBody } from '../utils/rule-body';

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

      await delay(rewriteRule.delay);

      const encoding = proxyRes.headers['content-encoding'] as SUPPORTED_ENCODING;
      const response: Buffer = proxyRes.rawBody || Buffer.from('');

      if ('script' in rewriteRule) {
        const fullPath = path.resolve(rewriteRule.script);
        const handler = await loadScript(fullPath);

        if (typeof handler !== 'function') {
          // Same mistake MockMiddleware guards against (`exports.handler = ...`
          // instead of `module.exports = ...`) — say so instead of silently
          // passing the response through.
          this.logger.error(`Rewrite script "${fullPath}" does not export a function (module.exports = (body, proxyRes, req, res) => {...} or export default) — response passed through unchanged`);
        } else {
          const decodedResponse = await decodeBuffer(response, encoding);
          const rewrittenBody = toResponseBody(await handler(decodedResponse, proxyRes, req, res));

          if (rewrittenBody === undefined) {
            this.logger.warn(`Rewrite script "${fullPath}" returned nothing — response passed through unchanged`);
          } else {
            proxyRes.rawBody = await encodeBuffer(rewrittenBody, encoding);
          }
        }
      } else {
        const source = await readRuleBody(rewriteRule);

        if (source) {
          proxyRes.rawBody = await encodeBuffer(source.body, encoding);

          // An inline `json` body is known to be JSON; for `file`/`body` the
          // upstream content type is kept (override it with `headers`).
          if ('json' in rewriteRule && source.contentType) {
            proxyRes.headers['content-type'] = source.contentType;
          }
        }
      }

      if (rewriteRule.statusCode) {
        proxyRes.statusCode = rewriteRule.statusCode;
      }

      for (const [name, value] of Object.entries(rewriteRule.headers || {})) {
        proxyRes.headers[name.toLowerCase()] = value;
      }

      this.logRewrite(req, proxyRes);

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
    logAccess(this.logger, 'rewrite', proxyRes.statusCode, req);
  }
}

/**
 * Turns a rewrite script's return value into a response body: a Buffer or
 * Uint8Array as is, a string as UTF-8, anything else JSON-serialized.
 * `undefined`/`null` (e.g. a forgotten `return`) means "no rewrite".
 */
function toResponseBody(value: unknown): Buffer | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  if (typeof value === 'string') {
    return Buffer.from(value, 'utf-8');
  }

  return Buffer.from(JSON.stringify(value), 'utf-8');
}
