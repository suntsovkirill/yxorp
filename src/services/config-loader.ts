import fs from 'fs';
import path from 'path';
import { ConfigFile } from '../types/yxorp-config';

// Rule lists an included file may contribute (and that `include` merges).
export const INCLUDABLE_SECTIONS = ['remoteRules', 'staticRules', 'mockRules', 'rewriteRules', 'requestRules'] as const;

export type RuleSection = typeof INCLUDABLE_SECTIONS[number];

/** Where a rule of the merged config was defined. */
export interface RuleSource {
  file: string;
  index: number;
}

export interface LoadedConfig {
  config: ConfigFile;
  // Every file the config was assembled from — the watcher reloads when any changes.
  files: string[];
  // Include patterns, resolved to absolute paths — so the watcher can also
  // notice a newly created file that matches one.
  includePatterns: string[];
  // For each rule list of the merged config, the file and index each rule came from.
  sources: Partial<Record<RuleSection, RuleSource[]>>;
}

/**
 * Reads a config file and merges the files listed in its `include`:
 *
 * ```json
 * "include": ["./recorded/recorded.json", "./mocks/*.json"]
 * ```
 *
 * Included files contain only rule lists (`mockRules`, `rewriteRules`, ...).
 * Their rules come after the main config's own, file by file in `include`
 * order (a wildcard expands to its matches in name order) — first match wins,
 * so the main config's rules take precedence. Paths in `include`, and paths
 * inside included files, are relative to the main config's directory.
 * Wildcards (`*`, `?`) are supported in the file name only.
 */
export function loadConfigFile(configPath: string, overrides?: Map<string, unknown>): LoadedConfig {
  // `overrides` stands in for files' contents — to validate an edit before writing it.
  const readJson = (file: string, what: string) =>
    overrides?.has(file) ? structuredClone(overrides.get(file)) : readJsonFile(file, what);

  const config = readJson(configPath, 'config') as ConfigFile & { include?: unknown };
  const configDir = path.dirname(configPath);
  const sources: LoadedConfig['sources'] = {};

  for (const section of INCLUDABLE_SECTIONS) {
    if (Array.isArray(config[section])) {
      sources[section] = config[section].map((_rule: unknown, index: number) => ({ file: configPath, index }));
    }
  }

  if (config.include === undefined) {
    return { config, files: [configPath], includePatterns: [], sources };
  }

  if (!Array.isArray(config.include) || !config.include.every(entry => typeof entry === 'string' && entry.trim())) {
    throw new Error(`"include" in ${configPath} must be an array of file paths`);
  }

  const includePatterns = config.include.map(entry => path.resolve(configDir, entry));
  const files = [configPath];
  const merged: ConfigFile = { ...config };

  for (const pattern of includePatterns) {
    for (const file of expandPattern(pattern)) {
      const included = readJson(file, 'included file');

      if (!included || typeof included !== 'object' || Array.isArray(included)) {
        throw new Error(`Included file ${file} must contain a JSON object`);
      }

      const unexpected = Object.keys(included).filter(key => !(INCLUDABLE_SECTIONS as readonly string[]).includes(key) && key !== '$schema');

      if (unexpected.length) {
        throw new Error(
          `Included file ${file} can only contain rule lists (${INCLUDABLE_SECTIONS.join(', ')}), ` +
          `not ${unexpected.map(key => `"${key}"`).join(', ')}`,
        );
      }

      files.push(file);

      for (const section of INCLUDABLE_SECTIONS) {
        const rules = (included as Record<string, unknown>)[section];

        if (rules === undefined) {
          continue;
        }

        if (!Array.isArray(rules)) {
          throw new Error(`"${section}" in included file ${file} must be an array`);
        }

        merged[section] = [...(merged[section] ?? []), ...rules] as any;
        sources[section] = [...(sources[section] ?? []), ...rules.map((_rule, index) => ({ file, index }))];
      }
    }
  }

  return { config: merged, files, includePatterns, sources };
}

function readJsonFile(file: string, what: string): unknown {
  let raw: string;

  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (e: any) {
    throw new Error(`Cannot read ${what} ${file}: ${e.code === 'ENOENT' ? 'file not found' : e.message}`, { cause: e });
  }

  try {
    return JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Invalid JSON in ${what} ${file}: ${e.message}`, { cause: e });
  }
}

/** Absolute path pattern → matching files; a path without wildcards must exist. */
function expandPattern(pattern: string): string[] {
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);

  if (/[*?]/.test(dir)) {
    throw new Error(`Wildcards are only supported in the file name of an include: ${pattern}`);
  }

  if (!/[*?]/.test(base)) {
    return [pattern];
  }

  const regex = patternToRegExp(base);

  let entries: string[];

  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  return entries
    .filter(name => regex.test(name))
    .sort()
    .map(name => path.join(dir, name))
    .filter(file => fs.statSync(file).isFile());
}

/** File-name wildcard (`*`, `?`) → RegExp. */
export function patternToRegExp(base: string): RegExp {
  const source = base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`);
}
