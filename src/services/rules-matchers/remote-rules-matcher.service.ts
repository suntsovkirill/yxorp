import { Service } from 'typedi';
import { Config } from '../config.service';
import { match, compile } from 'path-to-regexp';
import { RemoteRule } from '../../types/yxorp-config';


@Service({
  global: true
})
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
      const toPath = compile(remoteRule.target, { validate: false });
      return toPath(matchResult.params);
    }
  }

}
