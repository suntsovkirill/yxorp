import { ConfigFile } from '../types/yxorp-config';

/**
 * Reads a flag's value from argv, supporting both `--flag value` and
 * `--flag=value` forms. For the space-separated form, a following token that
 * itself looks like a flag (starts with `--`) is NOT treated as this flag's
 * value — `--port --target http://x` should leave `--port` unset rather than
 * swallowing `--target` as its value.
 */
function getArgValue(argv: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }

    if (arg === flag) {
      const next = argv[i + 1];
      return next !== undefined && !next.startsWith('--') ? next : undefined;
    }
  }

  return undefined;
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
