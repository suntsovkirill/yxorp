import { Config } from '../config.service';
import { match, compile } from 'path-to-regexp';
import { RemoteRule } from '../../types/yxorp-config';
import { splitUrl } from '../../utils/url';

/**
 * httpxy options that route a request to a remote rule's target.
 */
export interface RemoteTarget {
  target: string;
  // When true the outgoing path is taken from `target` alone; otherwise httpxy
  // appends the original `req.url` to it.
  ignorePath: boolean;
}

export class RemoteRulesMatcher {
  constructor(
    private config: Config
  ) {
  }

  /**
   * Finds the remote rule matching `url` and builds the target to proxy to —
   * matching once and reusing the params, rather than match() + toPath().
   *
   * - Target without a path (`http://host:4000`): the request keeps its own
   *   path and query, only the host changes.
   * - Target with a path (`http://host:4000/v2/:id`): the path is compiled
   *   from the rule's params and replaces the request path; the request's
   *   query string is carried over. `ignorePath` is required here — httpxy
   *   would otherwise append the original `req.url` after the target path
   *   (its `prependPath` can't be switched off per call: the server-level
   *   option always wins).
   */
  public resolve(url: string, ws: boolean = false): RemoteTarget | undefined {
    const { pathname, search } = splitUrl(url);
    const rules = this.config.get().remoteRules || [];

    for (let rule of rules) {
      if (rule.disable) {
        continue;
      }

      if (!!rule.ws !== ws) {
        continue;
      }

      const matchResult = match<Record<string, string>>(rule.path, {
        decode: decodeURIComponent
      })(pathname);

      if (matchResult) {
        return this.buildTarget(rule, matchResult.params, search);
      }
    }
  }

  private buildTarget(rule: RemoteRule, params: Record<string, string>, search: string): RemoteTarget {
    let targetUrl: URL;

    try {
      targetUrl = new URL(rule.target);
    } catch {
      // Not a valid URL — treat as a path pattern
      return { target: compile(rule.target)(params) + search, ignorePath: true };
    }

    if (targetUrl.pathname === '/' && !targetUrl.search) {
      return { target: rule.target, ignorePath: false };
    }

    const targetPath = compile(targetUrl.pathname)(params);

    return {
      target: targetUrl.origin + targetPath + mergeSearch(targetUrl.search, search),
      ignorePath: true,
    };
  }
}

function mergeSearch(targetSearch: string, requestSearch: string): string {
  if (!targetSearch) return requestSearch;
  if (!requestSearch) return targetSearch;
  return `${targetSearch}&${requestSearch.slice(1)}`;
}
