import { YxorpConfig } from '../types/yxorp-config';

export class Config {
  private config?: YxorpConfig;

  public set(config: YxorpConfig): void {
    this.config = config;
  }

  public get(): YxorpConfig {
    if (!this.config) {
      throw new Error('Config has not been initialized — call set() before get()');
    }

    return this.config;
  }
}
