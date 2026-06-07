const RULE_ARRAYS = ['remoteRules', 'staticRules', 'mockRules', 'rewriteRules'] as const;

/**
 * Validates a parsed config object and returns a list of human-readable
 * error messages. An empty array means the config is valid.
 *
 * Intentionally permissive — it only checks the shape of fields that would
 * otherwise cause confusing crashes deeper in the pipeline (e.g. a missing
 * `target` blowing up inside httpxy with an opaque stack trace).
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
    (typeof proxyPort === 'number' && Number.isInteger(proxyPort) && proxyPort >= 0) ||
    (typeof proxyPort === 'string' && proxyPort.trim() !== '' && Number.isInteger(Number(proxyPort)));

  if (!isValidPort) {
    errors.push('"proxyPort" is required and must be a number or numeric string (e.g. 3000)');
  }

  if (
    config.proxyHeaders !== undefined &&
    (typeof config.proxyHeaders !== 'object' || config.proxyHeaders === null || Array.isArray(config.proxyHeaders))
  ) {
    errors.push('"proxyHeaders" must be an object of string key-value pairs');
  }

  for (const key of RULE_ARRAYS) {
    if (config[key] !== undefined && !Array.isArray(config[key])) {
      errors.push(`"${key}" must be an array`);
    }
  }

  return errors;
}
