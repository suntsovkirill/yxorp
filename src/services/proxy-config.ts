import { ConfigFile, YxorpConfig } from '../types/yxorp-config';

/**
 * Builds the runtime config — the config file plus the httpxy options derived
 * from it.
 */
export function buildProxyConfig(cfg: ConfigFile): YxorpConfig {
  const proxyOptions: Record<string, any> = {
    target: cfg.target,
    changeOrigin: true,
    followRedirects: true,
    secure: false,
    ws: true,
    selfHandleResponse: true,
  };

  if (cfg.proxyHeaders) {
    proxyOptions.headers = cfg.proxyHeaders;
  }

  return { ...cfg, proxyOptions };
}
