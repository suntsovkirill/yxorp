import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initConfig } from '../src/services/init-config';
import { validateConfig } from '../src/services/config-validator';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-init-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('initConfig', () => {
  it('writes a valid starter config with $schema', () => {
    const created = initConfig(dir, ['node', 'yxorp', 'init'], '1.2.3');
    const config = JSON.parse(fs.readFileSync(created, 'utf-8'));

    expect(created).toBe(path.join(dir, 'yxorp.json'));
    expect(config).toEqual({
      $schema: 'https://unpkg.com/yxorp@1.2.3/schema.json',
      target: 'https://api.example.com',
      proxyPort: 3000,
      mockRules: [],
      rewriteRules: [],
    });
    expect(validateConfig(config)).toEqual([]);
  });

  it('takes --target and --port', () => {
    const created = initConfig(dir, ['node', 'yxorp', 'init', '--target', 'http://localhost:8080', '--port=4000'], '1.2.3');
    expect(JSON.parse(fs.readFileSync(created, 'utf-8'))).toMatchObject({ target: 'http://localhost:8080', proxyPort: 4000 });
  });

  it('refuses to overwrite an existing config', () => {
    fs.writeFileSync(path.join(dir, 'yxorp.json'), '{"keep":true}');
    expect(() => initConfig(dir, ['node', 'yxorp', 'init'], '1.2.3')).toThrow('A config already exists');
    expect(fs.readFileSync(path.join(dir, 'yxorp.json'), 'utf-8')).toBe('{"keep":true}');

    fs.rmSync(path.join(dir, 'yxorp.json'));
    fs.mkdirSync(path.join(dir, '.yxorp'));
    fs.writeFileSync(path.join(dir, '.yxorp', 'settings.json'), '{}');
    expect(() => initConfig(dir, ['node', 'yxorp', 'init'], '1.2.3')).toThrow('.yxorp');
  });

  it('rejects an invalid target without writing anything', () => {
    expect(() => initConfig(dir, ['node', 'yxorp', 'init', '--target', 'localhost:8080'], '1.2.3')).toThrow('absolute http(s) URL');
    expect(fs.existsSync(path.join(dir, 'yxorp.json'))).toBe(false);
  });
});
