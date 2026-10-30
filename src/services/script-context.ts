import { IncomingMessage } from 'http';

/**
 * Third argument of mock scripts (`(req, res, ctx)`) and fifth of rewrite
 * scripts (`(body, proxyRes, req, res, ctx)`).
 */
export interface ScriptContext {
  // In-memory store shared by all scripts of this server; survives script
  // reloads, cleared on restart (or from the web UI). Lets mocks keep state —
  // e.g. a POST adds an item that the next GET lists.
  store: Map<string, any>;
  // Path params of the matched rule.
  params: Record<string, string>;
  // Parsed query string.
  query: Record<string, any>;
}

export function createScriptContext(store: Map<string, any>, req: IncomingMessage, params: Record<string, string> | undefined): ScriptContext {
  return { store, params: params ?? {}, query: req.query ?? {} };
}
