import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';
import { formatAccessLog } from '../utils/access-log';
import { forwardResponseHeaders } from '../utils/headers';

/**
 * Streams the upstream response straight to the client when no rewrite applies.
 *
 * Buffering the whole body (`RawBodyMiddleware`) only exists to let
 * `RewriteMiddleware` transform it. When there is no rewrite rule there is
 * nothing to transform, so we pipe the upstream response through as it arrives.
 * This is what lets `text/event-stream` (SSE) and long chunked responses reach
 * the client incrementally instead of all at once when the upstream closes, and
 * avoids holding the entire body in memory.
 *
 * When a rewrite rule IS present we fall through (`next()`) to the buffering
 * path, since rewriting needs the complete body.
 */
export class StreamMiddleware implements Middleware<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private logger: LoggerService,
  ) {
  }

  public use(proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse, next: () => void): void | Promise<void> {
    // Rewrite needs the full body — hand off to the buffering path.
    if (req.rewriteRule) {
      return next();
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      proxyRes.on('error', (err: Error) => {
        // The upstream stream broke mid-flight. If nothing has been sent yet we
        // can still return a clean 502; otherwise the client already holds a
        // partial response, so just tear the connection down.
        this.logger.error(err);

        if (!res.headersSent) {
          res.statusCode = 502;
          res.end();
        } else {
          res.destroy();
        }

        done();
      });

      res.on('close', () => {
        // Client went away before the stream finished — stop pulling from the
        // upstream so that connection doesn't leak.
        if (!res.writableEnded) {
          proxyRes.destroy();
        }

        done();
      });

      res.on('finish', () => {
        // Distinct 'stream' label (vs ProxyResMiddleware's 'proxy') so the
        // access log shows which pass-through responses were streamed.
        this.logger.info(formatAccessLog('stream', res.statusCode, req));
        done();
      });

      forwardResponseHeaders(proxyRes, res);
      res.statusCode = proxyRes.statusCode as number;
      res.statusMessage = proxyRes.statusMessage as string;

      // No content-length is set on purpose: the length isn't known up front.
      // If the upstream sent one it was copied above; otherwise Node frames the
      // streamed response with chunked transfer-encoding automatically.
      proxyRes.pipe(res);
    });
  }
}
