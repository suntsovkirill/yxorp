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

  return { ...applyProfile(cfg), proxyOptions, configDir };
}

const PROFILE_SECTIONS = ['remoteRules', 'staticRules', 'mockRules', 'rewriteRules', 'requestRules'] as const;

/**
 * Puts the active profile's rules in front of the base rules (first match
 * wins, so they take precedence) and lets its `chaos` replace the base one.
 */
export function applyProfile(cfg: ConfigFile): ConfigFile {
  const profile = cfg.profile ? cfg.profiles?.[cfg.profile] : undefined;

  if (!profile) {
    return cfg;
  }

  const merged: ConfigFile = { ...cfg };

  for (const section of PROFILE_SECTIONS) {
    if (profile[section]) {
      merged[section] = [...profile[section], ...(cfg[section] ?? [])] as any;
    }
  }

  if (profile.chaos !== undefined) {
    merged.chaos = profile.chaos;
  }

  return merged;
}
