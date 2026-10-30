import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const binSource = path.resolve(__dirname, '../bin/yxorp.js');

/**
 * Copies bin/yxorp.js into a temp package layout (bin/ + optional dist/) so the
 * launcher can be exercised without depending on whether the real project is built.
 */
function createPackage(distIndex?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-bin-'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.copyFileSync(binSource, path.join(root, 'bin', 'yxorp.js'));

  if (distIndex !== undefined) {
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'index.js'), distIndex);
  }

  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, [path.join(root, 'bin', 'yxorp.js')], { encoding: 'utf-8' });
}

describe('bin/yxorp.js', () => {
  const roots: string[] = [];

  afterEach(() => {
    roots.forEach(root => fs.rmSync(root, { recursive: true, force: true }));
    roots.length = 0;
  });

  it('reports a missing build', () => {
    const root = createPackage();
    roots.push(root);

    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Yxorp is not built');
  });

  it('runs the built entry point', () => {
    const root = createPackage("console.log('started');");
    roots.push(root);

    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('started');
  });

  it('surfaces a missing dependency instead of claiming the build is missing', () => {
    const root = createPackage("require('some-uninstalled-dependency');");
    roots.push(root);

    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot find module 'some-uninstalled-dependency'");
    expect(result.stderr).not.toContain('Yxorp is not built');
  });
});
