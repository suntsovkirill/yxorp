import crypto from 'crypto';
import fs from 'fs';
import http, { IncomingMessage, ServerResponse } from 'http';
import https from 'https';
import path from 'path';
import { EventEmitter } from 'events';
import mime from 'mime';
import { Config } from '../services/config.service';
import { LoggerService } from '../services/logger.service';
import { INCLUDABLE_SECTIONS } from '../services/config-loader';
import { escapePathPattern } from '../services/recorder';
import { headerValue, isText } from '../services/har-writer';
import { isHopByHopHeader } from '../utils/headers';
import { splitUrl } from '../utils/url';
import { describeError } from '../utils/error-response';
import { ConfigEditError, ConfigEditor, RuleEntry } from './config-editor';
import { decodedResponseBody, TrafficLog, TrafficSummary } from './traffic-log';

export const DEFAULT_UI_PORT = 4040;

// The UI only ever listens here — it can rewrite the config, which can point
// at scripts, so it must not be reachable from other machines.
const UI_HOST = '127.0.0.1';

const STATIC_DIR = path.join(__dirname, '../../ui');
const STATIC_FILES = new Set(['app.js', 'style.css']);

const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

// Mock bodies above this go to a file in <configDir>/mocks/ instead of inline.
const MAX_INLINE_MOCK_BYTES = 64 * 1024;

const SSE_HEARTBEAT_MS = 25_000;

export interface UiServerOptions {
  port?: number;
  version: string;
  appConfig: Config;
  store: Map<string, any>;
  traffic: TrafficLog;
  // Emits 'config' after every config reload.
  events: EventEmitter;
  // The proxy's own URL, for replaying requests through it.
  proxyUrl: string;
  // Absent when the proxy runs from a config object — the UI is read-only then.
  editor?: ConfigEditor;
  // Whether --profile on the command line pins the profile.
  profileFromCli: boolean;
  logger: LoggerService;
}

export interface UiServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly errors?: string[]) {
    super(message);
  }
}

/**
 * The web UI: a small single-page app (ui/) plus a JSON API over the running
 * proxy — live traffic, turning a response into a mock, replaying requests,
 * and editing rules, profiles and the raw config.
 *
 * Security: listens on 127.0.0.1 only; every API call must carry the random
 * per-run token embedded in the page (a cross-origin page can't read it, and
 * can't send the custom header without a CORS preflight, which is never
 * granted); and the Host header must be a loopback name, which defeats DNS
 * rebinding.
 */
