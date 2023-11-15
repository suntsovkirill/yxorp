import { YxorpConfig } from '../types/yxorp-config';

export class Config {
  private config!: YxorpConfig;

  public set(config: YxorpConfig): void {
    this.config = config;
  }

  public get(): YxorpConfig {
    return this.config;
  }
}
