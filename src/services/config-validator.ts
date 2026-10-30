import http from 'http';
import { match } from 'path-to-regexp';

const RULE_ARRAYS = ['remoteRules', 'staticRules', 'mockRules', 'rewriteRules'] as const;

type RuleArrayKey = typeof RULE_ARRAYS[number];

const MAX_PORT = 65535;

const HTTP_METHODS = new Set(http.METHODS.map(method => method.toUpperCase()));

// Keys the config understands — anything else is most likely a typo (e.g.
// `mockRule` instead of `mockRules`) that would otherwise be silently ignored.
export const KNOWN_TOP_LEVEL_KEYS = new Set([
  '$schema',
  'target',
  'proxyPort',
  'proxyHeaders',
  'secure',
  'changeOrigin',
  'cors',
  'https',
  ...RULE_ARRAYS,
]);

export const KNOWN_RULE_KEYS: Record<RuleArrayKey, Set<string>> = {
  remoteRules: new Set(['path', 'target', 'ws', 'disable']),
  staticRules: new Set(['path', 'directory', 'caseInsensitive', 'directoryIndex', 'disable']),
  mockRules: new Set(['method', 'path', 'match', 'file', 'script', 'json', 'body', 'statusCode', 'headers', 'delay', 'disable']),
  rewriteRules: new Set(['method', 'path', 'match', 'file', 'script', 'json', 'body', 'statusCode', 'headers', 'delay', 'disable']),
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
  errors.push(...validateCors(config.cors));
  errors.push(...validateHttps(config.https));

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

      if (rule.delay !== undefined && (!Number.isInteger(rule.delay) || rule.delay < 0)) {
        errors.push(`${label} "delay" must be a non-negative integer (milliseconds)`);
      }

      errors.push(...validateStringMap(`${label} "headers"`, rule.headers));
      errors.push(...validateMatch(label, rule.match));
      errors.push(...validateBodySource(label, rule));
      break;
  }

  return errors;
}

const CORS_KEYS = new Set(['origin', 'credentials', 'maxAge', 'exposeHeaders']);

function validateCors(cors: any): string[] {
  if (cors === undefined || typeof cors === 'boolean') {
    return [];
  }

  if (!cors || typeof cors !== 'object' || Array.isArray(cors)) {
    return ['"cors" must be true, false, or an object'];
  }

  const errors = Object.keys(cors)
    .filter(key => !CORS_KEYS.has(key))
    .map(key => `"cors" has an unknown key "${key}" (expected ${[...CORS_KEYS].map(k => `"${k}"`).join(', ')})`);

  const { origin, maxAge, exposeHeaders } = cors;

  if (origin !== undefined && typeof origin !== 'string' && !(Array.isArray(origin) && origin.every((o: unknown) => typeof o === 'string'))) {
    errors.push('"cors.origin" must be a string or an array of strings');
  }

  errors.push(...validateOptionalBoolean('"cors.credentials"', cors.credentials));

  if (maxAge !== undefined && (!Number.isInteger(maxAge) || maxAge < 0)) {
    errors.push('"cors.maxAge" must be a non-negative integer (seconds)');
  }

  if (exposeHeaders !== undefined && !(Array.isArray(exposeHeaders) && exposeHeaders.every((h: unknown) => typeof h === 'string'))) {
    errors.push('"cors.exposeHeaders" must be an array of strings');
  }

  return errors;
}

function validateHttps(https: any): string[] {
  if (https === undefined) {
    return [];
  }

  if (!https || typeof https !== 'object' || Array.isArray(https)) {
    return ['"https" must be an object with "key" and "cert" file paths'];
  }

  return (['key', 'cert'] as const)
    .filter(key => typeof https[key] !== 'string' || !https[key].trim())
    .map(key => `"https.${key}" must be a non-empty file path`);
}

const BODY_SOURCES = ['file', 'script', 'json', 'body'] as const;

function validateBodySource(label: string, rule: any): string[] {
  const declared = BODY_SOURCES.filter(source => source in rule);

  if (declared.length > 1) {
    return [`${label} must declare only one of "file", "script", "json" or "body", not ${declared.map(s => `"${s}"`).join(' and ')}`];
  }

  if (declared.length === 0) {
    return [`${label} must declare one of "file", "script", "json" or "body"`];
  }

  const [source] = declared;

  if ((source === 'file' || source === 'script') && (typeof rule[source] !== 'string' || !rule[source].trim())) {
    return [`${label} has a "${source}" that must be a non-empty string`];
  }

  if (source === 'body' && typeof rule.body !== 'string') {
    return [`${label} has a "body" that must be a string (use "json" for structured data)`];
  }

  if (source === 'json' && rule.json === undefined) {
    return [`${label} has a "json" that must be a JSON value`];
  }

  return [];
}

function validateMatch(label: string, match: any): string[] {
  if (match === undefined) {
    return [];
  }

  if (!match || typeof match !== 'object' || Array.isArray(match)) {
    return [`${label} "match" must be an object with optional "query" and "headers"`];
  }

  const errors = Object.keys(match)
    .filter(key => key !== 'query' && key !== 'headers')
    .map(key => `${label} "match" has an unknown key "${key}" (expected "query" or "headers")`);

  errors.push(...validateStringMap(`${label} "match.query"`, match.query));
  errors.push(...validateStringMap(`${label} "match.headers"`, match.headers));

  return errors;
}

function validateStringMap(label: string, value: any): string[] {
  if (value === undefined) {
    return [];
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${label} must be an object of string values`];
  }

  return Object.entries(value)
    .filter(([, v]) => typeof v !== 'string')
    .map(([key]) => `${label} value for "${key}" must be a string`);
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