export async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const token = crypto.randomBytes(24).toString('hex');
  const sseClients = new Set<ServerResponse>();

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: any) => {
      const status = e instanceof HttpError ? e.status : e instanceof ConfigEditError ? e.status : 500;

      if (status === 500) {
        options.logger.error(e);
      }

      if (!res.headersSent) {
        sendJson(res, status, { error: e.message, ...(e.errors ? { errors: e.errors } : {}) });
      }
    });
  });

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const { pathname, search } = splitUrl(req.url || '/');

    if (!isLoopbackHost(req.headers.host)) {
      throw new HttpError(403, 'Forbidden host');
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf-8').replace('%%YXORP_TOKEN%%', token);
      return send(res, 200, html, 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && STATIC_FILES.has(pathname.slice(1))) {
      const file = path.join(STATIC_DIR, pathname.slice(1));
      return send(res, 200, fs.readFileSync(file), mime.getType(file) ?? 'application/octet-stream');
    }

    if (!pathname.startsWith('/api/')) {
      throw new HttpError(404, 'Not found');
    }

    const suppliedToken = req.headers['x-yxorp-token'] ?? (pathname === '/api/events' ? new URLSearchParams(search).get('token') : undefined);

    if (typeof suppliedToken !== 'string' || !safeEqual(suppliedToken, token)) {
      throw new HttpError(403, 'Missing or wrong UI token');
    }

    await route(req, res, pathname);
  };

  const route = async (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    const method = req.method;
    const trafficId = /^\/api\/traffic\/(\d+)(\/mock|\/replay)?$/.exec(pathname);

    if (method === 'GET' && pathname === '/api/state') {
      return sendJson(res, 200, state());
    }

    if (method === 'GET' && pathname === '/api/events') {
      return openEventStream(req, res);
    }

    if (method === 'GET' && pathname === '/api/traffic') {
      return sendJson(res, 200, options.traffic.list());
    }

    if (method === 'DELETE' && pathname === '/api/traffic') {
      options.traffic.clear();
      return sendJson(res, 200, { ok: true });
    }

    if (trafficId) {
      const id = Number(trafficId[1]);

      if (method === 'GET' && !trafficId[2]) {
        const detail = await options.traffic.detail(id);
        if (!detail) throw new HttpError(404, `No request #${id} (it may have been dropped from the log)`);
        return sendJson(res, 200, detail);
      }

      if (method === 'POST' && trafficId[2] === '/mock') {
        return sendJson(res, 200, await mockFromTraffic(id, await readJson(req)));
      }

      if (method === 'POST' && trafficId[2] === '/replay') {
        return sendJson(res, 200, await replay(id, await readJson(req)));
      }
    }

    if (method === 'POST' && pathname === '/api/store/reset') {
      options.store.clear();
      return sendJson(res, 200, { ok: true });
    }

    const editor = options.editor;

    if (pathname === '/api/config' || pathname.startsWith('/api/rules') || pathname === '/api/profile') {
      if (!editor) {
        throw new HttpError(409, 'The proxy was started from a config object, not a file — nothing to edit');
      }

      const body = method === 'GET' ? {} : await readJson(req);

      if (method === 'GET' && pathname === '/api/config') {
        return sendJson(res, 200, { path: editor.configPath, text: editor.readMainConfig() });
      }

      if (method === 'PUT' && pathname === '/api/config') {
        editor.writeMainConfig(requireString(body.text, 'text'));
      } else if (method === 'PUT' && pathname === '/api/profile') {
        editor.setProfile(body.profile === null ? null : requireString(body.profile, 'profile'));
      } else if (method === 'POST' && pathname === '/api/rules') {
        editor.addRule(requireString(body.section, 'section'), body.rule, { position: body.position, profile: body.profile });
      } else if (method === 'PATCH' && pathname === '/api/rules') {
        editor.setDisabled(requireString(body.file, 'file'), requirePath(body.path), !!body.disabled);
      } else if (method === 'PUT' && pathname === '/api/rules') {
        editor.replaceRule(requireString(body.file, 'file'), requirePath(body.path), body.rule);
      } else if (method === 'DELETE' && pathname === '/api/rules') {
        editor.deleteRule(requireString(body.file, 'file'), requirePath(body.path));
      } else if (method === 'POST' && pathname === '/api/rules/move') {
        editor.moveRule(requireString(body.file, 'file'), requirePath(body.path), Number(body.to));
      } else {
        throw new HttpError(404, 'Not found');
      }

      return sendJson(res, 200, state());
    }

    throw new HttpError(404, 'Not found');
  };

  const state = () => {
    const config = options.appConfig.get();
    let rules: RuleEntry[];
    let profiles: string[];
    let profileInFile: string | undefined;

    if (options.editor) {
      ({ rules, profiles, profileInFile } = options.editor.listRules());
    } else {
      // Read-only: the runtime rules, without file locations.
      rules = INCLUDABLE_SECTIONS.flatMap(section => (config[section] ?? []).map((rule: unknown, index: number) => ({
        section, file: '', path: [section, index], rule,
      })));
      profiles = Object.keys(config.profiles ?? {});
      profileInFile = config.profile;
    }

    return {
      version: options.version,
      proxyUrl: options.proxyUrl,
      target: config.target,
      configPath: options.editor?.configPath ?? null,
      writable: !!options.editor,
      profile: config.profile ?? null,
      profileInFile: profileInFile ?? null,
      profileFromCli: options.profileFromCli,
      profiles,
      store: { size: options.store.size, keys: [...options.store.keys()].map(String).slice(0, 50) },
      rules,
    };
  };

  const openEventStream = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);

    const heartbeat = setInterval(() => res.write(': ping\n\n'), SSE_HEARTBEAT_MS);
    heartbeat.unref();

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  };

  const broadcast = (event: string, data: unknown) => {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => client.write(message));
  };

  const onTraffic = (summary: TrafficSummary) => broadcast('traffic', summary);
  const onConfig = () => broadcast('config', {});

  options.traffic.on('add', onTraffic);
  options.events.on('config', onConfig);

  /** Turns a captured response into a mock rule at the top of mockRules. */
  const mockFromTraffic = async (id: number, body: any) => {
    const editor = options.editor;

    if (!editor) {
      throw new HttpError(409, 'The proxy was started from a config object, not a file — nothing to edit');
    }

    const exchange = options.traffic.get(id);

    if (!exchange) {
      throw new HttpError(404, `No request #${id} (it may have been dropped from the log)`);
    }

    const { pathname, search } = splitUrl(exchange.request.url);
    const statusCode = Number(body.statusCode ?? exchange.response.statusCode);
    const contentType: string | undefined = body.contentType ?? headerValue(exchange.response.headers['content-type']);
    const content: Buffer = typeof body.body === 'string' ? Buffer.from(body.body, 'utf-8') : await decodedResponseBody(exchange);
    const baseType = contentType?.split(';')[0].trim().toLowerCase();

    const rule: Record<string, unknown> = {
      method: exchange.request.method.toUpperCase(),
      path: escapePathPattern(pathname),
      ...(body.matchQuery && search ? { match: { query: Object.fromEntries(new URLSearchParams(search)) } } : {}),
      ...(statusCode !== 200 ? { statusCode } : {}),
    };

    const json = /json/i.test(baseType ?? '') ? tryParseJson(content.toString('utf-8')) : undefined;

    if (content.length <= MAX_INLINE_MOCK_BYTES && json !== undefined) {
      rule.json = json.value;
      if (baseType !== 'application/json') rule.headers = { 'content-type': contentType };
    } else if (content.length <= MAX_INLINE_MOCK_BYTES && (isText(contentType) || !contentType)) {
      rule.body = content.toString('utf-8');
      if (contentType && baseType !== 'text/plain') rule.headers = { 'content-type': contentType };
    } else {
      const dir = path.join(path.dirname(editor.configPath), 'mocks');
      const name = `${rule.method}_${pathname.split('/').filter(Boolean).join('_').replace(/[^a-zA-Z0-9._-]+/g, '-') || 'root'}_${id}.${(baseType && mime.getExtension(baseType)) || 'bin'}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
      rule.file = `./mocks/${name}`;
      if (contentType && mime.getType(name) !== baseType) rule.headers = { 'content-type': contentType };
    }

    editor.addRule('mockRules', rule, { position: 'first' });
    return { rule, state: state() };
  };

  /** Sends a captured request through the proxy again, optionally modified. */
  const replay = async (id: number, body: any) => {
    const exchange = options.traffic.get(id);

    if (!exchange) {
      throw new HttpError(404, `No request #${id} (it may have been dropped from the log)`);
    }

    const target = new URL(options.proxyUrl);
    const method = (typeof body.method === 'string' && body.method) || exchange.request.method;
    const url = (typeof body.url === 'string' && body.url) || exchange.request.url;
    const payload = typeof body.body === 'string' ? Buffer.from(body.body, 'utf-8') : exchange.request.body.data;
    const sourceHeaders = body.headers && typeof body.headers === 'object' ? body.headers : exchange.request.headers;
    const headers: Record<string, string | string[]> = {};

    for (const [name, value] of Object.entries<any>(sourceHeaders)) {
      if (value === undefined || isHopByHopHeader(name, sourceHeaders) || ['host', 'content-length'].includes(name.toLowerCase())) continue;
      headers[name] = value;
    }

    if (payload.length) {
      headers['content-length'] = String(payload.length);
    }

    const request = target.protocol === 'https:' ? https.request : http.request;

    return new Promise<{ statusCode: number }>((resolve, reject) => {
      const outgoing = request({
        hostname: target.hostname,
        port: target.port,
        path: url,
        method,
        headers,
        // Our own proxy — possibly with a self-signed certificate.
        rejectUnauthorized: false,
      }, (response) => {
        response.resume();
        response.on('end', () => resolve({ statusCode: response.statusCode ?? 0 }));
      });

      outgoing.on('error', (e) => reject(new HttpError(502, `Replay failed: ${describeError(e)}`)));
      outgoing.end(payload.length ? payload : undefined);
    });
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_UI_PORT, UI_HOST, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const port = (server.address() as { port: number }).port;

  return {
    url: `http://${UI_HOST}:${port}`,
    port,
    close: () => {
      options.traffic.off('add', onTraffic);
      options.events.off('config', onConfig);
      sseClients.forEach(client => client.end());
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function send(res: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), 'application/json');
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;

      if (size > MAX_REQUEST_BYTES) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8');

      if (!text) {
        resolve({});
        return;
      }

      try {
        const value = JSON.parse(text);
        resolve(value && typeof value === 'object' ? value : {});
      } catch {
        reject(new HttpError(400, 'Request body must be JSON'));
      }
    });

    req.on('error', reject);
  });
}

function tryParseJson(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) {
    throw new HttpError(400, `"${name}" is required`);
  }

  return value;
}

function requirePath(value: unknown): (string | number)[] {
  if (!Array.isArray(value) || !value.every(part => typeof part === 'string' || Number.isInteger(part))) {
    throw new HttpError(400, '"path" must be an array of keys and indexes');
  }

  return value;
}
