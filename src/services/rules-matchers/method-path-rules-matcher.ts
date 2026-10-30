import { match } from 'path-to-regexp';
import { splitUrl } from '../../utils/url';

export interface MethodPathRule {
  method: string;
  path: string;
  disable?: boolean;
}

/**
 * Shared base for matchers that pick a rule by HTTP method + URL path
 * (MockRulesMatcher, RewriteRulesMatcher) — both used to be byte-for-byte
 * identical aside from the rule type. Subclasses only need to provide the
 * list of candidate rules.
 */
export abstract class MethodPathRulesMatcher<T extends MethodPathRule> {
  protected abstract getRules(): T[];

  public match(url: string, method: string): T | undefined {
    return this.find(url, method)?.rule;
  }

  public params(url: string, rule: T): Record<string, string> | undefined {
    return this.matchPath(rule.path, splitUrl(url).pathname)?.params;
  }

  /**
   * Finds the matching rule and its path params in a single pass — avoids
   * compiling/running the path-to-regexp matcher twice (once via `match()`,
   * again via `params()`) for the same url+rule, as BootstrapMiddleware does.
   */
  public matchWithParams(url: string, method: string): { rule: T; params: Record<string, string> } | undefined {
    const found = this.find(url, method);
    return found ? { rule: found.rule, params: found.matchResult.params } : undefined;
  }

  private find(url: string, method: string): { rule: T; matchResult: { params: Record<string, string> } } | undefined {
    // Patterns describe paths only — a query string would make them miss.
    const { pathname } = splitUrl(url);

    for (const rule of this.getRules()) {
      if (rule.disable) {
        continue;
      }

      if (rule.method.toLowerCase() !== method.toLowerCase()) {
        continue;
      }

      const matchResult = this.matchPath(rule.path, pathname);

      if (matchResult) {
        return { rule, matchResult };
      }
    }
  }

  private matchPath(path: string, pathname: string): { params: Record<string, string> } | undefined {
    const matchResult = match<Record<string, string>>(path, {
      decode: decodeURIComponent,
    })(pathname);

    return matchResult || undefined;
  }
}
