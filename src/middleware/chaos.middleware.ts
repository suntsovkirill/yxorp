import { IncomingMessage, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';
import { Config } from '../services/config.service';
import { LoggerService } from '../services/logger.service';
import { logAccess } from '../utils/access-log';
import { delay } from '../utils/delay';
import { sendErrorResponse } from '../utils/error-response';
import { matchPath } from '../utils/path-pattern';
import { splitUrl } from '../utils/url';
import { ChaosOptions } from '../types/yxorp-config';

const DEFAULT_ERROR_STATUS = 503;

/**
 * Fault injection (`chaos` option) — runs before static/mock/proxy so it
 * affects every kind of response. Per request, in this order: drop the
 * connection (`dropRate`), answer with an error (`errorRate`), or add latency
 * (`delay`) and carry on.
 */
export class ChaosMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private config: Config,
    private logger: LoggerService,
    private random: () => number = Math.random,
  ) {
  }

  public async use(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    const chaos = this.config.get().chaos;

    if (!chaos || !this.applies(chaos, req.url || '/')) {
      return next();
    }

    if (chaos.dropRate && this.random() < chaos.dropRate) {
      logAccess(this.logger, 'chaos', 'drop', req);
      req.socket.destroy();
      return;
    }

    if (chaos.errorRate && this.random() < chaos.errorRate) {
      sendErrorResponse(res, chaos.errorStatus ?? DEFAULT_ERROR_STATUS, 'injected failure (chaos)');
      logAccess(this.logger, 'chaos', res.statusCode, req);
      return;
    }

    await delay(this.latency(chaos.delay));

    return next();
  }

  private applies(chaos: ChaosOptions, url: string): boolean {
    if (!chaos.paths?.length) {
      return true;
    }

    const { pathname } = splitUrl(url);

    return chaos.paths.some((pattern) => {
      try {
        return !!matchPath(pattern, pathname);
      } catch {
        return false;
      }
    });
  }

  private latency(option: ChaosOptions['delay']): number {
    if (typeof option === 'number') {
      return option;
    }

    if (option) {
      return Math.round(option.min + this.random() * (option.max - option.min));
    }

    return 0;
  }
}
