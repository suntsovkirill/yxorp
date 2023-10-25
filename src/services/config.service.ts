import { Service, Token, Inject } from 'typedi';
import { YxorpConfig } from "../types/yxorp-config";


export const ProxyConfigToken = new Token<YxorpConfig>('ProxyConfigToken');

@Service({
  global: true
})
export class Config {
  private config!: YxorpConfig;

  constructor(
    @Inject(ProxyConfigToken) private proxyConfig: YxorpConfig,
  ) {
    this.config = this.proxyConfig;
  }

  public set(config: YxorpConfig): void {
    this.config = config;
  }

  public get(): YxorpConfig {
    return this.config;
  }
}
