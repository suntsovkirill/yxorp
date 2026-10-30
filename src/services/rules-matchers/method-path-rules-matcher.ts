import { IncomingHttpHeaders } from 'http';
import { splitUrl } from '../../utils/url';
import { matchPath } from '../../utils/path-pattern';
import { RuleMatch } from '../../types/yxorp-config';

export interface MethodPathRule {
  method: string;
  path: string;
  match?: RuleMatch;
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

  public match(url: string, method: string, headers: IncomingHttpHeaders = {}, body?: unknown): T | undefined {
    return this.find(url, method, headers, body)?.rule;
  }

  /** Whether any enabled rule needs the request body to decide (`match.body`). */
  public needsBody(): boolean {
    return this.getRules().some(rule => !rule.disable && rule.match?.body !== undefined);
  }

  public params(url: string, rule: T): Record<string, string> | undefined {
    return matchPath(rule.path, splitUrl(url).pathname)?.params;
  }

  /**
   * Finds the matching rule and its path params in a single pass — avoids
   * compiling/running the path-to-regexp matcher twice (once via `match()`,
   * again via `params()`) for the same url+rule, as BootstrapMiddleware does.
   */
  public matchWithParams(
    url: string,
    method: string,
    headers: IncomingHttpHeaders = {},
    body?: unknown,
  ): { rule: T; params: Record<string, string> } | undefined {
    const found = this.find(url, method, headers, body);
    return found ? { rule: found.rule, params: found.matchResult.params } : undefined;
  }

  private find(
    url: string,
    method: string,
    headers: IncomingHttpHeaders,
    body: unknown,
  ): { rule: T; matchResult: { params: Record<string, string> } } | undefined {
    // Patterns describe paths only — a query string would make them miss. The
    // query takes part only through a rule's `match.query` conditions.
    const { pathname, search } = splitUrl(url);
    let query: URLSearchParams | undefined;

    for (const rule of this.getRules()) {
      if (rule.disable) {
        continue;
      }

      if (rule.method.toLowerCase() !== method.toLowerCase()) {
        continue;
      }

      const matchResult = matchPath(rule.path, pathname);

      if (!matchResult) {
        continue;
      }

      if (rule.match) {
        query ??= new URLSearchParams(search);

        if (!matchesConditions(rule.match, query, headers, body)) {
          continue;
        }
      }

      return { rule, matchResult };
    }
  }
}

/**
 * Every `match.query` param and `match.headers` header must be present with
 * exactly the given value (for a repeated param/header, any of its values).
 */
function matchesConditions(match: RuleMatch, query: URLSearchParams, headers: IncomingHttpHeaders, body: unknown): boolean {
  for (const [name, expected] of Object.entries(match.query || {})) {
    if (!query.getAll(name).includes(expected)) {
      return false;
    }
  }

  for (const [name, expected] of Object.entries(match.headers || {})) {
    const actual = headers[name.toLowerCase()];
    const values = Array.isArray(actual) ? actual : actual === undefined ? [] : [actual];

    if (!values.includes(expected)) {
      return false;
    }
  }

  return match.body === undefined || matchesPartially(match.body, body);
}

/**
 * `expected` is contained in `actual`: objects match when every key of
 * `expected` matches (extra keys in `actual` are fine), arrays element by
 * element with the same length, anything else by strict equality.
 */
export function matchesPartially(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => matchesPartially(item, actual[index]));
  }

  if (expected && typeof expected === 'object') {
    return !!actual && typeof actual === 'object' && !Array.isArray(actual) &&
      Object.entries(expected).every(([key, value]) => matchesPartially(value, (actual as Record<string, unknown>)[key]));
  }

  return expected === actual;
}
