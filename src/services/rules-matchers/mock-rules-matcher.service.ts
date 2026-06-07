import { Config } from '../config.service';
import { MockRule } from '../../types/yxorp-config';
import { MethodPathRulesMatcher } from './method-path-rules-matcher';

export class MockRulesMatcher extends MethodPathRulesMatcher<MockRule> {
  constructor(
    private config: Config,
  ) {
    super();
  }

  protected getRules(): MockRule[] {
    return this.config.get().mockRules || [];
  }
}
