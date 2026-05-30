import fs from 'fs';
import path from 'path';
import { ConfigFile } from '../types/yxorp-config';

export interface ResolvedConfig {
  configDir: string;
  config: ConfigFile;
}

export function resolveConfig(cwd: string, argv: string[]): ResolvedConfig {
  // Parse --config CLI argument
  const configArgIndex = argv.indexOf('--config');
  let configFile: string | undefined;

  if (configArgIndex !== -1 && configArgIndex + 1 < argv.length) {
    configFile = argv[configArgIndex + 1];
  }

  if (configFile) {
    const resolved = path.resolve(cwd, configFile);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${configFile}`);
    }
    return {
      configDir: path.dirname(resolved),
      config: JSON.parse(fs.readFileSync(resolved, 'utf-8')) as ConfigFile,
    };
  }

  // Default: look for config in order of preference
  const rootConfig = path.join(cwd, 'yxorp.json');
  if (fs.existsSync(rootConfig)) {
    return {
      configDir: cwd,
      config: JSON.parse(fs.readFileSync(rootConfig, 'utf-8')) as ConfigFile,
    };
  }

  const dotDir = path.join(cwd, '.yxorp');
  const dotConfig = path.join(dotDir, 'settings.json');
  if (fs.existsSync(dotConfig)) {
    return {
      configDir: dotDir,
      config: JSON.parse(fs.readFileSync(dotConfig, 'utf-8')) as ConfigFile,
    };
  }

  throw new Error(
    'Config file not found. Create yxorp.json or .yxorp/settings.json in the current directory, ' +
    'or use --config <path> to specify a config file.'
  );
}
