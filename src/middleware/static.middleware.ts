import { ServerResponse, IncomingMessage } from 'http';
import path from 'path';
import fs from 'fs/promises';
import mime from 'mime';
import { Config } from '../services/config.service';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';
import { elapsedMs } from '../utils/request-timing';
import { StaticRule } from '../types/yxorp-config';

export class StaticMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private config: Config,
    private logger: LoggerService,
  ) {
  }

  public async use(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    try {
      const staticRules = this.config.get().staticRules || [];

      const url = new URL(req.url || '', 'http://fake.com');
      const urlPath = url.pathname;

      const currentStaticRule = staticRules.filter((staticRule) => {
        return urlPath.startsWith(staticRule.path);
      })[0];

      if (!currentStaticRule) {
        next();
        return;
      }

      const filePath = await this.resolveFile(currentStaticRule, urlPath);

      if (!filePath) {
        next();
        return;
      }

      const file = await fs.readFile(filePath);
      const mimeType = mime.getType(filePath);

      if (mimeType) {
        res.setHeader('content-type', mimeType);
      }

      res.setHeader('content-length', file.length);
      res.end(file);

      this.logger.info(`static        ${res.statusCode} ${req.method} ${req.url} ${elapsedMs(req)}ms`);
    } catch (e) {
      this.logger.error(e);
      next();
    }
  }

  /**
   * Resolves a request URL path to an actual file on disk under the rule's
   * directory — without enumerating the whole directory tree on every request
   * (the previous implementation did a full recursive `readdir` per request,
   * the most expensive thing on this hot path).
   *
   * Fast path: build the candidate path directly from the URL and `fs.stat`
   * it — this covers the overwhelming majority of requests (correct case,
   * matches exactly) with zero directory listings.
   *
   * Fallback (only when the fast path misses AND `caseInsensitive` is set):
   * walk down the path segment by segment, listing only the relevant
   * directory at each level and matching case-insensitively — far cheaper
   * than enumerating the entire tree just to find one file.
   */
  private async resolveFile(rule: StaticRule, urlPath: string): Promise<string | undefined> {
    const directory = path.resolve(rule.directory);
    const relativeUrlPath = urlPath.slice(rule.path.length);

    const pathname = path.extname(relativeUrlPath)
      ? relativeUrlPath
      : path.join(relativeUrlPath, rule.directoryIndex || '');

    const segments = pathname.split(/[\\/]+/).filter(Boolean);

    // Defense in depth — `new URL()` already normalizes `..` segments out of
    // urlPath, but reject anything that could still escape `directory`.
    if (segments.includes('..')) {
      return undefined;
    }

    if (segments.length === 0) {
      return undefined;
    }

    const exactPath = path.join(directory, ...segments);

    if (await this.isFile(exactPath)) {
      return exactPath;
    }

    if (!rule.caseInsensitive) {
      return undefined;
    }

    let current = directory;

    for (const segment of segments) {
      const match = await this.findCaseInsensitive(current, segment);

      if (!match) {
        return undefined;
      }

      current = path.join(current, match);
    }

    return (await this.isFile(current)) ? current : undefined;
  }

  private async isFile(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  private async findCaseInsensitive(directory: string, name: string): Promise<string | undefined> {
    try {
      const entries = await fs.readdir(directory);
      return entries.find(entry => entry.toLowerCase() === name.toLowerCase());
    } catch {
      return undefined;
    }
  }
}
