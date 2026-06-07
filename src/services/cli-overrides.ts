import { ConfigFile } from '../types/yxorp-config';

function getArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index !== -1 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

/**
 * Applies `--port`/`--target` CLI flags on top of a resolved config, without
 * touching the config file. CLI flags win over config values. Returns a new
 * object — the input config is left untouched.
 */
export function applyCliOverrides(config: ConfigFile, argv: string[]): ConfigFile {
  const portOverride = getArgValue(argv, '--port');
  const targetOverride = getArgValue(argv, '--target');

  if (portOverride === undefined && targetOverride === undefined) {
    return config;
  }

  return {
    ...config,
    ...(portOverride !== undefined ? { proxyPort: portOverride } : {}),
    ...(targetOverride !== undefined ? { target: targetOverride } : {}),
  };
}
