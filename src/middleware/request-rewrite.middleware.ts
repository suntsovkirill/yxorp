import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';
import { splitUrl } from '../utils/url';

/**
 * Applies the request rule BootstrapMiddleware picked (`requestRules`) to a
 * request that's about to be proxied: sets/removes headers and query params,
 * and replaces the body (`json`/`body`). Runs after MockMiddleware — mocked
 * requests never reach the target, so there's nothing to change for them.
 */
export class RequestRewriteMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private logger: LoggerService,
  ) {
  }

  public use(req: IncomingMessage, _res: ServerResponse, next: () => void): void | Promise<void> {
    const rule = req.requestRule;

    if (!rule) {
      return next();
    }

    // httpxy copies req.headers into the outgoing request, so editing them here is enough.
    for (const [name, value] of Object.entries(rule.headers || {})) {
      if (value === null) {
        delete req.headers[name.toLowerCase()];
      } else {
        req.headers[name.toLowerCase()] = value;
      }
    }

    if (rule.query && req.url) {
      const { pathname, search } = splitUrl(req.url);
      const params = new URLSearchParams(search);

      for (const [name, value] of Object.entries(rule.query)) {
        if (value === null) {
          params.delete(name);
        } else {
          params.set(name, value);
        }
      }

      const query = params.toString();
      req.originalUrl ??= req.url;
      req.url = query ? `${pathname}?${query}` : pathname;
    }

    if ('json' in rule || 'body' in rule) {
      const body = 'json' in rule ? JSON.stringify(rule.json) : rule.body!;

      // The original body is replaced — drain it so the connection stays usable.
      if (!req.proxyBody) {
        req.resume();
      }

      req.proxyBody = Buffer.from(body, 'utf-8');
      req.headers['content-length'] = String(req.proxyBody.length);
      delete req.headers['transfer-encoding'];

      if ('json' in rule) {
        req.headers['content-type'] = 'application/json';
      }
    }

    this.logger.debug(`${req.method} ${req.originalUrl ?? req.url} changed by request rule ${rule.method} ${rule.path}`);

    return next();
  }
}
