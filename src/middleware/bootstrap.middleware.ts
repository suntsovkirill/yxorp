import { IncomingMessage } from 'http';
import qs from 'qs';
import { Middleware } from '../services/pipeline.service';
import { RewriteRulesMatcher } from '../services/rules-matchers/rewrite-rules-matcher.service';
import { MockRulesMatcher } from '../services/rules-matchers/mock-rules-matcher.service';
import { LoggerService } from '../services/logger.service';

export class BootstrapMiddleware implements Middleware<[req: IncomingMessage, res: any]> {
  constructor(
    private rewriteRulesMatcher: RewriteRulesMatcher,
    private mockRulesMatcher: MockRulesMatcher,
    private logger: LoggerService,
  ) {
  }

  public use(req: IncomingMessage, _res: any, next: () => void): void {
    try {
      this.setRewriteRule(req);
      this.setMockRule(req);
      this.setQueryParams(req);

      next();
    } catch (e) {
      this.logger.error(e);
      next();
    }
  }

  private setRewriteRule(req: IncomingMessage): void {
    if (!req.url || !req.method) {
      return;
    }

    const rewriteRule = this.rewriteRulesMatcher.match(req.url, req.method);

    if (rewriteRule) {
      req.rewriteRule = rewriteRule;

      const rewriteRuleParams = this.rewriteRulesMatcher.params(req.url, rewriteRule);

      if (rewriteRuleParams) {
        req.rewriteRuleParams = rewriteRuleParams || {};
      }
    }
  }

  private setMockRule(req: IncomingMessage): void {
    if (!req.url || !req.method) {
      return;
    }

    const mockRule = this.mockRulesMatcher.match(req.url, req.method);

    if (mockRule) {
      req.mockRule = mockRule;

      const mockRuleParams = this.mockRulesMatcher.params(req.url, mockRule);

      if (mockRuleParams) {
        req.mockRuleParams = mockRuleParams || {};
      }
    }
  }

  private setQueryParams(req: IncomingMessage): void {
    if (!req.url) {
      return;
    }

    const url = new URL(req.url, 'http://fake.com');
    const query = qs.parse(url.search, {
      ignoreQueryPrefix: true,
    });

    req.query = query;
  }
}
