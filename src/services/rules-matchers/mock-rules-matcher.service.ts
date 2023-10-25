import { Service } from 'typedi';
import { Config } from '../config.service';
import { match } from 'path-to-regexp';
import { MockRule } from '../../types/yxorp-config';


@Service({
  global: true
})
export class MockRulesMatcher {
  constructor(
    private config: Config
  ) {
  }

  public match(url: string, method: string): MockRule | undefined {
    const mockRules = this.config.get().mockRules || [];

    for (let mockRule of mockRules) {
      if (mockRule.disable) {
        continue;
      }

      if (mockRule.method.toLowerCase() !== method.toLowerCase()) {
        continue;
      }

      const matchResult = match<Record<string, string>>(mockRule.path, {
        decode: decodeURIComponent,
      })(url);

      if (matchResult) {
        return mockRule;
      }
    }
  }

  public params(url: string, mockRule: MockRule): Object | undefined {
    const matchResult = match(mockRule.path, {
      decode: decodeURIComponent,
    })(url);

    if (matchResult) {
      return matchResult.params;
    }
  }

}
