import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

const tsxCli = require.resolve('tsx/cli');

/** Runs the CLI from source via tsx — no build needed. */
function runCli(args: string[], cwd = root) {
  return spawnSync(process.execPath, [tsxCli, path.join(root, 'src/cli.ts'), ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 30000,
  });
}

// Each run starts tsx, which takes a moment — slower on Windows CI.
describe('CLI', { timeout: 30000 }, () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    tmpDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
    tmpDirs.length = 0;
  });

  it.each(['--help', '-h'])('prints usage for %s', (flag) => {
    const result = runCli([flag]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: yxorp [options]');
    expect(result.stdout).toContain('--config <path>');
  });

  it('prints the version', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('refuses to start with a target that is not an absolute URL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-cli-'));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'yxorp.json'), JSON.stringify({ target: 'localhost:8080', proxyPort: 0 }));

    const result = runCli([], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid config:');
    expect(result.stderr).toContain('absolute http(s) URL');
  });

  it('creates a config with init', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-cli-'));
    tmpDirs.push(dir);

    const result = runCli(['init', '--target', 'http://localhost:8080'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Created');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'yxorp.json'), 'utf-8')).target).toBe('http://localhost:8080');
  });
});
