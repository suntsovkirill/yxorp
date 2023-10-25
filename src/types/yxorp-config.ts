import { ServerOptions } from 'http-proxy';

export interface YxorpConfig extends ConfigFile {
  proxyOptions: ServerOptions;
}

export interface ConfigFile {
  target: string;
  proxyPort: string | number;
  scripts?: string[];
  remoteRules?: RemoteRule[];
  staticRules?: StaticRule[];
  mockRules?: MockRule[];
  rewriteRules?: RewriteRule[];
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

export type MockFileRule = {
  method: string;
  path: string;
  file: string;
  statusCode?: number;
  disable?: boolean;
}

export type MockScriptRule = {
  method: string;
  path: string;
  script: string;
  disable?: boolean;
}

export type MockRule = MockFileRule | MockScriptRule;


export type RewriteFileRule = {
  method: string;
  path: string;
  file: string;
  statusCode?: number;
  disable?: boolean;
}

export type RewriteScriptRule = {
  method: string;
  path: string;
  script: string;
  disable?: boolean;
}

export type RewriteRule = RewriteFileRule | RewriteScriptRule;


