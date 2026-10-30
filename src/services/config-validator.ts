import http from 'http';
import { match } from 'path-to-regexp';

const RULE_ARRAYS = ['remoteRules', 'staticRules', 'mockRules', 'rewriteRules'] as const;

type RuleArrayKey = typeof RULE_ARRAYS[number];

const MAX_PORT = 65535;

const HTTP_METHODS = new Set(http.METHODS.map(method => method.toUpperCase()));

// Keys the config understands — anything else is most likely a typo (e.g.
// `mockRule` instead of `mockRules`) that would otherwise be silently ignored.
const KNOWN_TOP_LEVEL_KEYS = new Set([
  '$schema',
  'target',
  'proxyPort',
  'proxyHeaders',
  'secure',
  'changeOrigin',
  ...RULE_ARRAYS,
]);

const KNOWN_RULE_KEYS: Record<RuleArrayKey, Set<string>> = {
  remoteRules: new Set(['path', 'target', 'ws', 'disable']),
  staticRules: new Set(['path', 'directory', 'caseInsensitive', 'directoryIndex', 'disable']),
  mockRules: new Set(['method', 'path', 'file', 'script', 'statusCode', 'disable']),
  rewriteRules: new Set(['method', 'path', 'file', 'script', 'statusCode', 'disable']),
};

/**
 * Validates a parsed config object and returns a list of human-readable
 * error messages. An empty array means the config is valid.
 *
 * Intentionally permissive — it only checks the shape of fields that would
 * otherwise cause confusing crashes deeper in the pipeline (e.g. a missing
 * `target` blowing up inside httpxy with an opaque stack trace, or a bad
 * `path` pattern throwing synchronously inside path-to-regexp's `match()`).
 * Unknown keys are not errors — see `findConfigWarnings()`.
 */
export function validateConfig(config: any): string[] {
  const errors: string[] = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['Config must be a JSON object'];
  }

  if (typeof config.target !== 'string' || !config.target.trim()) {
    errors.push('"target" is required and must be a non-empty string (e.g. "https://api.example.com")');
  } else if (!isUrlWithProtocol(config.target, ['http:', 'https:'])) {
    errors.push(`"target" must be an absolute http(s) URL (e.g. "https://api.example.com"), got "${config.target}"`);
  }

  const { proxyPort } = config;
  const isValidPort =
    (typeof proxyPort === 'number' && Number.isInteger(proxyPort) && proxyPort >= 0 && proxyPort <= MAX_PORT) ||
    (typeof proxyPort === 'string' && proxyPort.trim() !== '' && Number.isInteger(Number(proxyPort)) && Number(proxyPort) >= 0 && Number(proxyPort) <= MAX_PORT);

  if (!isValidPort) {
    errors.push(`"proxyPort" is required and must be a number or numeric string between 0 and ${MAX_PORT} (e.g. 3000)`);
  }

  if (config.proxyHeaders !== undefined) {
    if (typeof config.proxyHeaders !== 'object' || config.proxyHeaders === null || Array.isArray(config.proxyHeaders)) {
      errors.push('"proxyHeaders" must be an object of string key-value pairs');
    } else {
      for (const [name, value] of Object.entries(config.proxyHeaders)) {
        if (typeof value !== 'string') {
          errors.push(`"proxyHeaders.${name}" must be a string`);
        }
      }
    }
  }

  errors.push(...validateOptionalBoolean('"secure"', config.secure));
  errors.push(...validateOptionalBoolean('"changeOrigin"', config.changeOrigin));

  for (const key of RULE_ARRAYS) {
    const rules = config[key];

    if (rules === undefined) {
      continue;
    }

    if (!Array.isArray(rules)) {
      errors.push(`"${key}" must be an array`);
      continue;
    }

    rules.forEach((rule: any, index: number) => {
      errors.push(...validateRule(key, rule, index));
    });
  }

  return errors;
}

/**
 * Returns warnings for keys the config doesn't understand — usually typos
 * (`mockRule`, `statuscode`) that would otherwise be silently ignored. These
 * don't stop the server from starting.
 */
