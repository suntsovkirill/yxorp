import { Config } from '../config.service';
import { RequestRule } from '../../types/yxorp-config';
import { MethodPathRulesMatcher } from './method-path-rules-matcher';

export class RequestRulesMatcher extends MethodPathRulesMatcher<RequestRule> {
  constructor(
    private config: Config,
  ) {
    super();
  }

  protected getRules(): RequestRule[] {
    return this.config.get().requestRules || [];
  }
}
