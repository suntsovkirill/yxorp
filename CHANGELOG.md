# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is `0.x`, minor releases may include breaking changes to the
config schema, CLI flags, or mock/rewrite script API.

## [Unreleased]

### Fixed
- Mock, rewrite, and remote rules now match the URL path only, so a request
  with a query string (`/api/users?page=2`) no longer misses its rule, and the
  query string no longer leaks into path params.
- Remote rules whose `target` has a path (`http://host/v2/:id`) now send the
  request to that path with the request's query string appended. Previously the
  original request path was appended after it (`/v2/5/legacy/5`) and the query
  string was captured inside the params.
- `staticRules[].disable` is honored — disabled static rules used to keep
  serving files.
- Static rule `path` prefixes match on whole path segments: `/assets` no longer
  captures `/assets-old/...` or `/assetsfile.js`.
- `--port`/`--target` CLI overrides are re-applied on config hot-reload instead
  of being silently replaced by the file's values after the first save.
- An error thrown by a later middleware (e.g. while starting the proxy request)
  no longer escapes as an unhandled promise rejection — which crashes Node by
  default — leaving the client hanging; the request now gets a 502. The
  pipeline awaits `next()`'s promise even when a middleware doesn't return it.
- WebSocket upgrades: a target that throws synchronously (e.g. not a valid URL)
  no longer crashes the process; on an upstream error the client socket is
  destroyed instead of being left half-open; errors are logged as errors
  (were logged as info).
- Rewrite scripts: a string return value is sent as UTF-8 with a correct
  byte-based `content-length` (non-ASCII text used to get a too-short length);
  objects are JSON-serialized; returning nothing keeps the original body (with
  a warning) instead of sending an empty body; a script that doesn't export a
  function is reported as an error instead of being silently skipped.
- `bin/yxorp.js` only reports "Yxorp is not built" when `dist/index.js` is
  actually missing — a missing dependency inside the app used to be reported
  the same way.

### Added
- `--help` / `-h` CLI flag.
- `changeOrigin` and `secure` config options (defaults unchanged: `true` and
  `false`).
- Error responses from Yxorp (unreachable target, failed upstream response)
  carry a plain-text body explaining the failure, e.g.
  `yxorp: cannot reach http://localhost:8080: ECONNREFUSED`, instead of an
  empty 502.
- WebSocket connections get an access-log line (`ws` label) when they close.
- Warnings for unknown config keys (typos like `mockRule` or `statuscode`) at
  startup and on reload.

### Changed
- Changing `proxyPort` in the config file at runtime now logs a warning that a
  restart is needed (the server keeps listening on the original port) instead
  of being ignored silently.
- Stricter config validation: `target` must be an absolute `http(s)` URL,
  `remoteRules[].target` an absolute `http`/`https`/`ws`/`wss` URL (path-only
  targets never worked — every request to them failed), `method` a known HTTP
  method, `statusCode` an integer in 100–599, `proxyHeaders` values strings,
  and boolean flags booleans. Static rule `path`s are no longer validated as
  path-to-regexp patterns, since they're plain prefixes.
- Compiled path-to-regexp matchers are cached per pattern instead of being
  recompiled for every rule on every request.

### Documentation
- Fixed the remote-rule examples in the README: a pattern without a wildcard
  (`/api/v1`) matches only that exact path — use `/api/v1{/*rest}` for a prefix.

## [0.3.0] - 2026-06-12

### Added
- Stream pass-through responses to the client as they arrive instead of
  buffering the whole body first. `text/event-stream` (SSE) and long chunked
  responses now reach the client incrementally and aren't held in memory; only
  responses with an active rewrite rule are buffered (rewriting needs the full
  body). Streamed responses are tagged `stream` in the access log, distinct from
  `proxy` for buffered pass-through.
- GitHub Actions CI running typecheck, build, and tests on Node 20, 22, and 24,
  with a Windows smoke test.
- `typecheck` npm script (`tsc --noEmit`).
- `repository`, `bugs`, `homepage`, and `keywords` in `package.json` so the npm
  page links back to GitHub and the package is easier to find.

### Changed
- **Require Node >= 20** (was >= 18). Node 18 reached end-of-life in April 2025
  and the test tooling no longer runs on it.
- Proxied pass-through responses are no longer given a synthetic `content-length`
  reconstructed from a fully-buffered body. When the upstream doesn't send a
  length, the response is forwarded with chunked transfer-encoding.

## [0.2.4] - 2026-06-10

### Fixed
- Filter RFC 2616 hop-by-hop headers — and any header named in the upstream
  `Connection` value — out of proxied responses instead of forwarding them.
- Prevent a static rule from serving files outside its configured directory
  through a symlink.
- `Config.get()` now throws if called before `set()` instead of returning
  `undefined` and failing obscurely downstream.
- The config watcher survives atomic-rename saves (editors that write a temp
  file and rename it over the original).
- Clients no longer hang when the proxy target is unreachable — they receive a
  502 instead.

### Changed
- Align access-log labels with `padEnd()` so lines line up regardless of which
  middleware handled the request.
- Internal typing improvements across the middleware and matchers; removed the
  unused `tslib` dependency.

### Documentation
- Documented the `require()`-based mock/rewrite script execution security model
  in the README.

## [0.2.3] - 2026-06-07

### Fixed
- Guard every `path-to-regexp` `match()` call against malformed config patterns,
  which throw synchronously.
- Fix a hang in mock handling when a script's export is not a function.
- Always emit exactly one access-log line, including when a rewrite throws.
- Await and catch pipeline execution and proxy calls so an upstream error can no
  longer crash the process with an unhandled rejection.
- Fix a double `next()` / double-reject when an upstream response stream errors.

### Changed
- Extend config validation: proxy port range and per-rule entry shapes are
  checked before the server starts.
- Deduplicate the mock and rewrite rule matchers into a shared base matcher.
- Stop walking the whole directory tree on every static-file request.
- Give graceful shutdown a force-exit timeout so a stuck connection can't block
  exit indefinitely.

## [0.2.2] - 2026-06-07

### Added
- CLI overrides: `--port` and `--target`.
- Config validation at startup.
- Request timing in access-log lines.

### Removed
- The `scripts` section from config; mock and rewrite scripts are referenced
  per-rule instead.

## [0.2.1] - 2026-06-06

### Added
- Config hot-reload via `fs.watch` — changes apply without restarting the
  server.

## [0.2.0] - 2026-05-30

### Changed
- Major architecture overhaul: dropped the `typedi` DI container for manual
  composition, switched the proxy core from `http-proxy` to `httpxy`, and moved
  to `require()`-based mock/rewrite scripts backed by an integration test suite.

## [0.1.5] - 2023-11-15

- Maintenance release.

## [0.1.4] - 2023-11-15

### Fixed
- Packaging fixes in `package.json`.

## [0.1.3] - 2023-11-02

### Fixed
- Configuration file name handling.

## [0.1.2] - 2023-11-02

### Fixed
- Running the CLI from a terminal.

## [0.1.1] - 2023-11-02

### Changed
- Moved `ts-node` to runtime dependencies.

## [0.1.0] - 2023-10-25

- Initial public release.
