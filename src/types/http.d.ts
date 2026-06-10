declare module 'http' {
  export interface IncomingMessage {
    rawBody?: Buffer;
    rewriteRule?: import("./yxorp-config").RewriteRule;
    rewriteRuleParams?: Record<string, string>;
    rewriteLogged?: boolean;
    mockRule?: import("./yxorp-config").MockRule;
    mockRuleParams?: Record<string, string>;
    query?: Record<string, any>;
    startTime?: number;
  }
}
