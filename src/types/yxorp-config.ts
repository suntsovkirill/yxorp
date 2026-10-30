export interface YxorpConfig extends ConfigFile {
  proxyOptions: Record<string, any>;
  // Base directory for every relative path in the config (rule files,
  // scripts, static directories, TLS files) — the config file's directory.
  configDir: string;
}

export interface ConfigFile {
  target: string;
  proxyPort: string | number;
  // Interface to listen on (default 127.0.0.1 — only this machine). Use
  // "0.0.0.0" to accept connections from other devices.
  host?: string;
  proxyHeaders?: Record<string, string>;
  // Verify the target's TLS certificate (default false — local dev targets
  // often use self-signed certificates).
  secure?: boolean;
  // Rewrite the Host header to the target's host (default true).
  changeOrigin?: boolean;
  // Answer CORS preflights and add CORS headers to every response.
  cors?: boolean | CorsOptions;
  // Serve the proxy over HTTPS with this key/certificate (PEM file paths).
  https?: HttpsOptions;
  remoteRules?: RemoteRule[];
  staticRules?: StaticRule[];
  mockRules?: MockRule[];
  rewriteRules?: RewriteRule[];
  // Change requests on their way to the target.
  requestRules?: RequestRule[];
  // More config files (rule lists only) merged after this one's rules.
  include?: string[];
  // Inject failures and latency into every (or every matching) request.
  chaos?: ChaosOptions;
  // Named sets of rules (and chaos) that can be switched on as a whole.
  profiles?: Record<string, Profile>;
  // The active profile — its rules go before the base rules.
  profile?: string;
}

export interface ChaosOptions {
  // Extra latency in ms: fixed, or random between min and max.
  delay?: number | { min: number; max: number };
  // Share of requests (0–1) answered with `errorStatus` instead.
  errorRate?: number;
  // Status for injected errors (default 503).
  errorStatus?: number;
  // Share of requests (0–1) whose connection is dropped without a response.
  dropRate?: number;
  // Only affect requests whose path matches one of these patterns (default: all).
  paths?: string[];
}

export interface Profile {
  remoteRules?: RemoteRule[];
  staticRules?: StaticRule[];
  mockRules?: MockRule[];
  rewriteRules?: RewriteRule[];
  requestRules?: RequestRule[];
  chaos?: ChaosOptions;
}

export interface CorsOptions {
  // Allowed origin(s); "*" or omitted allows any origin (echoed back, so it
  // also works with credentials).
  origin?: string | string[];
  // Send Access-Control-Allow-Credentials: true (default true).
  credentials?: boolean;
  // Preflight cache lifetime in seconds (default 600).
  maxAge?: number;
  // Response headers the page's JavaScript may read.
  exposeHeaders?: string[];
}

export interface HttpsOptions {
  key: string;
  cert: string;
}

export interface RemoteRule {
  path: string;
  target: string;
  ws?: boolean;
  disable?: boolean;
}

export type StaticRule = {
  path: string;
  directory: string;
  caseInsensitive?: boolean;
  directoryIndex?: string;
  disable?: boolean;
}

/**
 * Extra conditions a mock/rewrite rule needs besides method + path. Every
 * listed query param / request header must be present with exactly this value
 * (header names are case-insensitive).
 */
export interface RuleMatch {
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

interface ResponseRuleBase {
  method: string;
  path: string;
  match?: RuleMatch;
  statusCode?: number;
  // Response headers to set (mock) or override on the upstream response (rewrite).
  headers?: Record<string, string>;
  // Milliseconds to wait before responding — simulates a slow backend.
  delay?: number;
  disable?: boolean;
}

// Where the response body comes from — exactly one of these per rule.
export type FileSource = { file: string };
export type ScriptSource = { script: string };
export type JsonSource = { json: unknown };
export type BodySource = { body: string };

export type MockFileRule = ResponseRuleBase & FileSource;
export type MockScriptRule = ResponseRuleBase & ScriptSource;
export type MockJsonRule = ResponseRuleBase & JsonSource;
export type MockBodyRule = ResponseRuleBase & BodySource;

export type MockRule = MockFileRule | MockScriptRule | MockJsonRule | MockBodyRule;

export type RewriteFileRule = ResponseRuleBase & FileSource;
export type RewriteScriptRule = ResponseRuleBase & ScriptSource;
export type RewriteJsonRule = ResponseRuleBase & JsonSource;
export type RewriteBodyRule = ResponseRuleBase & BodySource;

export type RewriteRule = RewriteFileRule | RewriteScriptRule | RewriteJsonRule | RewriteBodyRule;

/**
 * Changes a matching request before it's proxied to the target. Headers and
 * query params are set, or removed with `null`; `json`/`body` replace the
 * request body.
 */
export interface RequestRule {
  method: string;
  path: string;
  match?: RuleMatch;
  headers?: Record<string, string | null>;
  query?: Record<string, string | null>;
  json?: unknown;
  body?: string;
  disable?: boolean;
}
