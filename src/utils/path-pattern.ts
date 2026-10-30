import { compile, match, MatchFunction, PathFunction } from 'path-to-regexp';

type Params = Record<string, string>;

// Compiled path-to-regexp functions, keyed by pattern. Rule patterns come from
// the config, so the set is small; without the cache every request recompiled
// the pattern of every rule it was checked against. A malformed pattern throws
// before anything is cached, so it keeps throwing on every call.
const matchers = new Map<string, MatchFunction<Params>>();
const compilers = new Map<string, PathFunction<Params>>();

/**
 * Matches a URL pathname against a rule pattern, returning the decoded params.
 * Throws synchronously on a malformed pattern — callers must catch.
 */
export function matchPath(pattern: string, pathname: string): { params: Params } | undefined {
  let matcher = matchers.get(pattern);

  if (!matcher) {
    matcher = match<Params>(pattern, { decode: decodeURIComponent });
    matchers.set(pattern, matcher);
  }

  return matcher(pathname) || undefined;
}

/**
 * Builds a path from a pattern and params (the reverse of `matchPath`).
 * Throws synchronously on a malformed pattern or missing params.
 */
export function compilePath(pattern: string, params: Params): string {
  let compiler = compilers.get(pattern);

  if (!compiler) {
    compiler = compile<Params>(pattern);
    compilers.set(pattern, compiler);
  }

  return compiler(params);
}
