import { Config } from '../config.service';
import { RewriteRule } from '../../types/yxorp-config';
import { MethodPathRulesMatcher } from './method-path-rules-matcher';

export class RewriteRulesMatcher extends MethodPathRulesMatcher<RewriteRule> {
  constructor(
    private config: Config,
  ) {
    super();
  }

  protected getRules(): RewriteRule[] {
    return this.config.get().rewriteRules || [];
  }
}
