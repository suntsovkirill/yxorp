import { Config } from '../config.service';
import { match, compile } from 'path-to-regexp';
import { RemoteRule } from '../../types/yxorp-config';

export class RemoteRulesMatcher {
  constructor(
    private config: Config
  ) {
  }

  public match(url: string, ws: boolean = false): RemoteRule | undefined {
    const rules = this.config.get().remoteRules || [];

    for (let rule of rules) {
      if (rule.disable) {
        continue;
      }

      if (!!rule.ws !== ws) {
        continue;
      }

      const matchResult = match(rule.path, {
        decode: decodeURIComponent
      })(url);

      if (matchResult) {
        return rule;
      }
    }
  }

  public toPath(url: string, remoteRule: RemoteRule): string | undefined {
    const matchResult = match(remoteRule.path, {
      decode: decodeURIComponent
    })(url);

    if (matchResult) {
      const params = matchResult.params as Record<string, string>;

      // remoteRule.target may be a full URL (http://host:port/:param/path)
      // Parse it and only compile the path portion
      let baseUrl: string;
      let pathPattern: string;

      try {
        const urlObj = new URL(remoteRule.target);
        baseUrl = urlObj.origin;
        pathPattern = urlObj.pathname;
      } catch {
        // Not a valid URL — treat as a path pattern
        const toPath = compile(remoteRule.target);
        return toPath(matchResult.params);
      }

      const toPath = compile(pathPattern);
      return baseUrl + toPath(params);
    }
  }
}
