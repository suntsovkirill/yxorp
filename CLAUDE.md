# Yxorp — Project Guide

## Overview
Yxorp is a local reverse proxy for rewriting, mocking, and debugging API responses. It sits between a client and a target server, supporting static file serving, request mocking, response rewriting, and remote routing.

## Architecture

### Two middleware pipelines (manual composition, no DI)

**Server Pipeline** (incoming requests → target):
```
[CaptureMiddleware] → CorsMiddleware → StaticMiddleware → BootstrapMiddleware → MockMiddleware → ProxyMiddleware
```
`CaptureMiddleware` is only added when `createServer(..., { capture: [...] })` gets listeners (`--har`/`--record`). It observes without changing anything: it wraps `req.emit` to see request `'data'` chunks as whoever reads the stream consumes them (never reading it itself — that would steal data from httpxy's pipe or a mock script), wraps `res.write`/`end`/`writeHead`, and emits a `CapturedExchange` on `'finish'` via `setImmediate` (so later `'finish'` handlers such as `StreamMiddleware`'s log/`handledBy` run first). `CorsMiddleware` answers preflights itself and sets CORS headers on `res` up front; `forwardResponseHeaders` then skips the target's `access-control-*` headers and merges `Vary`.

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
- `src/services/config-validator.ts` — `validateConfig(config)` returns blocking errors (target/remote targets must be absolute URLs, port range, known HTTP methods, statusCode 100–599, boolean flags, per-rule entry shapes); `findConfigWarnings(config)` returns non-blocking warnings for unknown keys — keep `KNOWN_TOP_LEVEL_KEYS`/`KNOWN_RULE_KEYS` in sync when adding a config field
- `src/services/cli-overrides.ts` — `applyCliOverrides(config, argv)` layers `--port`/`--target`/`--port=value` CLI flags on top of the resolved config without touching the file
- `src/services/proxy-config.ts` — `buildProxyConfig(configFile)` derives the runtime config (incl. httpxy `proxyOptions`); used by `index.ts` and the test helper so tests run the real wiring
- `src/services/config-reload.ts` — `createConfigReloadHandler(appConfig, logger, argv)` builds the `onReload` callback: re-applies CLI overrides, validates, warns about unknown keys, keeps the running `proxyPort` and `https` (warns if the file changed them)
- `src/services/logger.service.ts` — small built-in logger (no winston): `info`/`debug` → stdout, `warn`/`error` → stderr, level from `--quiet`/`--verbose` (`logLevelFromArgv`); methods are instance properties so tests can replace them (`tests/helpers/create-yxorp.ts#createRecordingLogger`)
- `src/services/script-loader.ts` — `loadScript(path)` for mock/rewrite scripts (see Script system)
- `src/services/har-writer.ts` / `src/services/recorder.ts` — capture listeners behind `--har` / `--record`
- `src/services/init-config.ts` — `yxorp init`
- `schema.json` — JSON Schema for the config (shipped in the package). `tests/schema.test.ts` checks it knows exactly the validator's keys and accepts/rejects the same configs — update both when adding a config field

### Dependency injection
No DI container. Everything is manually composed in `index.ts`:
```typescript
const logger = new LoggerService();
const appConfig = new Config();
appConfig.set(proxyConfig);
const { listen } = createServer(appConfig, logger, rewriteMatcher, mockMatcher, remoteMatcher, { capture });
```

### HTTP proxying
Uses `httpxy` (not `http-proxy`). Key differences:
- `web()` returns `Promise<void>` (not callback-based)
- `ws()` is `ws(req, socket, options, head)` (different arg order)
- `selfHandleResponse: true` is required — proxy pipeline handles the response

### Script system
Mock/rewrite scripts are loaded fresh per request by `loadScript()` (`src/services/script-loader.ts`):
- CommonJS: evicts the script and, recursively, the local (non-`node_modules`) modules it required from `require.cache`, then `require()`s it
- `.mjs`/`.mts`/`.ts`/`.cts` (and `.js` hitting `ERR_REQUIRE_ESM`): `import()` of the file URL with `?mtime=` for cache-busting — so the compiled CommonJS output must keep `import()` native (it does under `module: nodenext`). Vite rewrites `import()` in code it transforms, so tests for this path run the transpiled loader in a plain Node child process (`tests/script-loader.test.ts`)
```javascript
module.exports = (req, res) => { ... };              // or: export default
module.exports = (body, proxyRes, req, res) => { ... };
```
Mock scripts also get `await req.json()/text()/buffer()` (`src/utils/request-body.ts`, read lazily on first call).

## Config resolution
Order: `--config <path>` → `./yxorp.json` → `./.yxorp/settings.json`

## Config hot-reload
`watchConfig` in `src/services/config-watcher.ts` watches the config file's *parent directory* via `fs.watch` (filtering events by filename) with a 100ms debounce — watching the file directly misses atomic-rename saves (editors that write a temp file then rename it over the original swap the inode, after which a direct file watch stops firing). On change it re-reads and parses the file, then calls `onReload(newConfig)` (built by `createConfigReloadHandler`, which runs the same CLI-override → validate steps as startup). Since all matchers and middlewares call `config.get()` per request, calling `appConfig.set()` in `onReload` takes effect immediately with no server restart.

The hot-reload test (`tests/config-watcher.test.ts`) uses soft assertions (`softExpect`) — failures print a `console.warn` but don't fail the build, because `fs.watch` can be unreliable on some platforms.

