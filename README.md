# Yxorp

**Yxorp** is a local reverse proxy for rewriting, mocking, and debugging API responses. Think of it as a lightweight Swiss Army knife for HTTP(S) traffic — useful when you're developing a frontend against an API that's not quite ready, needs some data tweaking, or just returns the wrong thing.

It sits between your app and a target server, and you get to decide what happens to every request and response.

---

## Installation

```bash
npm i -g yxorp
```

---

## Quick Start

**1. Create a config file** — `yxorp.json` in your project root:

```json
{
  "target": "https://api.example.com",
  "proxyPort": 3000
}
```

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

When config lives inside `.yxorp/`, all relative paths (scripts, mock files, static directories) are resolved relative to that directory. This keeps things tidy:

```
my-project/
  .yxorp/
    settings.json
    mock/
      users.js
    static/
      logo.svg
```

---

## Config Reference

### `target` (required)

The upstream server everything proxies to by default.

```json
"target": "https://api.example.com"
```

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

---

### `scripts`

Additional JavaScript files loaded **once at startup**. Use them to set up shared data or helpers for your mock/rewrite scripts.

Why `scripts` and not just `require()` inside each mock file? Because mock scripts are hot-reloaded on every request (their module cache is cleared). Any data they `require()` would also need to be re-imported. Scripts loaded via the `scripts` array sidestep this — they run once at startup and can stash data on `globalThis` for all mock/rewrite scripts to use.

```json
"scripts": [
  "./scripts/seed-data.js"
]
```

```javascript
// scripts/seed-data.js — runs once, survives hot-reload
globalThis.users = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];
```

```javascript
// mock/user.js — hot-reloaded on every request, but seed-data is untouched
module.exports = (req, res) => {
  const user = globalThis.users.find(u => u.id === Number(req.params.id));
  res.end(JSON.stringify(user));
};
```

As a rule of thumb:
- **`scripts`** — for data you initialize once (lookup tables, config, seed data)
- **`require()` inside mock/rewrite files** — for utility helpers you want imported fresh each time

---

### Mock Rules (`mockRules`)

Intercept a matching request **before** it reaches the target and respond immediately. The target server never sees it.

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

The script receives `req` and `res` and does whatever it wants:

```javascript
// ./mock/create-user.js
module.exports = (req, res) => {
  res.statusCode = 201;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ id: 42, status: 'created' }));
};
```

**Hot-reload is built-in** — edit the script file and the next request picks up changes automatically. No restart needed.

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

#### By file — replace the entire response body:

```json
{
  "method": "GET",
  "path": "/api/users/:id",
  "file": "./rewrite/user-override.json",
  "statusCode": 200
}
```

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

Whatever you return becomes the new response body.

---

### Remote Rules (`remoteRules`)

Route specific paths to a **different target server** instead of the default one:

```json
{
  "remoteRules": [
    {
      "path": "/api/legacy/:rest",
      "target": "http://localhost:4000",
      "ws": false
    }
  ]
}
```

The `ws` option enables WebSocket proxying for that route.

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
| `path` | string | URL path prefix to match |
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

For more advanced patterns, see the [path-to-regexp documentation](https://github.com/pillarjs/path-to-regexp).

---

## Full Example

Here's a complete config showing all features in action:

```json
{
  "target": "https://api.example.com",
  "proxyPort": 3000,

  "scripts": [
    "./scripts/globals.js"
  ],

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
      "path": "/api/v1",
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

### Scripts

Mock and rewrite scripts are reloaded on every request — **just save the file and the next request uses the new code**. No need to restart Yxorp.

This is especially handy during development when you're iterating on API response shapes.

---

## Development

```bash
# Clone and run in dev mode (with auto-reload)
npm start

# Run tests (integration tests spin up real servers)
npm test

# Build for production
npm run build
```

---

## Why "Yxorp"?

Spell it backwards.
