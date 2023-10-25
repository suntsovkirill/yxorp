declare module 'http' {
  export interface IncomingMessage {
    rawBody?: Buffer;
    rewriteRule?: import("./yxorp-config").RewriteRule;
    rewriteRuleParams?: Object;
    mockRule?: import("./yxorp-config").MockRule;
    mockRuleParams?: Object;
    query?: Record<string, any>;
  }
}
