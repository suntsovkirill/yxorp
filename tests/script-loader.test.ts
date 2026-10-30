import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { loadScript } from '../src/services/script-loader';

let dir: string;

function write(file: string, content: string): string {
  const fullPath = path.join(dir, file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

/** Rewrites a file and moves its mtime forward, so an mtime-keyed reload can't miss the edit. */
function edit(file: string, content: string): void {
  const fullPath = write(file, content);
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(fullPath, future, future);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-scripts-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadScript', () => {
  it('loads a CommonJS handler', async () => {
    const script = write('mock.js', 'module.exports = () => "cjs";');
    const handler = await loadScript(script) as () => string;
    expect(handler()).toBe('cjs');
  });

  it('reloads local modules required by a CommonJS script', async () => {
    write('helper.js', 'module.exports = { value: 1 };');
    const script = write('mock.js', 'const helper = require("./helper"); module.exports = () => helper.value;');

    expect((await loadScript(script) as () => number)()).toBe(1);

    edit('helper.js', 'module.exports = { value: 2 };');
    expect((await loadScript(script) as () => number)()).toBe(2);
  });

  it('reloads nested local modules', async () => {
    write('lib/data.js', 'module.exports = "a";');
    write('lib/index.js', 'module.exports = require("./data");');
    const script = write('mock.js', 'const data = require("./lib"); module.exports = () => data;');

    expect((await loadScript(script) as () => string)()).toBe('a');

    edit('lib/data.js', 'module.exports = "b";');
    expect((await loadScript(script) as () => string)()).toBe('b');
  });

  it('unwraps a transpiled `exports.default`', async () => {
    const script = write('mock.js', 'Object.defineProperty(exports, "__esModule", { value: true }); exports.default = () => "default";');
    expect((await loadScript(script) as () => string)()).toBe('default');
  });

  it('returns a non-function export as is, for the caller to report', async () => {
    const script = write('mock.js', 'exports.handler = () => "named";');
    expect(typeof await loadScript(script)).toBe('object');
  });
});

/**
 * ES modules and TypeScript go through `import()`, which Vite (under vitest)
 * intercepts with its own loader. Run those cases in a plain Node process
 * instead: the loader is transpiled to CommonJS exactly as `tsc` builds it
 * (keeping `import()` native) and driven step by step.
 */
describe('loadScript in plain Node (import() path)', () => {
  let loaderDir: string;
  let loaderPath: string;

  beforeAll(() => {
    loaderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-loader-'));
    loaderPath = path.join(loaderDir, 'script-loader.cjs');
    const source = fs.readFileSync(path.resolve(__dirname, '../src/services/script-loader.ts'), 'utf-8');
    const { outputText } = ts.transpileModule(source, {
      fileName: 'script-loader.cts',
      compilerOptions: { module: ts.ModuleKind.Node16, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    fs.writeFileSync(loaderPath, outputText);
  });

  afterAll(() => {
    fs.rmSync(loaderDir, { recursive: true, force: true });
  });

  type Step = { load: string; args?: unknown[] } | { edit: string; content: string };

  /** Runs load/edit steps in one Node process; returns each load's handler result (or error message). */
  function run(steps: Step[]): unknown[] {
    const harness = `
      const fs = require('fs');
      const { loadScript } = require(${JSON.stringify(loaderPath)});
      (async () => {
        const results = [];
        for (const step of ${JSON.stringify(steps)}) {
          if (step.edit) {
            fs.writeFileSync(step.edit, step.content);
            const future = new Date(Date.now() + 5000 * results.length + 5000);
            fs.utimesSync(step.edit, future, future);
            continue;
          }
          try {
            const handler = await loadScript(step.load);
            results.push(typeof handler === 'function' ? handler(...(step.args || [])) : { notAFunction: typeof handler });
          } catch (e) {
            results.push({ error: e.message });
          }
        }
        process.stdout.write(JSON.stringify(results));
      })();
    `;

    // NODE_NO_WARNINGS: some Node 22 releases print an ExperimentalWarning for type stripping.
    const result = spawnSync(process.execPath, ['-e', harness], {
      encoding: 'utf-8',
      timeout: 20000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    expect(result.stderr).toBe('');
    return JSON.parse(result.stdout);
  }

  it('loads an .mjs default export and picks up edits', () => {
    const script = write('mock.mjs', 'export default () => "v1";');

    expect(run([
      { load: script },
      { edit: script, content: 'export default () => "v2";' },
      { load: script },
    ])).toEqual(['v1', 'v2']);
  });

  it('does not reload an unchanged .mjs script', () => {
    const script = write('mock.mjs', 'let calls = 0; export default () => ++calls;');
    expect(run([{ load: script }, { load: script }])).toEqual([1, 2]);
  });

  it('loads a .js ES module from a "type": "module" package', () => {
    write('package.json', JSON.stringify({ type: 'module' }));
    const script = write('mock.js', 'export default () => "esm-js";');
    expect(run([{ load: script }])).toEqual(['esm-js']);
  });

  const supportsTypeScript = !!(process.features as { typescript?: unknown }).typescript;

  it.skipIf(!supportsTypeScript)('loads a TypeScript script and picks up edits', () => {
    const script = write('mock.ts', 'export default (name: string): string => `hi ${name}`;');

    expect(run([
      { load: script, args: ['ts'] },
      { edit: script, content: 'export default (name: string): string => `bye ${name}`;' },
      { load: script, args: ['ts'] },
    ])).toEqual(['hi ts', 'bye ts']);
  });

  it.skipIf(supportsTypeScript)('explains that TypeScript scripts need a newer Node', () => {
    const script = write('mock.ts', 'export default (): string => "ts";');
    expect(run([{ load: script }])).toEqual([{ error: expect.stringContaining('use Node.js 22.18+') }]);
  });
});