## Testing
- Framework: vitest
- Tests create real target servers and yxorp instances on random ports
- Test helpers: `tests/helpers/create-yxorp.ts`, `tests/helpers/target-server.ts`
- Fixtures in `tests/fixtures/`
- Run: `npm test`; `npm run test:coverage` (thresholds in `vitest.config.ts`, run in CI); `npm run lint` (ESLint flat config, `eslint.config.mjs`)
- `src/index.ts` only runs in child processes (`tests/cli.test.ts`, via `tsx`), so it doesn't count toward coverage

## Node engine
Requires Node `^20.19.0 || >=22.12.0`: `httpxy` is ESM-only and the CommonJS build loads it with `require()`, which needs unflagged `require(esm)`.

## Windows notes
- `localAddress: '0.0.0.0'` causes `EINVAL` on Windows — don't use it
- All paths use forward slashes

## Key patterns
- Middleware implement `Middleware<T>` with `use(...args, next)`
- Pipeline awaits middleware return value — async middleware must return Promise. It also awaits the promise returned by `next()` itself (even when the middleware doesn't return it), so a downstream throw always reaches `HttpServer`'s `.catch()` instead of becoming an unhandled rejection
- `StreamMiddleware` runs first in the proxy pipeline: when there's no `req.rewriteRule` it pipes `proxyRes` straight to the client and does **not** call `next()`, so SSE/chunked responses stream through and aren't held in memory. It returns a promise that resolves on `res`'s `'finish'`, and handles mid-stream upstream errors (502 if headers unsent, else `res.destroy()`) and client aborts (`proxyRes.destroy()`). Only when a rewrite rule is present does it fall through to `RawBodyMiddleware`, which collects the proxyRes body into `proxyRes.rawBody` (rewriting needs the whole body) before proceeding
- `ProxyResMiddleware` (the buffered path) sets `content-length` from the reconstructed body; both it and `StreamMiddleware` forward response headers via `src/utils/headers.ts#forwardResponseHeaders`, which filters every header through `isHopByHopHeader` — dropping RFC 2616 §13.5.1 hop-by-hop headers (incl. `transfer-encoding`) plus any header named in the target's `Connection` value. Use `forwardResponseHeaders` (or `isHopByHopHeader`) for any other header-copying loop rather than re-deriving the hop-by-hop list
- Log access lines with `src/utils/access-log.ts#logAccess(logger, label, statusCode, req)` — it also records the label in `req.handledBy`, which traffic capture uses to tell target responses (`proxy`/`stream`) from local ones
- `req.startTime` is set in `HttpServer` on arrival; `src/utils/access-log.ts#formatAccessLog(label, statusCode, req)` builds the one-line access-log entry (label padded via `padEnd()`, elapsed ms from `src/utils/request-timing.ts#elapsedMs(req)`) — `StaticMiddleware`, `MockMiddleware`, `RewriteMiddleware`, `StreamMiddleware`, and `ProxyResMiddleware` all use it so log lines line up regardless of which middleware handled the request. Each request gets exactly one log line — streamed pass-through is logged by `StreamMiddleware` (label `stream`, on `res`'s `'finish'`), `RewriteMiddleware` sets `req.rewriteLogged = true` on every exit path (including its catch block) right before logging, and `ProxyResMiddleware` only logs its (now rare, buffered-fallback) pass-through when `!req.rewriteLogged`. Use this flag rather than `req.rewriteRule` truthiness — the rule can be set without a log line ever being emitted on an exception path
- `MockRulesMatcher`/`RewriteRulesMatcher` extend the shared `MethodPathRulesMatcher<T>` base (`src/services/rules-matchers/method-path-rules-matcher.ts`), which only requires `getRules()`. Use `matchWithParams(url, method)` to get the matched rule and its decoded path params in a single pass — `match()` + `params()` back to back would compile/run `path-to-regexp` twice for the same lookup
- Rule patterns are matched against the URL **pathname only** — split `req.url` with `src/utils/url.ts#splitUrl` first; matching the raw `req.url` makes every request with a query string miss its rule
- `RemoteRulesMatcher.resolve(url, ws)` returns the httpxy `{ target, ignorePath }` for a matched remote rule (used by `ProxyMiddleware` and the `upgrade` handler). Per-call `prependPath` has no effect — httpxy merges `{...opts, ...server.options}` and the server always carries `prependPath: true` — so a target with its own path must use `ignorePath: true` and carry the request's query string itself
- Use `src/utils/path-pattern.ts#matchPath`/`compilePath` rather than calling `path-to-regexp` directly — they cache the compiled function per pattern (config patterns are few; recompiling per request per rule was wasted work)
- Anything that calls into `path-to-regexp`'s `match()` with a user-supplied path pattern (config rules) must be wrapped in try/catch — malformed patterns throw synchronously (e.g. `match('/api/:[bad')` throws `Missing parameter name`)
- Pipeline execution and `httpProxy.web()` calls return promises that must be awaited or `.catch()`-handled — an uncaught rejection here crashes the process. `HttpServer`, `ProxyMiddleware`, and `yxorp-server.service.ts`'s `upgrade` handler all guard against this and respond with a `502` if headers haven't been sent yet — via `src/utils/error-response.ts#sendErrorResponse(res, status, message)`, which sends a plain-text `yxorp: <message>` body (use it, with `describeError(e)`, for any new error response). httpxy's `web()`/`ws()` can also throw *synchronously* (`new URL(target)`), so the `upgrade` handler wraps `proxy.ws()` in try/catch as well — a throw inside that event listener would crash the process. On a ws error it `socket.destroy()`s the client socket (httpxy only `end()`s it, which can leave it half-open) and logs one `ws` access-log line when the connection ends (status from `req.wsStatusCode`, set via the proxy's `proxyReqWs` event)
