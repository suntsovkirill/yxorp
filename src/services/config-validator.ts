import { match } from 'path-to-regexp';

const RULE_ARRAYS = ['remoteRules', 'staticRules', 'mockRules', 'rewriteRules'] as const;

const MAX_PORT = 65535;

/**
 * Validates a parsed config object and returns a list of human-readable
 * error messages. An empty array means the config is valid.
 *
 * Intentionally permissive — it only checks the shape of fields that would
 * otherwise cause confusing crashes deeper in the pipeline (e.g. a missing
 * `target` blowing up inside httpxy with an opaque stack trace, or a bad
 * `path` pattern throwing synchronously inside path-to-regexp's `match()`).
 */
export function validateConfig(config: any): string[] {
  const errors: string[] = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['Config must be a JSON object'];
  }

  if (typeof config.target !== 'string' || !config.target.trim()) {
    errors.push('"target" is required and must be a non-empty string (e.g. "https://api.example.com")');
  }

  const { proxyPort } = config;
  const isValidPort =
    (typeof proxyPort === 'number' && Number.isInteger(proxyPort) && proxyPort >= 0 && proxyPort <= MAX_PORT) ||
    (typeof proxyPort === 'string' && proxyPort.trim() !== '' && Number.isInteger(Number(proxyPort)) && Number(proxyPort) >= 0 && Number(proxyPort) <= MAX_PORT);

  if (!isValidPort) {
    errors.push(`"proxyPort" is required and must be a number or numeric string between 0 and ${MAX_PORT} (e.g. 3000)`);
  }

  if (
    config.proxyHeaders !== undefined &&
    (typeof config.proxyHeaders !== 'object' || config.proxyHeaders === null || Array.isArray(config.proxyHeaders))
  ) {
    errors.push('"proxyHeaders" must be an object of string key-value pairs');
  }

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

function validateRule(key: typeof RULE_ARRAYS[number], rule: any, index: number): string[] {
  const errors: string[] = [];
  const label = `"${key}[${index}]"`;

  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return [`${label} must be an object`];
  }

  if (typeof rule.path !== 'string' || !rule.path.trim()) {
    errors.push(`${label} is missing a non-empty "path" string`);
  } else {
    const pathError = validatePathPattern(rule.path);

    if (pathError) {
      errors.push(`${label} has an invalid "path" pattern: ${pathError}`);
    }
  }

  switch (key) {
    case 'remoteRules':
      if (typeof rule.target !== 'string' || !rule.target.trim()) {
        errors.push(`${label} is missing a non-empty "target" string`);
      }
      break;

    case 'staticRules':
      if (typeof rule.directory !== 'string' || !rule.directory.trim()) {
        errors.push(`${label} is missing a non-empty "directory" string`);
      }
      break;

    case 'mockRules':
    case 'rewriteRules':
      if (typeof rule.method !== 'string' || !rule.method.trim()) {
        errors.push(`${label} is missing a non-empty "method" string`);
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
