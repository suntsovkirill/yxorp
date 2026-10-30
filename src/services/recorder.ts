import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mime from 'mime';
import { CapturedExchange } from '../middleware/capture.middleware';
import { MockFileRule } from '../types/yxorp-config';
import { splitUrl } from '../utils/url';
import { LoggerService } from './logger.service';
import { decodeBody, headerValue } from './har-writer';

export const RECORDED_RULES_FILE = 'recorded.json';

// Only responses that came from the target unchanged are worth replaying.
const RECORDABLE_HANDLERS = new Set(['proxy', 'stream']);

/**
 * Record mode (`--record <dir>`): saves every response proxied from the target
 * as a file in `dir` and keeps `dir/recorded.json` — a `{ "mockRules": [...] }`
 * list pointing at those files — up to date, ready to paste into the config to
 * replay the API offline.
 *
 * - One rule per method + path (+ query string, as `match.query`); a repeat
 *   request overwrites the earlier recording. Rules with `match` conditions are
 *   kept ahead of the plain rule for the same path, which would otherwise
 *   shadow them.
 * - Bodies are saved decoded (no gzip), since mock files are served as is.
 * - Skipped: mocked/static/rewritten responses, OPTIONS/HEAD, 1xx/204/304,
 *   event streams, and bodies truncated by the capture size limit.
 * - `file` paths are relative to the config directory, like every rule path.
 */
export class Recorder {
  private rules: MockFileRule[] = [];
  private readonly rulesFile: string;

  constructor(
    private dir: string,
    private configDir: string,
    private logger: LoggerService,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.rulesFile = path.join(dir, RECORDED_RULES_FILE);
    this.rules = readExistingRules(this.rulesFile);
  }

  public record = async (exchange: CapturedExchange): Promise<void> => {
    const { request, response } = exchange;
    const method = request.method.toUpperCase();
    const contentType = headerValue(response.headers['content-type']);

    if (
      !RECORDABLE_HANDLERS.has(exchange.handledBy || '') ||
      method === 'OPTIONS' || method === 'HEAD' ||
      response.statusCode < 200 || response.statusCode === 204 || response.statusCode === 304 ||
      /event-stream/i.test(contentType || '') ||
      response.body.truncated
    ) {
      return;
    }

    const body = await decodeBody(response.body.data, headerValue(response.headers['content-encoding']));
    const { pathname, search } = splitUrl(request.url);
    const query = search ? Object.fromEntries(new URLSearchParams(search)) : undefined;
    const baseType = contentType?.split(';')[0].trim().toLowerCase();
    const extension = (baseType && mime.getExtension(baseType)) || 'bin';
    const fileName = `${method}_${slug(pathname)}${search ? `_${hash(search)}` : ''}.${extension}`;
    const filePath = path.join(this.dir, fileName);

    await fs.promises.writeFile(filePath, body);

    const rule: MockFileRule = {
      method,
      path: escapePathPattern(pathname),
      ...(query ? { match: { query } } : {}),
      file: toConfigRelative(this.configDir, filePath),
      ...(response.statusCode !== 200 ? { statusCode: response.statusCode } : {}),
      // Only needed when the file extension doesn't imply the right type.
      ...(contentType && mime.getType(filePath) !== baseType ? { headers: { 'content-type': contentType } } : {}),
    };

    this.upsert(rule);
    await fs.promises.writeFile(this.rulesFile, JSON.stringify({ mockRules: this.rules }, null, 2) + '\n');

    this.logger.info(`recorded ${method} ${request.url} → ${rule.file}`);
  };

  private upsert(rule: MockFileRule): void {
    const key = ruleKey(rule);
    const index = this.rules.findIndex(existing => ruleKey(existing) === key);

    if (index === -1) {
      this.rules.push(rule);
    } else {
      this.rules[index] = rule;
    }

    // Stable sort: conditional rules before unconditional ones.
    this.rules.sort((a, b) => Number(!a.match) - Number(!b.match));
  }
}

function readExistingRules(rulesFile: string): MockFileRule[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(rulesFile, 'utf-8'));
    return Array.isArray(parsed?.mockRules) ? parsed.mockRules : [];
  } catch {
    return [];
  }
}

function ruleKey(rule: MockFileRule): string {
  return JSON.stringify([rule.method, rule.path, rule.match?.query ?? null]);
}

/** Escapes path-to-regexp's reserved characters so a recorded path matches literally. */
export function escapePathPattern(pathname: string): string {
  return pathname.replace(/[{}()[\]+?!:*\\]/g, char => `\\${char}`);
}

function slug(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean).map((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // keep the raw segment
    }
    return decoded.replace(/[^a-zA-Z0-9.-]+/g, '-');
  });

  return (segments.join('_') || 'root').slice(0, 100);
}

function hash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function toConfigRelative(configDir: string, filePath: string): string {
  const relative = path.relative(configDir, filePath).split(path.sep).join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}
