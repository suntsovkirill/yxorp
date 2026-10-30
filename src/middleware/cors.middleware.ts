import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';
import { Config } from '../services/config.service';
import { LoggerService } from '../services/logger.service';
import { logAccess } from '../utils/access-log';
import { CorsOptions } from '../types/yxorp-config';

const DEFAULT_MAX_AGE = 600;

/**
 * Makes the proxy usable cross-origin from a local frontend (`"cors": true`):
 * answers preflight `OPTIONS` requests itself, and sets CORS headers on every
 * response — mocked, static, proxied or an error. On proxied responses these
 * win over any CORS headers the target sends (see `forwardResponseHeaders`),
 * since the target's (e.g. production-only) allowed origins rarely include
 * localhost.
 */
export class CorsMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private config: Config,
    private logger: LoggerService,
  ) {
  }

  public use(req: IncomingMessage, res: ServerResponse, next: () => void): void | Promise<void> {
    const cors = this.config.get().cors;
    const origin = req.headers.origin;

    if (!cors || !origin) {
      return next();
    }

    const options: CorsOptions = cors === true ? {} : cors;

    if (!isAllowedOrigin(origin, options.origin)) {
      return next();
    }

    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');

    if (options.credentials !== false) {
      res.setHeader('access-control-allow-credentials', 'true');
    }

    if (options.exposeHeaders?.length) {
      res.setHeader('access-control-expose-headers', options.exposeHeaders.join(', '));
    }

    const requestedMethod = req.headers['access-control-request-method'];

    if (req.method !== 'OPTIONS' || !requestedMethod) {
      return next();
    }

    // Preflight: allow exactly what the browser asks for.
    res.setHeader('access-control-allow-methods', requestedMethod);

    const requestedHeaders = req.headers['access-control-request-headers'];

    if (requestedHeaders) {
      res.setHeader('access-control-allow-headers', requestedHeaders);
    }

    res.setHeader('access-control-max-age', String(options.maxAge ?? DEFAULT_MAX_AGE));
    res.statusCode = 204;
    res.end();

    logAccess(this.logger, 'cors', res.statusCode, req);
  }
}

function isAllowedOrigin(origin: string, allowed: string | string[] | undefined): boolean {
  if (allowed === undefined) {
    return true;
  }

  const list = Array.isArray(allowed) ? allowed : [allowed];
  return list.includes('*') || list.includes(origin);
}
