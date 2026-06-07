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
RawBodyMiddleware → RewriteMiddleware → ProxyResMiddleware
```

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
`watchConfig` in `src/services/config-watcher.ts` watches the resolved config file via `fs.watch` with a 100ms debounce. On change it re-reads and parses the file, then calls `onReload(newConfig)`. Since all matchers and middlewares call `config.get()` per request, calling `appConfig.set()` in `onReload` takes effect immediately with no server restart.

The hot-reload test (`tests/config-watcher.test.ts`) uses soft assertions (`softExpect`) — failures print a `console.warn` but don't fail the build, because `fs.watch` can be unreliable on some platforms.

## Testing
- Framework: vitest
- Tests create real target servers and yxorp instances on random ports
- Test helpers: `tests/helpers/create-yxorp.ts`, `tests/helpers/target-server.ts`
- Fixtures in `tests/fixtures/`
- Run: `npm test`

## Node engine
Requires Node >= 18.

## Windows notes
- `localAddress: '0.0.0.0'` causes `EINVAL` on Windows — don't use it
- All paths use forward slashes

## Key patterns
- Middleware implement `Middleware<T>` with `use(...args, next)`
- Pipeline awaits middleware return value — async middleware must return Promise
- `RawBodyMiddleware` collects proxyRes body into `proxyRes.rawBody` before proceeding
- `ProxyResMiddleware` strips `transfer-encoding` when setting `content-length`
- `req.startTime` is set in `HttpServer` on arrival; `src/utils/request-timing.ts#elapsedMs(req)` computes elapsed ms for log lines. Each request gets exactly one log line — `RewriteMiddleware` sets `req.rewriteLogged = true` on every exit path (including its catch block) right before logging, and `ProxyResMiddleware` only logs plain pass-through when `!req.rewriteLogged`. Use this flag rather than `req.rewriteRule` truthiness — the rule can be set without a log line ever being emitted on an exception path
- `MockRulesMatcher`/`RewriteRulesMatcher` extend the shared `MethodPathRulesMatcher<T>` base (`src/services/rules-matchers/method-path-rules-matcher.ts`), which only requires `getRules()`. Use `matchWithParams(url, method)` to get the matched rule and its decoded path params in a single pass — `match()` + `params()` back to back would compile/run `path-to-regexp` twice for the same lookup
- Anything that calls into `path-to-regexp`'s `match()` with a user-supplied path pattern (config rules) must be wrapped in try/catch — malformed patterns throw synchronously (e.g. `match('/api/:[bad')` throws `Missing parameter name`)
- Pipeline execution and `httpProxy.web()` calls return promises that must be awaited or `.catch()`-handled — an uncaught rejection here crashes the process. `HttpServer`, `ProxyMiddleware`, and `yxorp-server.service.ts`'s `upgrade` handler all guard against this and respond with a `502` if headers haven't been sent yet
