import { ServerResponse, IncomingMessage } from 'http';
import path from 'path';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';
import { logAccess } from '../utils/access-log';
import { loadScript } from '../services/script-loader';
import { delay } from '../utils/delay';
import { attachBodyReaders } from '../utils/request-body';
import { readRuleBody } from '../utils/rule-body';

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

      await delay(mockRule.delay);

      if ('script' in mockRule) {
        const fullPath = path.resolve(mockRule.script);
        const handler = await loadScript(fullPath);

        if (typeof handler !== 'function') {
          // A script that doesn't export a function (e.g. `exports.handler = ...`
          // instead of `module.exports = ...`) would otherwise leave the request
          // hanging forever — respond with a clear error instead.
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: `Mock script "${mockRule.script}" does not export a function` }));

          this.logger.error(`Mock script "${fullPath}" does not export a function (module.exports = (req, res) => {...} or export default)`);
          logAccess(this.logger, 'mock', res.statusCode, req);
          return;
        }

        // The rule's statusCode/headers are defaults the script can still override.
        if (mockRule.statusCode) {
          res.statusCode = mockRule.statusCode;
        }

        setHeaders(res, mockRule.headers);
        attachBodyReaders(req);

        await handler(req, res);

        if (!res.headersSent && !res.hasHeader('content-type')) {
          res.setHeader('content-type', 'application/json');
        }

        logAccess(this.logger, 'mock', res.statusCode || 200, req);
        return;
      }

      const source = await readRuleBody(mockRule);

      if (source) {
        res.statusCode = mockRule.statusCode || res.statusCode;

        if (source.contentType) {
          res.setHeader('content-type', source.contentType);
        }

        setHeaders(res, mockRule.headers);
        res.setHeader('content-length', source.body.length);
        res.end(source.body);

        logAccess(this.logger, 'mock', res.statusCode, req);
        return;
      }

      next();
    } catch (e) {
      this.logger.error(e);

      // If the script handler already wrote (part of) a response before throwing,
      // calling next() would send the request into ProxyMiddleware/httpProxy.web,
      // which would try to write to an already-finished response.
      if (res.headersSent) {
        logAccess(this.logger, 'mock', res.statusCode, req);

        if (!res.writableEnded) {
          res.end();
        }

        return;
      }

      next();
    }
  }
}

function setHeaders(res: ServerResponse, headers: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(headers || {})) {
    res.setHeader(name, value);
  }
}