export function findConfigWarnings(config: any): string[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return [];
  }

  const warnings = Object.keys(config)
    .filter(key => !KNOWN_TOP_LEVEL_KEYS.has(key))
    .map(key => `Unknown config key "${key}" is ignored`);

  for (const key of RULE_ARRAYS) {
    const rules = config[key];

    if (!Array.isArray(rules)) {
      continue;
    }

    rules.forEach((rule: any, index: number) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        return;
      }

      for (const ruleKey of Object.keys(rule)) {
        if (!KNOWN_RULE_KEYS[key].has(ruleKey)) {
          warnings.push(`Unknown key "${ruleKey}" in "${key}[${index}]" is ignored`);
        }
      }
    });
  }

  return warnings;
}

function validateRule(key: RuleArrayKey, rule: any, index: number): string[] {
  const errors: string[] = [];
  const label = `"${key}[${index}]"`;

  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return [`${label} must be an object`];
  }

  if (typeof rule.path !== 'string' || !rule.path.trim()) {
    errors.push(`${label} is missing a non-empty "path" string`);
  } else if (key !== 'staticRules') {
    // Static rule paths are plain prefixes, not path-to-regexp patterns.
    const pathError = validatePathPattern(rule.path);

    if (pathError) {
      errors.push(`${label} has an invalid "path" pattern: ${pathError}`);
    }
  }

  errors.push(...validateOptionalBoolean(`${label} "disable"`, rule.disable));

  switch (key) {
    case 'remoteRules':
      if (typeof rule.target !== 'string' || !rule.target.trim()) {
        errors.push(`${label} is missing a non-empty "target" string`);
      } else if (!isUrlWithProtocol(rule.target, ['http:', 'https:', 'ws:', 'wss:'])) {
        errors.push(`${label} "target" must be an absolute URL (e.g. "http://localhost:4000" or "http://localhost:4000/v2/:id"), got "${rule.target}"`);
      }

      errors.push(...validateOptionalBoolean(`${label} "ws"`, rule.ws));
      break;

    case 'staticRules':
      if (typeof rule.directory !== 'string' || !rule.directory.trim()) {
        errors.push(`${label} is missing a non-empty "directory" string`);
      }

      if (rule.directoryIndex !== undefined && typeof rule.directoryIndex !== 'string') {
        errors.push(`${label} "directoryIndex" must be a string`);
      }

      errors.push(...validateOptionalBoolean(`${label} "caseInsensitive"`, rule.caseInsensitive));
      break;

    case 'mockRules':
    case 'rewriteRules':
      if (typeof rule.method !== 'string' || !rule.method.trim()) {
        errors.push(`${label} is missing a non-empty "method" string`);
      } else if (!HTTP_METHODS.has(rule.method.toUpperCase())) {
        errors.push(`${label} has an unknown HTTP "method" "${rule.method}"`);
      }

      if (
        rule.statusCode !== undefined &&
        (!Number.isInteger(rule.statusCode) || rule.statusCode < 100 || rule.statusCode > 599)
      ) {
        errors.push(`${label} "statusCode" must be an integer between 100 and 599`);
      }

      errors.push(...validateFileOrScriptRule(label, rule));
      break;
  }

  return errors;
}

function validateFileOrScriptRule(label: string, rule: any): string[] {
  const hasFile = 'file' in rule;
  const hasScript = 'script' in rule;

  if (hasFile && hasScript) {
    return [`${label} must declare only one of "file" or "script", not both`];
  }

  if (!hasFile && !hasScript) {
    return [`${label} must declare either "file" or "script"`];
  }

  if (hasFile && (typeof rule.file !== 'string' || !rule.file.trim())) {
    return [`${label} has a "file" that must be a non-empty string`];
  }

  if (hasScript && (typeof rule.script !== 'string' || !rule.script.trim())) {
    return [`${label} has a "script" that must be a non-empty string`];
  }

  return [];
}

function validateOptionalBoolean(label: string, value: unknown): string[] {
  return value === undefined || typeof value === 'boolean' ? [] : [`${label} must be true or false`];
}

function isUrlWithProtocol(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Compiles a path-to-regexp pattern to catch malformed patterns at
 * config-load/reload time, before they reach the rule matchers (where they'd
 * otherwise throw synchronously on every matching request).
 */
function validatePathPattern(path: string): string | undefined {
  try {
    match(path);
    return undefined;
  } catch (e: any) {
    return e?.message || String(e);
  }
}
