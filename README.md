# Yxorp

[![CI](https://github.com/suntsovkirill/yxorp/actions/workflows/ci.yml/badge.svg)](https://github.com/suntsovkirill/yxorp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/yxorp.svg)](https://www.npmjs.com/package/yxorp)
[![license](https://img.shields.io/npm/l/yxorp.svg)](https://github.com/suntsovkirill/yxorp/blob/main/LICENSE)

**Yxorp** is a local reverse proxy for rewriting, mocking, and debugging API responses. Think of it as a lightweight Swiss Army knife for HTTP(S) traffic — useful when you're developing a frontend against an API that's not quite ready, needs some data tweaking, or just returns the wrong thing.

It sits between your app and a target server, and you get to decide what happens to every request and response.

> **Pre-1.0 — expect change.** Yxorp is under active development. While the version is `0.x`, anything public-facing — the config schema, CLI flags, and mock/rewrite script signatures — may change between releases. Pin a version if you need stability; breaking changes are called out in the [CHANGELOG](CHANGELOG.md).

---

## Installation

```bash
npm i -g yxorp
```

Requires Node.js 20.19+ or 22.12+.

---

## Quick Start

**1. Create a config file** — `yxorp.json` in your project root:

```bash
yxorp init --target https://api.example.com
```

or by hand:

```json
{
  "$schema": "https://unpkg.com/yxorp/schema.json",
  "target": "https://api.example.com",
  "proxyPort": 3000
}
```

The `$schema` line gives you autocompletion and inline validation in VS Code and other editors that understand JSON Schema.

**2. Run it:**

```bash
yxorp
```

That's it. Yxorp starts on `http://localhost:3000` and proxies everything to `https://api.example.com`. Open your app, point it at `http://localhost:3000`, and watch the traffic flow.

Now the fun part — start adding rules.

---

## Config Resolution

Yxorp looks for its config in this order:

| Priority | Location | Example |
|----------|----------|---------|
| 1 | `--config <path>` flag | `yxorp --config ./proxy/settings.json` |
| 2 | `./yxorp.json` | In your project root |
| 3 | `./.yxorp/settings.json` | Inside a hidden `.yxorp` directory |

When config lives inside `.yxorp/`, all relative paths (mock files, rewrite files, static directories) are resolved relative to that directory. This keeps things tidy:

```
my-project/
  .yxorp/
    settings.json
    mock/
      users.js
    static/
      logo.svg
```

### CLI overrides

`--port` and `--target` override the corresponding config values without touching the file — handy for one-off runs or scripting:

```bash
yxorp --port 4000 --target http://localhost:8080
```

### All flags

| Flag | Description |
|------|-------------|
| `--config <path>` | Config file to use |
| `--port <port>` | Override `proxyPort` |
| `--target <url>` | Override `target` |
| `--quiet` | Log only warnings and errors |
| `--verbose` | Also log debug details: which rule matched, where a request was routed, error stacks |
| `--har <file>` | Save all traffic to a HAR file — see [Recording traffic](#recording-traffic) |
| `--record <dir>` | Save proxied responses as mock files — see [Recording traffic](#recording-traffic) |
| `-v`, `--version` | Print the version |
| `-h`, `--help` | Print help |

`yxorp init [--target <url>] [--port <port>]` creates a starter `yxorp.json` (with `$schema`) in the current directory.

### Config validation

The config is checked at startup and on every hot-reload. Invalid values (a `target` that isn't an absolute `http(s)` URL, an unknown HTTP `method`, a `statusCode` outside 100–599, a malformed `path` pattern…) stop Yxorp from starting — or, on reload, keep the previous config — with a message pointing at the offending field. Unknown keys (usually typos like `mockRule` or `statuscode`) are reported as warnings. The same rules are published as a JSON Schema ([`schema.json`](schema.json)) for editors — reference it with `"$schema"`.

---

## Config Reference

### `target` (required)

The upstream server everything proxies to by default — an absolute `http://` or `https://` URL.

```json
"target": "https://api.example.com"
```

If the target can't be reached, the client gets a `502` with a plain-text explanation, e.g. `yxorp: cannot reach http://localhost:8080: ECONNREFUSED`.

### `proxyPort` (required)

Port for the local proxy server.

```json
"proxyPort": 8080
```

### `proxyHeaders`

Extra HTTP headers to send with every proxied request to the target server. Useful when the target rejects requests with a missing or unexpected `User-Agent`, `Origin`, or custom header.

```json
{
  "target": "https://api.example.com",
  "proxyPort": 3000,
  "proxyHeaders": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "origin": "https://example.com"
  }
}
```

### `changeOrigin`

Rewrite the `Host` header of proxied requests to the target's host. Default: `true`. Set to `false` to forward the client's original `Host` header.

### `secure`

Verify the target's TLS certificate. Default: `false`, so targets with self-signed certificates work out of the box. Set to `true` to reject invalid certificates.

```json
{
  "target": "https://api.example.com",
  "proxyPort": 3000,
  "changeOrigin": false,
  "secure": true
}
```

### `cors`

Lets a frontend on another origin (e.g. a dev server on `http://localhost:5173`) call the proxy directly. Yxorp answers CORS preflight requests (`OPTIONS` with `Access-Control-Request-Method`) itself, allowing exactly the method and headers the browser asks for, and adds CORS headers to every response — proxied, mocked, static, and errors. On proxied responses they **replace** the target's own CORS headers, which usually only allow the production origin.

```json
"cors": true
```

`true` allows any origin (echoed back, so cookies work too). For more control:

```json
"cors": {
  "origin": ["http://localhost:5173"],
  "credentials": true,
  "maxAge": 600,
  "exposeHeaders": ["x-total-count"]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `origin` | any | Allowed origin or list of origins (`"*"` = any) |
| `credentials` | `true` | Send `Access-Control-Allow-Credentials: true` |
| `maxAge` | `600` | How long (seconds) the browser may cache a preflight |
| `exposeHeaders` | — | Response headers the page's JavaScript may read |

### `https`

Serve the proxy over HTTPS (and WebSockets over WSS), e.g. when your app needs a secure context. Point it at a PEM key and certificate — [mkcert](https://github.com/FiloSottile/mkcert) makes a locally trusted pair in one command:

```bash
mkcert localhost
```

```json
"https": {
  "key": "./localhost-key.pem",
  "cert": "./localhost.pem"
}
```

Changing `https` (like `proxyPort`) needs a restart.

---

### Mock Rules (`mockRules`)

Intercept a matching request **before** it reaches the target and respond immediately. The target server never sees it.

Each rule declares where the response comes from — exactly one of `file`, `json`, `body`, or `script`.

#### Inline — respond with JSON or text right from the config:

```json
{ "method": "GET", "path": "/api/flags", "json": { "newCheckout": true } }
```

```json
{ "method": "GET", "path": "/health", "body": "ok" }
```

`json` responses get `content-type: application/json`, `body` responses `text/plain; charset=utf-8`.

#### By file — respond with a JSON file:

```json
{
  "method": "GET",
  "path": "/api/users/:id",
  "file": "./mock/user.json",
  "statusCode": 200
}
```

#### By script — dynamic response logic:

```json
{
  "method": "POST",
  "path": "/api/users",
  "script": "./mock/create-user.js"
}
```

The script receives the raw Node.js `req` (`IncomingMessage`) and `res` (`ServerResponse`) — **just like writing a tiny backend**. There's no magic layered on top: you're fully responsible for setting the status code, headers, and body yourself, exactly as the real target server would.

```javascript
// ./mock/create-user.js
module.exports = (req, res) => {
  res.statusCode = 201;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ id: 42, status: 'created' }));
};
```

If you don't set `res.statusCode`, it defaults to Node's `200` (or the rule's `statusCode`). If you don't call `res.end()`, the response hangs — Yxorp won't do it for you. The only assist it provides: if the script finishes without sending headers or setting a content type, Yxorp sets `content-type: application/json` for you (handy for quick `res.end(JSON.stringify(...))` one-liners).

Besides the usual `req` properties, a mock script gets:

| | |
|---|---|
| `req.mockRuleParams` | Path params, e.g. `{ id: '42' }` for `/api/users/:id` |
| `req.query` | Parsed query string |
| `await req.json()` | Request body parsed as JSON |
| `await req.text()` | Request body as a string |
| `await req.buffer()` | Request body as a `Buffer` |

```javascript
// ./mock/echo-user.js
module.exports = async (req, res) => {
  const user = await req.json();
  res.statusCode = 201;
  res.end(JSON.stringify({ id: 42, ...user }));
};
```

The body is only read when you call one of these, so a script that reads the request stream itself (`req.on('data', ...)`) keeps working.

Scripts can be CommonJS (`module.exports = ...`), ES modules (`export default ...` in a `.mjs` file, or `.js` in a `"type": "module"` package), or TypeScript (`.ts` — on Node.js 22.18+, which runs TypeScript natively).

This mirrors how a real backend works on purpose — mock scripts are meant to **stand in for the target server**, so the same rules apply: you decide what the client receives, down to the last header.

**Hot-reload is built-in** — edit the script file and the next request picks up changes automatically. No restart needed.

#### Rule options

These work on every mock rule (and on rewrite rules):

| Option | Description |
|--------|-------------|
| `statusCode` | Response status (for scripts: the default, which the script can change) |
| `headers` | Response headers, e.g. `{ "x-total-count": "42" }` — win over the defaults above |
| `delay` | Milliseconds to wait before responding — simulate a slow backend, test your loading states |
| `match` | Extra conditions on the query string and request headers — see below |
| `disable` | Skip this rule |

```json
{
  "method": "GET",
  "path": "/api/orders",
  "json": [],
  "headers": { "x-total-count": "0" },
  "delay": 1500
}
```

#### Match on query and headers

By default a rule matches on method and path alone. `match` narrows it down: every listed query param and request header must be present with exactly that value (header names are case-insensitive). Rules are checked top to bottom and the first match wins, so put the most specific ones first:

```json
"mockRules": [
  { "method": "GET", "path": "/api/orders", "match": { "query": { "status": "empty" } }, "json": [] },
  { "method": "GET", "path": "/api/me", "match": { "headers": { "x-role": "admin" } }, "file": "./mock/admin.json" },
  { "method": "GET", "path": "/api/me", "file": "./mock/user.json" }
]
```

#### Disable a rule:

```json
{
  "method": "GET",
  "path": "/api/users/:id",
  "file": "./mock/user.json",
  "disable": true
}
```

Disabled rules are skipped, and the request passes through to the next matching middleware (rewrite, then proxy).

---

### Rewrite Rules (`rewriteRules`)

Let the request reach the target, then **modify the response** before it gets back to your app.

#### By file or inline — replace the entire response body:

```json
{
  "method": "GET",
  "path": "/api/users/:id",
  "file": "./rewrite/user-override.json",
  "statusCode": 200
}
```

`json` and `body` work here too, as do `statusCode`, `headers` (which override the target's response headers), `delay`, and `match`. A `json` body sets `content-type: application/json`; `file` and `body` keep the target's content type unless you set one in `headers`.

#### By script — transform the response body:

```json
{
  "method": "GET",
  "path": "/api/users/:id",
  "script": "./rewrite/user.js"
}
```

The script receives the decoded response body, the proxy response, the original request, and the outgoing response:

```javascript
// ./rewrite/user.js
module.exports = (body, proxyRes, req, res) => {
  const data = JSON.parse(body.toString());
  data.processedBy = 'yxorp';
  return Buffer.from(JSON.stringify(data));
};
```

Whatever you return becomes the new response body:

| Return value | Body |
|--------------|------|
| `Buffer` / `Uint8Array` | sent as is |
| string | sent as UTF-8 |
| object, array, number… | JSON-serialized |
| `undefined` / `null` | original body kept (a warning is logged — usually a forgotten `return`) |

If the script doesn't export a function, or throws, the error is logged and the original response is passed through unchanged.

**Note:** rewriting buffers the entire response before sending it, so a route with a rewrite rule can't also stream — don't put one on an SSE feed or other long-lived streaming endpoint, or the response will never reach the client. See [Streaming & SSE](#streaming--sse).

---

### Remote Rules (`remoteRules`)

Route specific paths to a **different target server** instead of the default one:

```json
{
  "remoteRules": [
    {
      "path": "/api/legacy/*rest",
      "target": "http://localhost:4000",
      "ws": false
    }
  ]
}
```

How the request path is built depends on whether `target` has a path:

| `path` | `target` | Request | Sent to |
|--------|----------|---------|---------|
| `/api/legacy/*rest` | `http://localhost:4000` | `/api/legacy/users?page=2` | `http://localhost:4000/api/legacy/users?page=2` — only the host changes |
| `/legacy/:id` | `http://localhost:4000/v2/items/:id` | `/legacy/5?page=2` | `http://localhost:4000/v2/items/5?page=2` — the path is rebuilt from the params |
| `/legacy/*rest` | `http://localhost:4000/v2/*rest` | `/legacy/a/b` | `http://localhost:4000/v2/a/b` |

The request's query string is always carried over (and appended to any query string in `target`). `target` must be an absolute URL (`http`, `https`, `ws` or `wss`).

The `ws` option enables WebSocket proxying for that route. Each WebSocket connection gets one access-log line with a `ws` label when it closes — `101` if the upstream accepted the upgrade, the upstream's status if it refused, or `502` if it couldn't be reached.

---

### Static Rules (`staticRules`)

Serve local files as if they were on the remote server:

```json
{
  "staticRules": [
    {
      "path": "/assets",
      "directory": "./static-files"
    }
  ]
}
```

Requests to `http://localhost:3000/assets/logo.svg` will serve `./static-files/logo.svg` directly, without hitting the target.

Options:

| Option | Type | Description |
|--------|------|-------------|
| `path` | string | URL path prefix to match, on whole segments (`/assets` matches `/assets/logo.svg`, not `/assets-old/logo.svg`) |
| `directory` | string | Local directory to serve files from |
| `caseInsensitive` | boolean | Ignore filename case when matching |
| `directoryIndex` | string | Default file for directory requests (e.g. `index.html`) |
| `disable` | boolean | Skip this rule |

---

### Path Matching

All rules use `path-to-regexp` v8 for URL matching — the same library used by Express, Koa, and many other frameworks.

| Pattern | Matches | `params` |
|---------|---------|----------|
| `/api/users` | `/api/users` exactly | `{}` |
| `/api/users/:id` | `/api/users/42`, `/api/users/abc` | `{ id: '42' }` |
| `/api/users/:id/photos` | `/api/users/42/photos` | `{ id: '42' }` |
| `/api/*rest` | `/api/users`, `/api/users/42/photos` | `{ rest: ['users', '42', 'photos'] }` |
| `/api/v1{/*rest}` | `/api/v1` and everything under it | `{}` or `{ rest: [...] }` |

Patterns match the URL **path** only — the query string is ignored for matching, so `/api/users` also matches `/api/users?page=2` (query params are available to mock scripts as `req.query`, and mock/rewrite rules can require specific ones with [`match`](#match-on-query-and-headers)). A pattern without a wildcard matches the whole path exactly: `/api/v1` does not match `/api/v1/users`.

For more advanced patterns, see the [path-to-regexp documentation](https://github.com/pillarjs/path-to-regexp).

---

### A Note on Script Security

Mock and rewrite scripts (`"script": "./path/to/file.js"`) are loaded with Node's `require()`/`import()` and run with the same privileges as Yxorp itself — full filesystem, network, and process access, with no sandboxing.

Only point Yxorp at config files (and the scripts they reference) that you trust, the same way you'd treat any other local Node script. Don't load a config from an untrusted source.

---

## Streaming & SSE

Responses stream straight through to your client as they arrive from the target. Server-Sent Events (`text/event-stream`) and other long-lived chunked responses — like a streaming LLM API — reach your app incrementally, exactly as the upstream sends them, without being buffered in memory first.

The one exception is a route with a matching **rewrite rule**. Rewriting needs the whole body at once — the script receives the complete response as a single buffer — so a rewritten route is buffered, not streamed. Everything else (plain proxying, remote routes) streams, with no configuration required.

**Don't combine a rewrite rule with a streaming endpoint.** Because rewriting waits for the full body, a finite response just loses incremental delivery — but a never-ending stream (an open SSE feed or a long-poll) would be buffered forever and never reach the client. Per route, pick one: stream it, or rewrite it.

In the access log, streamed responses show a `stream` label; buffered pass-through (and the rewrite path) show `proxy` and `rewrite` respectively — so you can see at a glance which path a request took.

---

## Recording traffic

### HAR export

```bash
yxorp --har traffic.har
```

Saves every request and response — headers, bodies (decoded from gzip/br), timings, status — to a [HAR](https://en.wikipedia.org/wiki/HAR_(file_format)) file. Open it in the browser devtools (Network panel → import) or any HAR viewer to inspect a session, or attach it to a bug report. The file is updated as traffic flows and completed on shutdown. Each entry carries a `_handledBy` field saying what answered it: `stream`/`proxy` (the target), `rewrite`, `mock`, `static`, or `cors`.

### Record mode

```bash
yxorp --record ./recorded
```

Turns real API responses into mocks. Every response proxied from the target is saved as a file in `./recorded`, and `./recorded/recorded.json` holds ready-made `mockRules` that replay them:

```json
{
  "mockRules": [
    { "method": "GET", "path": "/api/orders", "match": { "query": { "page": "2" } }, "file": "./recorded/GET_api_orders_1a2b3c4d.json" },
    { "method": "GET", "path": "/api/orders", "file": "./recorded/GET_api_orders.json" },
    { "method": "GET", "path": "/api/users/42", "file": "./recorded/GET_api_users_42.json" }
  ]
}
```

Click through your app once with the backend up, copy the rules you want into your config, and you can work offline. Details:

- One rule per method + path + query string (as `match.query`); a repeat request overwrites the earlier recording. Recording again into the same directory adds to what's there.
- Bodies are saved decoded; non-200 status codes and content types the file extension doesn't imply are kept in the rule.
- Only responses that came from the target unchanged are recorded — not mocked, static or rewritten ones — and not `OPTIONS`/`HEAD`, `204`/`304`, or event streams.

Both flags capture bodies up to 10 MB per request; anything longer is cut off (and not recorded).

---

## Full Example

Here's a complete config showing all features in action:

```json
{
  "$schema": "https://unpkg.com/yxorp/schema.json",
  "target": "https://api.example.com",
  "proxyPort": 3000,
  "cors": true,

  "staticRules": [
    {
      "path": "/assets",
      "directory": "./static",
      "directoryIndex": "index.html",
      "caseInsensitive": true
    }
  ],

  "remoteRules": [
    {
      "path": "/api/v1{/*rest}",
      "target": "http://localhost:4000"
    }
  ],

  "mockRules": [
    {
      "method": "GET",
      "path": "/api/users/:id",
      "file": "./mock/users.json",
      "statusCode": 200
    },
    {
      "method": "POST",
      "path": "/api/users",
      "script": "./mock/create-user.js"
    },
    {
      "method": "GET",
      "path": "/api/orders",
      "match": { "query": { "status": "empty" } },
      "json": [],
      "delay": 800
    }
  ],

  "rewriteRules": [
    {
      "method": "GET",
      "path": "/api/products/:id",
      "script": "./rewrite/product.js"
    }
  ]
}
```

---

## Hot-Reload

### Config

Yxorp watches its config file at runtime. **Save the file — changes take effect on the next request.** No restart needed.

This works for all config fields: mock rules, rewrite rules, remote rules, static rules, and headers. The proxy server keeps running and the new config is applied immediately.

`--port`/`--target` CLI overrides keep winning over the file after every reload. The fields that can't change at runtime are `proxyPort` and `https`: Yxorp logs a warning and keeps the current port and protocol until you restart it.

### Scripts

Mock and rewrite scripts are reloaded on every request — **just save the file and the next request uses the new code**. No need to restart Yxorp.

For CommonJS scripts this includes the local files they `require()` (a shared `./fixtures/users.js`, say); packages from `node_modules` stay cached. ES module and TypeScript scripts are reloaded when the script file itself changes — files *they* import are not reloaded (Node can't unload ES modules), so restart Yxorp after editing those.

This is especially handy during development when you're iterating on API response shapes.

---

## Development

```bash
# Run from source with auto-restart on changes (tsx)
npm start

# Run tests (integration tests spin up real servers)
npm test

# Tests with a coverage report (coverage/index.html)
npm run test:coverage

# Lint and typecheck
npm run lint
npm run typecheck

# Build for production
npm run build
```

---

## Why "Yxorp"?

Spell it backwards.
