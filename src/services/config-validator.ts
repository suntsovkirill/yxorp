import http from 'http';
import { match } from 'path-to-regexp';

const RULE_ARRAYS = ['remoteRules', 'staticRules', 'mockRules', 'rewriteRules', 'requestRules'] as const;

type RuleArrayKey = typeof RULE_ARRAYS[number];

const MAX_PORT = 65535;

const HTTP_METHODS = new Set(http.METHODS.map(method => method.toUpperCase()));

// Keys the config understands — anything else is most likely a typo (e.g.
// `mockRule` instead of `mockRules`) that would otherwise be silently ignored.
export const KNOWN_TOP_LEVEL_KEYS = new Set([
  '$schema',
  'target',
  'proxyPort',
  'host',
  'proxyHeaders',
  'secure',
  'changeOrigin',
  'cors',
  'https',
  'include',
  'chaos',
  'profiles',
  'profile',
  ...RULE_ARRAYS,
]);

export const KNOWN_RULE_KEYS: Record<RuleArrayKey, Set<string>> = {
  remoteRules: new Set(['path', 'target', 'ws', 'disable']),
  staticRules: new Set(['path', 'directory', 'caseInsensitive', 'directoryIndex', 'disable']),
  mockRules: new Set(['method', 'path', 'match', 'file', 'script', 'json', 'body', 'statusCode', 'headers', 'delay', 'disable']),
  rewriteRules: new Set(['method', 'path', 'match', 'file', 'script', 'json', 'body', 'statusCode', 'headers', 'delay', 'disable']),
  requestRules: new Set(['method', 'path', 'match', 'headers', 'query', 'json', 'body', 'disable']),
};

export const KNOWN_PROFILE_KEYS = new Set([...RULE_ARRAYS, 'chaos']);

const CHAOS_KEYS = new Set(['delay', 'errorRate', 'errorStatus', 'dropRate', 'paths']);

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

  if (config.host !== undefined && (typeof config.host !== 'string' || !config.host.trim())) {
    errors.push('"host" must be a non-empty string (e.g. "127.0.0.1" or "0.0.0.0")');
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

  errors.push(...validateRuleSections(config, ''));
  errors.push(...validateChaos('"chaos"', config.chaos));
  errors.push(...validateProfiles(config.profiles, config.profile));

  return errors;
}

function validateRuleSections(source: any, prefix: string): string[] {
  const errors: string[] = [];

  for (const key of RULE_ARRAYS) {
    const rules = source[key];

    if (rules === undefined) {
      continue;
    }

    if (!Array.isArray(rules)) {
      errors.push(`"${prefix}${key}" must be an array`);
      continue;
    }

    rules.forEach((rule: any, index: number) => {
      errors.push(...validateRule(key, rule, `"${prefix}${key}[${index}]"`));
    });
  }

  return errors;
}

function validateProfiles(profiles: any, active: any): string[] {
  const errors: string[] = [];

  if (profiles !== undefined) {
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
      return ['"profiles" must be an object mapping profile names to rule sets'];
    }

    for (const [name, profile] of Object.entries<any>(profiles)) {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        errors.push(`"profiles.${name}" must be an object`);
        continue;
      }

      errors.push(...validateRuleSections(profile, `profiles.${name}.`));
      errors.push(...validateChaos(`"profiles.${name}.chaos"`, profile.chaos));
    }
  }

  if (active !== undefined) {
    if (typeof active !== 'string' || !active.trim()) {
      errors.push('"profile" must be the name of a profile');
    } else if (!profiles || !Object.hasOwn(profiles, active)) {
      const names = profiles && typeof profiles === 'object' ? Object.keys(profiles) : [];
      errors.push(`"profile" is "${active}", but there is no such profile${names.length ? ` (available: ${names.join(', ')})` : ''}`);
    }
  }

  return errors;
}

