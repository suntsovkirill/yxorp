import fs from 'fs/promises';
import path from 'path';
import mime from 'mime';
import { BodySource, FileSource, JsonSource, ScriptSource } from '../types/yxorp-config';

/**
 * Reads the response body a mock/rewrite rule declares inline (`json`,
 * `body`) or by file, plus the content type that goes with it. Returns
 * undefined for a `script` rule, which produces its response itself.
 */
export async function readRuleBody(
  rule: FileSource | ScriptSource | JsonSource | BodySource,
): Promise<{ body: Buffer; contentType?: string } | undefined> {
  if ('file' in rule) {
    const filePath = path.resolve(rule.file);
    return { body: await fs.readFile(filePath), contentType: mime.getType(filePath) ?? undefined };
  }

  if ('json' in rule) {
    return { body: Buffer.from(JSON.stringify(rule.json), 'utf-8'), contentType: 'application/json' };
  }

  if ('body' in rule) {
    return { body: Buffer.from(rule.body, 'utf-8'), contentType: 'text/plain; charset=utf-8' };
  }

  return undefined;
}
