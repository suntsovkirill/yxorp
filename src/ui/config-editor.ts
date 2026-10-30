import path from 'path';
import { INCLUDABLE_SECTIONS, loadConfigFile, RuleSection } from '../services/config-loader';
import { applyCliOverrides } from '../services/cli-overrides';
import { validateConfig } from '../services/config-validator';
import { formatPath, getAt, JsonPath, parentOf, readJsonFile, writeJsonFile } from './json-file';

export interface RuleEntry {
  section: RuleSection;
  // The file the rule is defined in, and where in it.
  file: string;
  path: JsonPath;
  rule: any;
  // Set for rules of a profile (defined under "profiles" in the main config).
  profile?: string;
}

export class ConfigEditError extends Error {
  constructor(message: string, public readonly errors: string[] = [message], public readonly status = 400) {
    super(message);
  }
}

/**
 * Reads and edits the config files behind a running proxy for the web UI.
 * Every edit is applied in memory first and validated against the whole
 * merged config (includes and CLI overrides included); only a valid result is
 * written — atomically, keeping the file's indentation — and then `onWritten`
 * reloads the proxy. Only the config and the files it includes can be written.
 */
export class ConfigEditor {
  constructor(
    public readonly configPath: string,
    private argv: string[],
    private onWritten: () => void,
  ) {
  }

  public listRules(): { rules: RuleEntry[]; profiles: string[]; profileInFile?: string } {
    const loaded = loadConfigFile(this.configPath);
    const rules: RuleEntry[] = [];

    for (const section of INCLUDABLE_SECTIONS) {
      const sources = loaded.sources[section] ?? [];

      sources.forEach((source, i) => {
        rules.push({ section, file: source.file, path: [section, source.index], rule: loaded.config[section]![i] });
      });
    }

    const profiles = loaded.config.profiles && typeof loaded.config.profiles === 'object' ? loaded.config.profiles : {};

    for (const [name, profile] of Object.entries<any>(profiles)) {
      for (const section of INCLUDABLE_SECTIONS) {
        (Array.isArray(profile?.[section]) ? profile[section] : []).forEach((rule: unknown, index: number) => {
          rules.push({ section, file: this.configPath, path: ['profiles', name, section, index], rule, profile: name });
        });
      }
    }

    return { rules, profiles: Object.keys(profiles), profileInFile: loaded.config.profile };
  }

  public setDisabled(file: string, rulePath: JsonPath, disabled: boolean): void {
    this.edit(file, (root) => {
      const rule = this.ruleAt(root, rulePath);

      if (disabled) {
        rule.disable = true;
      } else {
        delete rule.disable;
      }
    });
  }

  public replaceRule(file: string, rulePath: JsonPath, rule: unknown): void {
    this.edit(file, (root) => {
      this.ruleAt(root, rulePath);
      const { parent, key } = parentOf(root, rulePath);
      parent[key] = rule;
    });
  }

  public deleteRule(file: string, rulePath: JsonPath): void {
    this.edit(file, (root) => {
      this.ruleAt(root, rulePath);
      const { parent, key } = parentOf(root, rulePath);
      parent.splice(key as number, 1);
    });
  }

  /** Moves a rule to another position in its list — order matters, the first match wins. */
  public moveRule(file: string, rulePath: JsonPath, to: number): void {
    this.edit(file, (root) => {
      this.ruleAt(root, rulePath);
      const { parent, key } = parentOf(root, rulePath);

      if (!Number.isInteger(to) || to < 0 || to >= parent.length) {
        throw new ConfigEditError(`Cannot move to position ${to}`);
      }

      const [rule] = parent.splice(key as number, 1);
      parent.splice(to, 0, rule);
    });
  }

  /** Adds a rule to the main config (or to one of its profiles), first or last in its list. */
  public addRule(section: string, rule: unknown, options: { position?: 'first' | 'last'; profile?: string } = {}): void {
    if (!(INCLUDABLE_SECTIONS as readonly string[]).includes(section)) {
      throw new ConfigEditError(`Unknown rule list "${section}"`);
    }

    this.edit(this.configPath, (root) => {
      let owner = root;

      if (options.profile) {
        owner = root.profiles?.[options.profile];

        if (!owner || typeof owner !== 'object') {
          throw new ConfigEditError(`No profile "${options.profile}"`);
        }
      }

      const list = Array.isArray(owner[section]) ? owner[section] : (owner[section] = []);

      if (options.position === 'last') {
        list.push(rule);
      } else {
        list.unshift(rule);
      }
    });
  }

  /** Sets (or with null, removes) the active profile in the main config. */
  public setProfile(profile: string | null): void {
    this.edit(this.configPath, (root) => {
      if (profile === null) {
        delete root.profile;
      } else {
        root.profile = profile;
      }
    });
  }

  public readMainConfig(): string {
    const { value, indent } = readJsonFile(this.configPath);
    return JSON.stringify(value, null, indent);
  }

  /** Replaces the whole main config with `text` (JSON). */
  public writeMainConfig(text: string): void {
    let value: unknown;

    try {
      value = JSON.parse(text);
    } catch (e: any) {
      throw new ConfigEditError(`Invalid JSON: ${e.message}`);
    }

    this.edit(this.configPath, () => value);
  }

  private edit(file: string, mutate: (root: any) => unknown): void {
    const target = path.resolve(file);
    const loaded = loadConfigFile(this.configPath);

    if (!loaded.files.map(f => path.resolve(f)).includes(target)) {
      throw new ConfigEditError(`${file} is not part of the config`, undefined, 403);
    }

    const { value, indent } = readJsonFile(target);
    const result = mutate(value);
    const next = result === undefined ? value : result;

    let errors: string[];

    try {
      const merged = loadConfigFile(this.configPath, new Map([[target, next]])).config;
      errors = validateConfig(applyCliOverrides(merged, this.argv));
    } catch (e: any) {
      errors = [e.message];
    }

    if (errors.length) {
      throw new ConfigEditError('The change would make the config invalid', errors);
    }

    writeJsonFile(target, next, indent);
    this.onWritten();
  }

  /** The rule at `rulePath` — which must point into a rule list. */
  private ruleAt(root: any, rulePath: JsonPath): any {
    const isRulePath =
      (rulePath.length === 2 && isSection(rulePath[0]) && Number.isInteger(rulePath[1])) ||
      (rulePath.length === 4 && rulePath[0] === 'profiles' && typeof rulePath[1] === 'string' && isSection(rulePath[2]) && Number.isInteger(rulePath[3]));

    if (!isRulePath) {
      throw new ConfigEditError(`${formatPath(rulePath)} is not a rule`);
    }

    const rule = getAt(root, rulePath);

    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new ConfigEditError(`No rule at ${formatPath(rulePath)}`, undefined, 404);
    }

    return rule;
  }
}

function isSection(value: unknown): boolean {
  return (INCLUDABLE_SECTIONS as readonly unknown[]).includes(value);
}
