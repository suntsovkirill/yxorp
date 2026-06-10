import { IncomingMessage, ServerResponse } from 'http';
import qs from 'qs';
import { Middleware } from '../services/pipeline.service';
import { RewriteRulesMatcher } from '../services/rules-matchers/rewrite-rules-matcher.service';
import { MockRulesMatcher } from '../services/rules-matchers/mock-rules-matcher.service';
import { LoggerService } from '../services/logger.service';

export class BootstrapMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private rewriteRulesMatcher: RewriteRulesMatcher,
    private mockRulesMatcher: MockRulesMatcher,
    private logger: LoggerService,
  ) {
  }

  public use(req: IncomingMessage, _res: ServerResponse, next: () => void): void {
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

    // matchWithParams() finds the rule and decodes its path params in a single
    // pass — match() + params() back to back would compile/run path-to-regexp twice.
    const matched = this.rewriteRulesMatcher.matchWithParams(req.url, req.method);

    if (matched) {
      req.rewriteRule = matched.rule;
      req.rewriteRuleParams = matched.params || {};
    }
  }

  private setMockRule(req: IncomingMessage): void {
    if (!req.url || !req.method) {
      return;
    }

    const matched = this.mockRulesMatcher.matchWithParams(req.url, req.method);

    if (matched) {
      req.mockRule = matched.rule;
      req.mockRuleParams = matched.params || {};
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
