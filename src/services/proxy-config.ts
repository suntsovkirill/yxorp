import { ConfigFile, YxorpConfig } from '../types/yxorp-config';

/**
 * Builds the runtime config — the config file plus the httpxy options derived
 * from it, and the directory its relative paths resolve against.
 */
export function buildProxyConfig(cfg: ConfigFile, configDir: string = process.cwd()): YxorpConfig {
  const proxyOptions: Record<string, any> = {
    target: cfg.target,
    changeOrigin: cfg.changeOrigin ?? true,
    followRedirects: true,
    secure: cfg.secure ?? false,
    ws: true,
    selfHandleResponse: true,
  };

  if (cfg.proxyHeaders) {
    proxyOptions.headers = cfg.proxyHeaders;
  }

  return { ...cfg, proxyOptions, configDir };
}
