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
- `src/index.ts` — entry point, config resolution, manual service wiring
- `src/services/yxorp-server.service.ts` — `createServer()` wires both pipelines
- `src/services/pipeline.service.ts` — generic `Pipeline<T>` with `use()`/`execute()`
- `src/services/config-resolver.ts` — config file lookup logic
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
