# Yxorp — Project Guide

## Overview
Yxorp is a local reverse proxy for rewriting, mocking, and debugging API responses. It sits between a client and a target server, supporting static file serving, request mocking, response rewriting, and remote routing.

## Architecture

### Two middleware pipelines (manual composition, no DI)

**Server Pipeline** (incoming requests → target):
```
StaticMiddleware → BootstrapMiddleware → MockMiddleware → ProxyMiddleware
```

**Proxy Pipeline** (target response → client):
```
StreamMiddleware → RawBodyMiddleware → RewriteMiddleware → ProxyResMiddleware
```
`StreamMiddleware` short-circuits the rest of the pipeline for responses with no rewrite rule (pipes them straight to the client); the `RawBody → Rewrite → ProxyRes` buffering path only runs when a rewrite rule is present.

### Key files
- `src/index.ts` — entry point, config resolution, manual service wiring, hot-reload setup
- `src/services/yxorp-server.service.ts` — `createServer()` wires both pipelines
- `src/services/pipeline.service.ts` — generic `Pipeline<T>` with `use()`/`execute()`
- `src/services/config-resolver.ts` — config file lookup logic; returns `configPath` alongside `configDir`
- `src/services/config-watcher.ts` — `watchConfig(path, onReload, onError)` — file watcher with 100ms debounce
- `src/services/http-server.service.ts` — wrapper around `http.createServer`
- `src/services/http-proxy.service.ts` — wrapper around httpxy
- `src/services/config-validator.ts` — validates the resolved config shape (proxy port range, per-rule entry shapes for mock/rewrite/remote/static rules) before the server starts
- `src/services/cli-overrides.ts` — `applyCliOverrides(config, argv)` layers `--port`/`--target`/`--port=value` CLI flags on top of the resolved config without touching the file

### Dependency injection
No DI container. Everything is manually composed in `index.ts`:
```typescript
const logger = new LoggerService();
const appConfig = new Config();
appConfig.set(proxyConfig);
const { listen } = createServer(appConfig, logger, rewriteMatcher, mockMatcher, remoteMatcher);
```

### HTTP proxying
Uses `httpxy` (not `http-proxy`). Key differences:
- `web()` returns `Promise<void>` (not callback-based)
- `ws()` is `ws(req, socket, options, head)` (different arg order)
- `selfHandleResponse: true` is required — proxy pipeline handles the response

### Script system
Mock/rewrite scripts use `require()` + `delete require.cache[]` for hot-reload:
```javascript
module.exports = (req, res) => { ... };
module.exports = (body, proxyRes, req, res) => { ... };
```

## Config resolution
Order: `--config <path>` → `./yxorp.json` → `./.yxorp/settings.json`

## Config hot-reload
`watchConfig` in `src/services/config-watcher.ts` watches the config file's *parent directory* via `fs.watch` (filtering events by filename) with a 100ms debounce — watching the file directly misses atomic-rename saves (editors that write a temp file then rename it over the original swap the inode, after which a direct file watch stops firing). On change it re-reads and parses the file, then calls `onReload(newConfig)`. Since all matchers and middlewares call `config.get()` per request, calling `appConfig.set()` in `onReload` takes effect immediately with no server restart.

The hot-reload test (`tests/config-watcher.test.ts`) uses soft assertions (`softExpect`) — failures print a `console.warn` but don't fail the build, because `fs.watch` can be unreliable on some platforms.

## Testing
- Framework: vitest
- Tests create real target servers and yxorp instances on random ports
- Test helpers: `tests/helpers/create-yxorp.ts`, `tests/helpers/target-server.ts`
- Fixtures in `tests/fixtures/`
- Run: `npm test`

## Node engine
Requires Node >= 20.

## Windows notes
- `localAddress: '0.0.0.0'` causes `EINVAL` on Windows — don't use it
- All paths use forward slashes

## Key patterns
- Middleware implement `Middleware<T>` with `use(...args, next)`
- Pipeline awaits middleware return value — async middleware must return Promise
- `StreamMiddleware` runs first in the proxy pipeline: when there's no `req.rewriteRule` it pipes `proxyRes` straight to the client and does **not** call `next()`, so SSE/chunked responses stream through and aren't held in memory. It returns a promise that resolves on `res`'s `'finish'`, and handles mid-stream upstream errors (502 if headers unsent, else `res.destroy()`) and client aborts (`proxyRes.destroy()`). Only when a rewrite rule is present does it fall through to `RawBodyMiddleware`, which collects the proxyRes body into `proxyRes.rawBody` (rewriting needs the whole body) before proceeding
- `ProxyResMiddleware` (the buffered path) sets `content-length` from the reconstructed body; both it and `StreamMiddleware` forward response headers via `src/utils/headers.ts#forwardResponseHeaders`, which filters every header through `isHopByHopHeader` — dropping RFC 2616 §13.5.1 hop-by-hop headers (incl. `transfer-encoding`) plus any header named in the target's `Connection` value. Use `forwardResponseHeaders` (or `isHopByHopHeader`) for any other header-copying loop rather than re-deriving the hop-by-hop list
- `req.startTime` is set in `HttpServer` on arrival; `src/utils/access-log.ts#formatAccessLog(label, statusCode, req)` builds the one-line access-log entry (label padded via `padEnd()`, elapsed ms from `src/utils/request-timing.ts#elapsedMs(req)`) — `StaticMiddleware`, `MockMiddleware`, `RewriteMiddleware`, `StreamMiddleware`, and `ProxyResMiddleware` all use it so log lines line up regardless of which middleware handled the request. Each request gets exactly one log line — streamed pass-through is logged by `StreamMiddleware` (label `stream`, on `res`'s `'finish'`), `RewriteMiddleware` sets `req.rewriteLogged = true` on every exit path (including its catch block) right before logging, and `ProxyResMiddleware` only logs its (now rare, buffered-fallback) pass-through when `!req.rewriteLogged`. Use this flag rather than `req.rewriteRule` truthiness — the rule can be set without a log line ever being emitted on an exception path
- `MockRulesMatcher`/`RewriteRulesMatcher` extend the shared `MethodPathRulesMatcher<T>` base (`src/services/rules-matchers/method-path-rules-matcher.ts`), which only requires `getRules()`. Use `matchWithParams(url, method)` to get the matched rule and its decoded path params in a single pass — `match()` + `params()` back to back would compile/run `path-to-regexp` twice for the same lookup
- Anything that calls into `path-to-regexp`'s `match()` with a user-supplied path pattern (config rules) must be wrapped in try/catch — malformed patterns throw synchronously (e.g. `match('/api/:[bad')` throws `Missing parameter name`)
- Pipeline execution and `httpProxy.web()` calls return promises that must be awaited or `.catch()`-handled — an uncaught rejection here crashes the process. `HttpServer`, `ProxyMiddleware`, and `yxorp-server.service.ts`'s `upgrade` handler all guard against this and respond with a `502` if headers haven't been sent yet
