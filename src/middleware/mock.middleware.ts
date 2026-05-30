import { ServerResponse, IncomingMessage } from 'http';
import mime from 'mime';
import fs from 'fs/promises';
import path from 'path';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';

export class MockMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private logger: LoggerService,
  ) {
  }

  public async use(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    try {
      const mockRule = req?.mockRule;

      if (!mockRule) {
        next();
        return;
      }

      if ('script' in mockRule) {
        const fullPath = path.resolve(mockRule.script);
        delete require.cache[require.resolve(fullPath)];
        const handler = require(fullPath);

        if (typeof handler === 'function') {
          await handler(req, res);

          if (!res.headersSent) {
            res.setHeader('content-type', 'application/json');
          }
        }

        this.logger.info(`mock         ${res.statusCode || 200} ${req.method} ${req.url}`);
        return;
      }

      if ('file' in mockRule) {
        const file = await fs.readFile(path.resolve(mockRule.file));
        const mimeType = mime.getType(path.resolve(mockRule.file));

        res.statusCode = mockRule.statusCode || res.statusCode;

        if (mimeType) {
          res.setHeader('content-type', mimeType);
        }

        res.setHeader('content-length', file.length);
        res.end(file);

        this.logger.info(`mock         ${res.statusCode} ${req.method} ${req.url}`);
        return;
      }

      next();
    } catch (e) {
      this.logger.error(e);
      next();
    }
  }
}
