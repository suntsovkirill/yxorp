import { ConfigFile } from '../types/yxorp-config';

/**
 * Reads a flag's value from argv, supporting both `--flag value` and
 * `--flag=value` forms. For the space-separated form, a following token that
 * itself looks like a flag (starts with `--`) is NOT treated as this flag's
 * value — `--port --target http://x` should leave `--port` unset rather than
 * swallowing `--target` as its value.
 */
export function getArgValue(argv: string[], flag: string): string | undefined {
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

// CLI flag → the config key it overrides.
const OVERRIDES: Record<string, 'proxyPort' | 'target' | 'host'> = {
  '--port': 'proxyPort',
  '--target': 'target',
  '--host': 'host',
};

/**
 * Applies `--port`/`--target`/`--host` CLI flags on top of a resolved config,
 * without touching the config file. CLI flags win over config values. Returns
 * a new object — the input config is left untouched.
 */
export function applyCliOverrides(config: ConfigFile, argv: string[]): ConfigFile {
  const overrides: Partial<ConfigFile> = {};

  for (const [flag, key] of Object.entries(OVERRIDES)) {
    const value = getArgValue(argv, flag);

    if (value !== undefined) {
      overrides[key] = value;
    }
  }

  return Object.keys(overrides).length ? { ...config, ...overrides } : config;
}
