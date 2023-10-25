import { Service } from 'typedi';
import { ServerResponse, IncomingMessage } from 'http';
import mime from 'mime';
import fs from 'fs/promises';
import path from 'path';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';

@Service({
  global: true
})
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
        const file = await fs.readFile(path.resolve(mockRule.script));

        const func = new Function('req, res', file.toString());
        await func(req, res);

        this.logger.info(`[MOCK BY SCRIPT] ${res.statusCode || 200} ${req.url}`);
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

        this.logger.info(`[MOCK BY FILE] ${res.statusCode} ${req.url}`);
        return;
      }

      next();
    } catch (e) {
      this.logger.error(e);
      next();
    }
  }

}
