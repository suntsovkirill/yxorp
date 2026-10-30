import fs from 'fs';
import path from 'path';

export type JsonPath = (string | number)[];

/** Reads a JSON file along with the indentation it uses, so a rewrite keeps it. */
export function readJsonFile(file: string): { value: any; indent: string } {
  const text = fs.readFileSync(file, 'utf-8');
  return { value: JSON.parse(text), indent: detectIndent(text) };
}

/**
 * Writes JSON atomically — to a temp file renamed over the original — so the
 * config watcher (and anyone reading) never sees a half-written file.
 */
export function writeJsonFile(file: string, value: unknown, indent = '  '): void {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(value, null, indent) + '\n');
  fs.renameSync(temp, file);
}

export function detectIndent(text: string): string {
  const match = /^[ \t]+(?=")/m.exec(text);
  return match ? match[0] : '  ';
}

export function getAt(root: any, jsonPath: JsonPath): any {
  return jsonPath.reduce((node, key) => (node == null ? undefined : node[key]), root);
}

/** The array or object containing `jsonPath`'s target, and the target's key in it. */
export function parentOf(root: any, jsonPath: JsonPath): { parent: any; key: string | number } {
  if (!jsonPath.length) {
    throw new Error('Empty JSON path');
  }

  const parent = getAt(root, jsonPath.slice(0, -1));

  if (parent == null || typeof parent !== 'object') {
    throw new Error(`Nothing at ${formatPath(jsonPath)}`);
  }

  return { parent, key: jsonPath[jsonPath.length - 1] };
}

export function formatPath(jsonPath: JsonPath): string {
  return jsonPath.map(key => (typeof key === 'number' ? `[${key}]` : `.${key}`)).join('').replace(/^\./, '');
}
