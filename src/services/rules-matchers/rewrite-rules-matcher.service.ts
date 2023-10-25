import { Service } from 'typedi';
import { Config } from '../config.service';
import { match } from 'path-to-regexp';
import { RewriteRule } from '../../types/yxorp-config';


@Service({
  global: true
})
export class RewriteRulesMatcher {
  constructor(
    private config: Config
  ) {
  }

  public match(url: string, method: string): RewriteRule | undefined {
    const rewriteRules = this.config.get().rewriteRules || [];

    for (let rewriteRule of rewriteRules) {
      if (rewriteRule.disable) {
        continue;
      }

      if (rewriteRule.method.toLowerCase() !== method.toLowerCase()) {
        continue;
      }

      const matchResult = match<Record<string, string>>(rewriteRule.path, {
        decode: decodeURIComponent,
      })(url);

      if (matchResult) {
        return rewriteRule;
      }
    }
  }

  public params(url: string, rewriteRule: RewriteRule): Object | undefined {
    const matchResult = match(rewriteRule.path, {
      decode: decodeURIComponent,
    })(url);

    if (matchResult) {
      return matchResult.params;
    }
  }

}
