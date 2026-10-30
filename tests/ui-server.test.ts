import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { startYxorp, YxorpServer } from '../src/app';
import { createRecordingLogger, fetchYxorp } from './helpers/create-yxorp';

let target: http.Server;
let targetUrl: string;
let targetHits: { method?: string; url?: string; body: string }[] = [];

beforeAll(async () => {
  target = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      targetHits.push({ method: req.method, url: req.url, body });
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ from: 'target', url: req.url }));
    });
  });
  await new Promise<void>((resolve) => target.listen(0, resolve));
  targetUrl = `http://localhost:${(target.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => target.close(() => resolve()));
});

/** Calls the UI server, with the token by default. */
function ui(
  baseUrl: string,
  urlPath: string,
  options: { method?: string; body?: unknown; token?: string | null; host?: string } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; json: any }> {
  const url = new URL(urlPath, baseUrl);
  // Explicit content-length: Node doesn't chunk DELETE bodies by default.
  const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method ?? 'GET',
      headers: {
        ...(options.token !== null ? { 'x-yxorp-token': options.token ?? token } : {}),
        ...(options.host ? { host: options.host } : {}),
        ...(payload !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
      },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json: any;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode!, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

let token: string;
let dir: string;
let configPath: string;
let includedPath: string;
let proxy: YxorpServer;

const readConfig = (file = configPath) => JSON.parse(fs.readFileSync(file, 'utf-8'));

beforeEach(async () => {
  await proxy?.close();
  targetHits = [];

  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-ui-'));
  configPath = path.join(dir, 'yxorp.json');
  includedPath = path.join(dir, 'extra.json');

  fs.writeFileSync(includedPath, JSON.stringify({ mockRules: [{ method: 'GET', path: '/included', json: 'included' }] }, null, 2));
  // Four-space indentation — edits must keep it.
  fs.writeFileSync(configPath, JSON.stringify({
    target: targetUrl,
    proxyPort: 0,
    include: ['./extra.json'],
    mockRules: [
      { method: 'GET', path: '/first', json: 'first' },
      { method: 'GET', path: '/second', json: 'second' },
    ],
    profiles: { empty: { mockRules: [{ method: 'GET', path: '/api/list', json: [] }] } },
  }, null, 4));

  proxy = await startYxorp({ configPath, ui: { port: 0 }, logger: createRecordingLogger().logger });

  const index = await ui(proxy.uiUrl!, '/', { token: null });
  token = /name="yxorp-token" content="([0-9a-f]+)"/.exec(index.text)![1];
});

afterAll(async () => {
  await proxy?.close();
});

async function waitForTraffic(predicate: (item: any) => boolean) {
  for (let i = 0; i < 100; i++) {
    const found = (await ui(proxy.uiUrl!, '/api/traffic')).json.find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Request not captured');
}

describe('web UI: page and security', () => {
  it('listens on 127.0.0.1 and serves the app with a token and a strict CSP', async () => {
    expect(proxy.uiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const index = await ui(proxy.uiUrl!, '/', { token: null });
    expect(index.status).toBe(200);
    expect(index.text).not.toContain('%%YXORP_TOKEN%%');
    expect(index.headers['content-security-policy']).toContain("script-src 'self'");

    expect((await ui(proxy.uiUrl!, '/app.js', { token: null })).status).toBe(200);
    expect((await ui(proxy.uiUrl!, '/style.css', { token: null })).headers['content-type']).toContain('text/css');
    expect((await ui(proxy.uiUrl!, '/../package.json', { token: null })).status).toBe(404);
  });

  it('rejects API calls without the right token', async () => {
    expect((await ui(proxy.uiUrl!, '/api/state', { token: null })).status).toBe(403);
    expect((await ui(proxy.uiUrl!, '/api/state', { token: 'wrong' })).status).toBe(403);
    expect((await ui(proxy.uiUrl!, '/api/state')).status).toBe(200);
  });

  it('rejects non-loopback Host headers (DNS rebinding)', async () => {
    expect((await ui(proxy.uiUrl!, '/api/state', { host: 'evil.example:4040' })).status).toBe(403);
    expect((await ui(proxy.uiUrl!, '/', { token: null, host: 'evil.example' })).status).toBe(403);
    expect((await ui(proxy.uiUrl!, '/api/state', { host: 'localhost:4040' })).status).toBe(200);
  });
});

describe('web UI: state and rules', () => {
  it('lists rules with the file and position they come from', async () => {
    const { json: state } = await ui(proxy.uiUrl!, '/api/state');

    expect(state.writable).toBe(true);
    expect(state.profiles).toEqual(['empty']);
    expect(state.rules.map((r: any) => [r.rule.path, path.basename(r.file), r.path, r.profile ?? null])).toEqual([
      ['/first', 'yxorp.json', ['mockRules', 0], null],
      ['/second', 'yxorp.json', ['mockRules', 1], null],
      ['/included', 'extra.json', ['mockRules', 0], null],
      ['/api/list', 'yxorp.json', ['profiles', 'empty', 'mockRules', 0], 'empty'],
    ]);
  });

  it('disables a rule in an included file and applies it immediately', async () => {
    expect(JSON.parse((await fetchYxorp(proxy.port, '/included')).body)).toBe('included');

    const res = await ui(proxy.uiUrl!, '/api/rules', { method: 'PATCH', body: { file: includedPath, path: ['mockRules', 0], disabled: true } });
    expect(res.status).toBe(200);
    expect(readConfig(includedPath).mockRules[0].disable).toBe(true);

    expect(JSON.parse((await fetchYxorp(proxy.port, '/included')).body)).toEqual({ from: 'target', url: '/included' });
  });

  it('moves, edits and deletes rules, keeping the file indentation', async () => {
    await ui(proxy.uiUrl!, '/api/rules/move', { method: 'POST', body: { file: configPath, path: ['mockRules', 1], to: 0 } });
    expect(readConfig().mockRules.map((r: any) => r.path)).toEqual(['/second', '/first']);

    await ui(proxy.uiUrl!, '/api/rules', { method: 'PUT', body: { file: configPath, path: ['mockRules', 0], rule: { method: 'GET', path: '/second', json: 'edited' } } });
    expect(JSON.parse((await fetchYxorp(proxy.port, '/second')).body)).toBe('edited');

    await ui(proxy.uiUrl!, '/api/rules', { method: 'DELETE', body: { file: configPath, path: ['mockRules', 0] } });
    expect(readConfig().mockRules.map((r: any) => r.path)).toEqual(['/first']);

    expect(fs.readFileSync(configPath, 'utf-8')).toMatch(/^\{\n {4}"target"/);
  });

  it('refuses an edit that would make the config invalid, leaving the file alone', async () => {
    const before = fs.readFileSync(configPath, 'utf-8');
    const res = await ui(proxy.uiUrl!, '/api/rules', { method: 'PUT', body: { file: configPath, path: ['mockRules', 0], rule: { method: 'GET', path: '/x' } } });

    expect(res.status).toBe(400);
    expect(res.json.errors).toContainEqual(expect.stringContaining('must declare one of "file", "script", "json" or "body"'));
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
  });

  it('only writes files that are part of the config, and only rule paths', async () => {
    const outside = path.join(dir, 'other.json');
    fs.writeFileSync(outside, '{"mockRules":[{"method":"GET","path":"/x","json":1}]}');

    expect((await ui(proxy.uiUrl!, '/api/rules', { method: 'DELETE', body: { file: outside, path: ['mockRules', 0] } })).status).toBe(403);
    expect((await ui(proxy.uiUrl!, '/api/rules', { method: 'PUT', body: { file: configPath, path: ['target'], rule: {} } })).status).toBe(400);
  });

  it('adds rules, also to profiles, and switches the profile', async () => {
    await ui(proxy.uiUrl!, '/api/rules', { method: 'POST', body: { section: 'mockRules', rule: { method: 'GET', path: '/new', json: 'new' }, position: 'first' } });
    expect(readConfig().mockRules[0].path).toBe('/new');
    expect(JSON.parse((await fetchYxorp(proxy.port, '/new')).body)).toBe('new');

    await ui(proxy.uiUrl!, '/api/rules', { method: 'POST', body: { section: 'mockRules', rule: { method: 'GET', path: '/p', json: 'p' }, profile: 'empty' } });
    expect(readConfig().profiles.empty.mockRules[0].path).toBe('/p');

    const { json: state } = await ui(proxy.uiUrl!, '/api/profile', { method: 'PUT', body: { profile: 'empty' } });
    expect(state.profile).toBe('empty');
    expect(JSON.parse((await fetchYxorp(proxy.port, '/api/list')).body)).toEqual([]);

    await ui(proxy.uiUrl!, '/api/profile', { method: 'PUT', body: { profile: null } });
    expect(readConfig().profile).toBeUndefined();
  });

  it('reads and writes the raw config, validating it', async () => {
    const { json: config } = await ui(proxy.uiUrl!, '/api/config');
    expect(config.path).toBe(configPath);
    expect(JSON.parse(config.text).proxyPort).toBe(0);

    expect((await ui(proxy.uiUrl!, '/api/config', { method: 'PUT', body: { text: '{ nope' } })).status).toBe(400);
    expect((await ui(proxy.uiUrl!, '/api/config', { method: 'PUT', body: { text: '{"proxyPort":0}' } })).json.errors)
      .toContainEqual(expect.stringContaining('"target" is required'));

    const next = { ...JSON.parse(config.text), mockRules: [{ method: 'GET', path: '/raw', json: 'raw' }] };
    expect((await ui(proxy.uiUrl!, '/api/config', { method: 'PUT', body: { text: JSON.stringify(next) } })).status).toBe(200);
    expect(JSON.parse((await fetchYxorp(proxy.port, '/raw')).body)).toBe('raw');
  });
});

describe('web UI: traffic', () => {
  it('lists captured requests and shows their decoded details', async () => {
    await fetchYxorp(proxy.port, '/api/things?x=1', { method: 'POST', body: '{"a":1}' });
    const item = await waitForTraffic(t => t.url === '/api/things?x=1');

    expect(item).toMatchObject({ method: 'POST', statusCode: 200, handledBy: 'stream' });

    const { json: detail } = await ui(proxy.uiUrl!, `/api/traffic/${item.id}`);
    expect(detail.request.body).toMatchObject({ text: '{"a":1}', encoding: 'utf-8' });
    expect(JSON.parse(detail.response.body.text)).toEqual({ from: 'target', url: '/api/things?x=1' });
  });

  it('streams new traffic over server-sent events', async () => {
    const received = new Promise<string>((resolve, reject) => {
      const req = http.get(`${proxy.uiUrl}/api/events?token=${token}`, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk;
          const match = /event: traffic\ndata: (.*)\n/.exec(buffer);
          if (match) {
            resolve(JSON.parse(match[1]).url);
            req.destroy();
          }
        });
      });
      req.on('error', reject);
      setTimeout(() => fetchYxorp(proxy.port, '/api/live'), 100);
    });

    expect(await received).toBe('/api/live');
  });

  it('turns a response into a mock rule that takes over the route', async () => {
    await fetchYxorp(proxy.port, '/api/orders?page=2');
    const item = await waitForTraffic(t => t.url === '/api/orders?page=2');

    const res = await ui(proxy.uiUrl!, `/api/traffic/${item.id}/mock`, {
      method: 'POST',
      body: { statusCode: 201, body: '{"orders":[]}', matchQuery: true },
    });

    expect(res.status).toBe(200);
    expect(readConfig().mockRules[0]).toEqual({
      method: 'GET',
      path: '/api/orders',
      match: { query: { page: '2' } },
      statusCode: 201,
      // Inline json is served as application/json — no headers needed.
      json: { orders: [] },
    });

    const mocked = await fetchYxorp(proxy.port, '/api/orders?page=2');
    expect(mocked.statusCode).toBe(201);
    expect(JSON.parse(mocked.body)).toEqual({ orders: [] });
    expect(JSON.parse((await fetchYxorp(proxy.port, '/api/orders?page=3')).body).from).toBe('target');
  });

  it('replays a request through the proxy, optionally modified', async () => {
    await fetchYxorp(proxy.port, '/api/replay-me', { method: 'POST', body: 'original' });
    const item = await waitForTraffic(t => t.url === '/api/replay-me');
    targetHits = [];

    expect((await ui(proxy.uiUrl!, `/api/traffic/${item.id}/replay`, { method: 'POST', body: {} })).json).toEqual({ statusCode: 200 });
    expect(targetHits).toEqual([{ method: 'POST', url: '/api/replay-me', body: 'original' }]);

    await ui(proxy.uiUrl!, `/api/traffic/${item.id}/replay`, { method: 'POST', body: { method: 'PUT', url: '/api/changed', body: 'changed' } });
    expect(targetHits[1]).toEqual({ method: 'PUT', url: '/api/changed', body: 'changed' });
  });

  it('clears the traffic log and the script store', async () => {
    proxy.store.set('todos', [1]);
    expect((await ui(proxy.uiUrl!, '/api/state')).json.store).toEqual({ size: 1, keys: ['todos'] });

    await ui(proxy.uiUrl!, '/api/store/reset', { method: 'POST' });
    expect(proxy.store.size).toBe(0);

    await fetchYxorp(proxy.port, '/api/x');
    await waitForTraffic(() => true);
    await ui(proxy.uiUrl!, '/api/traffic', { method: 'DELETE' });
    expect((await ui(proxy.uiUrl!, '/api/traffic')).json).toEqual([]);
  });
});

describe('web UI: read-only mode', () => {
  it('shows a proxy started from a config object without allowing edits', async () => {
    const readOnly = await startYxorp({
      config: { target: targetUrl, proxyPort: 0, mockRules: [{ method: 'GET', path: '/a', json: 1 }] },
      ui: { port: 0 },
      logger: createRecordingLogger().logger,
    });

    try {
      const page = await ui(readOnly.uiUrl!, '/', { token: null });
      const readOnlyToken = /content="([0-9a-f]+)"/.exec(page.text)![1];

      const { json: state } = await ui(readOnly.uiUrl!, '/api/state', { token: readOnlyToken });
      expect(state.writable).toBe(false);
      expect(state.rules.map((r: any) => r.rule.path)).toEqual(['/a']);

      expect((await ui(readOnly.uiUrl!, '/api/config', { token: readOnlyToken })).status).toBe(409);
    } finally {
      await readOnly.close();
    }
  });
});
