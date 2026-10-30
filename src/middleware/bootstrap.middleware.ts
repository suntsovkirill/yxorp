import { IncomingMessage, ServerResponse } from 'http';
import qs from 'qs';
import { Middleware } from '../services/pipeline.service';
import { RewriteRulesMatcher } from '../services/rules-matchers/rewrite-rules-matcher.service';
import { MockRulesMatcher } from '../services/rules-matchers/mock-rules-matcher.service';
import { RequestRulesMatcher } from '../services/rules-matchers/request-rules-matcher.service';
import { LoggerService } from '../services/logger.service';
import { MethodPathRule, MethodPathRulesMatcher } from '../services/rules-matchers/method-path-rules-matcher';
import { readRequestBody } from '../utils/request-body';

// A request body larger than this isn't read for `match.body` — rules with
// body conditions just don't match it.
const MAX_MATCH_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Picks the mock, rewrite and request rules for the request (path params
 * included) and parses its query string. When any rule has a `match.body`
 * condition, the request body is read first so it can be matched — the read
 * body is then replayed to the target (`req.proxyBody`) and to mock scripts'
 * body readers.
 */
export class BootstrapMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private rewriteRulesMatcher: RewriteRulesMatcher,
    private mockRulesMatcher: MockRulesMatcher,
    private requestRulesMatcher: RequestRulesMatcher,
    private logger: LoggerService,
  ) {
  }

  public async use(req: IncomingMessage, _res: ServerResponse, next: () => void): Promise<void> {
    try {
      await this.readBodyIfNeeded(req);

      req.rewriteRule = this.findRule(req, this.rewriteRulesMatcher, 'rewrite', (rule, params) => { req.rewriteRuleParams = params; return rule; });
      req.mockRule = this.findRule(req, this.mockRulesMatcher, 'mock', (rule, params) => { req.mockRuleParams = params; return rule; });
      req.requestRule = this.findRule(req, this.requestRulesMatcher, 'request', rule => rule);
      this.setQueryParams(req);
    } catch (e) {
      this.logger.error(e);
    }

    return next();
  }

  private async readBodyIfNeeded(req: IncomingMessage): Promise<void> {
    const hasBody = req.headers['content-length'] !== undefined
      ? Number(req.headers['content-length']) > 0
      : req.headers['transfer-encoding'] !== undefined;

    const needed = hasBody && [this.mockRulesMatcher, this.rewriteRulesMatcher, this.requestRulesMatcher]
      .some((matcher: MethodPathRulesMatcher<MethodPathRule>) => matcher.needsBody());

    if (!needed || Number(req.headers['content-length'] ?? 0) > MAX_MATCH_BODY_BYTES) {
      return;
    }

    const body = await readRequestBody(req);
    req.proxyBody = body;

    try {
      req.parsedBody = JSON.parse(body.toString('utf-8'));
    } catch {
      // Not JSON — `match.body` conditions just won't match.
    }
  }

  // matchWithParams() finds the rule and decodes its path params in a single
  // pass — match() + params() back to back would compile/run path-to-regexp twice.
  private findRule<T extends MethodPathRule, R>(
    req: IncomingMessage,
    matcher: MethodPathRulesMatcher<T>,
    kind: string,
    use: (rule: T, params: Record<string, string>) => R,
  ): R | undefined {
    if (!req.url || !req.method) {
      return undefined;
    }

    const matched = matcher.matchWithParams(req.url, req.method, req.headers, req.parsedBody);

    if (!matched) {
      return undefined;
    }

    this.logger.debug(`${req.method} ${req.url} matched ${kind} rule ${matched.rule.method} ${matched.rule.path}`);
    return use(matched.rule, matched.params || {});
  }

  private setQueryParams(req: IncomingMessage): void {
    if (!req.url) {
      return;
    }

    const url = new URL(req.url, 'http://fake.com');
    req.query = qs.parse(url.search, {
      ignoreQueryPrefix: true,
    });
  }
}
