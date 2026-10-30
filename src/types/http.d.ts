declare module 'http' {
  export interface IncomingMessage {
    rawBody?: Buffer;
    rewriteRule?: import("./yxorp-config").RewriteRule;
    rewriteRuleParams?: Record<string, string>;
    rewriteLogged?: boolean;
    mockRule?: import("./yxorp-config").MockRule;
    mockRuleParams?: Record<string, string>;
    requestRule?: import("./yxorp-config").RequestRule;
    // The request body parsed as JSON, when it was read for `match.body`.
    parsedBody?: unknown;
    // Replacement body for the proxied request (request rules), or the
    // already-read original — piped to the target instead of `req`.
    proxyBody?: Buffer;
    // `req.url` as the client sent it, before request rules changed the query.
    originalUrl?: string;
    query?: Record<string, any>;
    startTime?: number;
    wsStatusCode?: number;
    // Access-log label of the middleware that answered the request (`stream`, `mock`, ...).
    handledBy?: string;
    // Request body, once read (by the mock-script body readers or traffic capture).
    requestBody?: Buffer;
    // Fetch-style body readers available to mock scripts.
    buffer?: () => Promise<Buffer>;
    text?: () => Promise<string>;
    json?: () => Promise<any>;
  }
}
