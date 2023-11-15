import { IncomingMessage, ServerResponse } from 'http';
import { createProxyServer } from 'httpxy';
import { Pipeline } from './pipeline.service';

export class HttpProxy {
  public readonly on: (...args: any[]) => any;
  private proxy: any;

  constructor(
    private pipeline: Pipeline<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]>,
  ) {
    this.proxy = createProxyServer({});
    this.on = this.proxy.on.bind(this.proxy);
  }

  public execute = (...args: Parameters<Pipeline<[IncomingMessage, IncomingMessage, ServerResponse]>['execute']>) =>
    this.pipeline.execute(...args);

  public web(req: IncomingMessage, res: ServerResponse, options?: Record<string, any>) {
    return this.proxy.web(req, res, options);
  }

  public ws(req: IncomingMessage, socket: any, options: Record<string, any>, head?: Buffer) {
    return this.proxy.ws(req, socket, options, head);
  }
}
