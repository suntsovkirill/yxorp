import fs from 'fs';
import path from 'path';

/** The yxorp package version (package.json sits one level above src/ and dist/). */
export function readVersion(): string {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')).version;
}