function validateChaos(label: string, chaos: any): string[] {
  if (chaos === undefined) {
    return [];
  }

  if (!chaos || typeof chaos !== 'object' || Array.isArray(chaos)) {
    return [`${label} must be an object`];
  }

  const errors = Object.keys(chaos)
    .filter(key => !CHAOS_KEYS.has(key))
    .map(key => `${label} has an unknown key "${key}" (expected ${[...CHAOS_KEYS].map(k => `"${k}"`).join(', ')})`);

  const { delay, errorStatus, paths } = chaos;

  if (delay !== undefined) {
    const isRange = delay && typeof delay === 'object' && Number.isInteger(delay.min) && Number.isInteger(delay.max) && delay.min >= 0 && delay.max >= delay.min;

    if (!(Number.isInteger(delay) && delay >= 0) && !isRange) {
      errors.push(`${label} "delay" must be milliseconds, or { "min": ms, "max": ms } with min <= max`);
    }
  }

  for (const rate of ['errorRate', 'dropRate']) {
    const value = chaos[rate];

    if (value !== undefined && (typeof value !== 'number' || value < 0 || value > 1)) {
      errors.push(`${label} "${rate}" must be a number between 0 and 1`);
    }
  }

  if (errorStatus !== undefined && (!Number.isInteger(errorStatus) || errorStatus < 100 || errorStatus > 599)) {
    errors.push(`${label} "errorStatus" must be an integer between 100 and 599`);
  }

  if (paths !== undefined) {
    if (!Array.isArray(paths) || !paths.every((p: unknown) => typeof p === 'string' && p.trim())) {
      errors.push(`${label} "paths" must be an array of path patterns`);
    } else {
      for (const pattern of paths) {
        const pathError = validatePathPattern(pattern);

        if (pathError) {
          errors.push(`${label} has an invalid path pattern "${pattern}": ${pathError}`);
        }
      }
    }
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

  warnings.push(...ruleKeyWarnings(config, ''));

  if (config.profiles && typeof config.profiles === 'object' && !Array.isArray(config.profiles)) {
    for (const [name, profile] of Object.entries<any>(config.profiles)) {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        continue;
      }

      for (const key of Object.keys(profile)) {
        if (!KNOWN_PROFILE_KEYS.has(key)) {
          warnings.push(`Unknown key "${key}" in "profiles.${name}" is ignored`);
        }
      }

      warnings.push(...ruleKeyWarnings(profile, `profiles.${name}.`));
    }
  }

  return warnings;
}

function ruleKeyWarnings(source: any, prefix: string): string[] {
  const warnings: string[] = [];

  for (const key of RULE_ARRAYS) {
    const rules = source[key];

    if (!Array.isArray(rules)) {
      continue;
    }

    rules.forEach((rule: any, index: number) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        return;
      }

      for (const ruleKey of Object.keys(rule)) {
        if (!KNOWN_RULE_KEYS[key].has(ruleKey)) {
          warnings.push(`Unknown key "${ruleKey}" in "${prefix}${key}[${index}]" is ignored`);
        }
      }
    });
  }

  return warnings;
}

function validateRule(key: RuleArrayKey, rule: any, label: string): string[] {
  const errors: string[] = [];

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
      errors.push(...validateMethod(label, rule.method));

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

    case 'requestRules':
      errors.push(...validateMethod(label, rule.method));
      errors.push(...validateMatch(label, rule.match));
      errors.push(...validateStringMap(`${label} "headers"`, rule.headers, true));
      errors.push(...validateStringMap(`${label} "query"`, rule.query, true));

      if ('json' in rule && 'body' in rule) {
        errors.push(`${label} must declare only one of "json" or "body"`);
      } else if ('body' in rule && typeof rule.body !== 'string') {
        errors.push(`${label} has a "body" that must be a string (use "json" for structured data)`);
      }
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
    return [`${label} "match" must be an object with optional "query", "headers" and "body"`];
  }

  const errors = Object.keys(match)
    .filter(key => key !== 'query' && key !== 'headers' && key !== 'body')
    .map(key => `${label} "match" has an unknown key "${key}" (expected "query", "headers" or "body")`);

  errors.push(...validateStringMap(`${label} "match.query"`, match.query));
  errors.push(...validateStringMap(`${label} "match.headers"`, match.headers));

  return errors;
}

function validateMethod(label: string, method: any): string[] {
  if (typeof method !== 'string' || !method.trim()) {
    return [`${label} is missing a non-empty "method" string`];
  }

  return HTTP_METHODS.has(method.toUpperCase()) ? [] : [`${label} has an unknown HTTP "method" "${method}"`];
}

/** An object of string values — or of `null`s too, with `allowNull` (meaning "remove"). */
function validateStringMap(label: string, value: any, allowNull = false): string[] {
  if (value === undefined) {
    return [];
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${label} must be an object of string values`];
  }

  return Object.entries(value)
    .filter(([, v]) => typeof v !== 'string' && !(allowNull && v === null))
    .map(([key]) => `${label} value for "${key}" must be a string${allowNull ? ' (or null to remove it)' : ''}`);
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
