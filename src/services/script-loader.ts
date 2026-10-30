import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

// Extensions that can only be loaded with `import()`.
const ESM_EXTENSIONS = new Set(['.mjs', '.mts', '.ts', '.cts']);
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.cts']);

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

/**
 * Loads a mock/rewrite script fresh on every call, so edits apply on the next
 * request, and returns its exported handler (`module.exports = fn`,
 * `export default fn`, or a transpiled `exports.default = fn`).
 *
 * - CommonJS (`.js`, `.cjs`): the script *and the local modules it requires*
 *   are evicted from `require.cache` first — evicting only the script itself
 *   would leave edited helpers (`require('./fixtures')`) stale. Packages under
 *   node_modules are kept cached.
 * - ES modules (`.mjs`, or `.js` in a `"type": "module"` package) and
 *   TypeScript (`.ts`, `.mts`, `.cts` — Node's built-in type stripping, Node
 *   22.18+) go through `import()`, keyed by the file's mtime: an edit loads a
 *   fresh copy. ES modules can't be unloaded, so every edit keeps one more
 *   copy in memory, and modules the script imports are not reloaded.
 */
export async function loadScript(scriptPath: string): Promise<unknown> {
  const fullPath = path.resolve(scriptPath);
  const extension = path.extname(fullPath);

  if (ESM_EXTENSIONS.has(extension)) {
    return importFresh(fullPath, TYPESCRIPT_EXTENSIONS.has(extension));
  }

  try {
    return getHandler(requireFresh(fullPath));
  } catch (e: any) {
    // An ES module `.js` file on a Node version without require(esm).
    if (e?.code === 'ERR_REQUIRE_ESM') {
      return importFresh(fullPath, false);
    }

    throw e;
  }
}

function requireFresh(fullPath: string): unknown {
  evictFromRequireCache(require.resolve(fullPath), new Set());
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(fullPath);
}

function evictFromRequireCache(id: string, seen: Set<string>): void {
  const cached = require.cache[id];

  if (!cached || seen.has(id)) {
    return;
  }

  seen.add(id);

  for (const child of cached.children) {
    if (!child.id.includes(NODE_MODULES)) {
      evictFromRequireCache(child.id, seen);
    }
  }

  delete require.cache[id];
}

async function importFresh(fullPath: string, isTypeScript: boolean): Promise<unknown> {
  const { mtimeMs } = await fs.stat(fullPath);
  const url = `${pathToFileURL(fullPath).href}?mtime=${mtimeMs}`;

  try {
    return getHandler(await import(url));
  } catch (e: any) {
    if (isTypeScript && e?.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      throw new Error(
        `Cannot load TypeScript script "${fullPath}": this Node.js version (${process.version}) can't run ` +
        'TypeScript natively — use Node.js 22.18+ or compile the script to JavaScript',
        { cause: e },
      );
    }

    throw e;
  }
}

function getHandler(loaded: any): unknown {
  if (typeof loaded === 'function') {
    return loaded;
  }

  // ES module namespace, require(esm) result, or transpiled `exports.default`.
  return loaded?.default ?? loaded;
}
