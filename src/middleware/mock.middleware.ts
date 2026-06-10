import { ServerResponse, IncomingMessage } from 'http';
import mime from 'mime';
import fs from 'fs/promises';
import path from 'path';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';
import { formatAccessLog } from '../utils/access-log';

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

        if (typeof handler !== 'function') {
          // A script that doesn't export a function (e.g. `exports.handler = ...`
          // instead of `module.exports = ...`) would otherwise leave the request
          // hanging forever — respond with a clear error instead.
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: `Mock script "${mockRule.script}" does not export a function` }));

          this.logger.error(`Mock script "${fullPath}" does not export a function (module.exports = (req, res) => {...})`);
          this.logger.info(formatAccessLog('mock', res.statusCode, req));
          return;
        }

        await handler(req, res);

        if (!res.headersSent) {
          res.setHeader('content-type', 'application/json');
        }

        this.logger.info(formatAccessLog('mock', res.statusCode || 200, req));
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

        this.logger.info(formatAccessLog('mock', res.statusCode, req));
        return;
      }

      next();
    } catch (e) {
      this.logger.error(e);

      // If the script handler already wrote (part of) a response before throwing,
      // calling next() would send the request into ProxyMiddleware/httpProxy.web,
      // which would try to write to an already-finished response.
      if (res.headersSent) {
        this.logger.info(formatAccessLog('mock', res.statusCode, req));

        if (!res.writableEnded) {
          res.end();
        }

        return;
      }

      next();
    }
  }
}
