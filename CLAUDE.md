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
- `req.startTime` is set in `HttpServer` on arrival; `src/utils/request-timing.ts#elapsedMs(req)` computes elapsed ms for log lines. Each request gets exactly one log line — `ProxyResMiddleware` logs plain pass-through (`if (!req.rewriteRule)`) since `RewriteMiddleware` already logs rewritten responses
