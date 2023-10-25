import { Service } from 'typedi';
import { IncomingMessage, ServerResponse} from 'http';
import httpProxy from 'http-proxy';
import { Pipeline } from "./pipeline.service";

@Service({
  global: true
})
export class HttpProxy {
  private httpProxy = httpProxy.createProxyServer({});

  constructor(
    private pipeline: Pipeline<[proxyRes: IncomingMessage, req: IncomingMessage, res: ServerResponse]>,
  ) {
  }

  public use = this.pipeline.use.bind(this.pipeline);
  public execute = this.pipeline.execute.bind(this.pipeline);
  public on = this.httpProxy.on.bind(this.httpProxy);
  public addListener = this.httpProxy.addListener.bind(this.httpProxy);
  public removeListener = this.httpProxy.removeListener.bind(this.httpProxy);
  public web = this.httpProxy.web.bind(this.httpProxy);
  public ws = this.httpProxy.ws.bind(this.httpProxy);

}
