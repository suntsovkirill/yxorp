import fs from 'fs';
import path from 'path';
import { getArgValue } from './cli-overrides';
import { validateConfig } from './config-validator';

const DEFAULT_TARGET = 'https://api.example.com';
const DEFAULT_PORT = 3000;

/**
 * `yxorp init [--target <url>] [--port <port>]`: writes a starter `yxorp.json`
 * into `cwd` — with `$schema` pointing at the config's JSON Schema, so editors
 * offer completion and validation. Refuses to overwrite an existing config.
 * Returns the created file's path.
 */
export function initConfig(cwd: string, argv: string[], version: string): string {
  const configPath = path.join(cwd, 'yxorp.json');

  for (const existing of [configPath, path.join(cwd, '.yxorp', 'settings.json')]) {
    if (fs.existsSync(existing)) {
      throw new Error(`A config already exists: ${existing}`);
    }
  }

  const port = getArgValue(argv, '--port');

  const config = {
    $schema: `https://unpkg.com/yxorp@${version}/schema.json`,
    target: getArgValue(argv, '--target') ?? DEFAULT_TARGET,
    proxyPort: port === undefined ? DEFAULT_PORT : Number(port),
    mockRules: [],
    rewriteRules: [],
  };

  const errors = validateConfig(config);

  if (errors.length) {
    throw new Error(`Cannot create the config:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return configPath;
}
