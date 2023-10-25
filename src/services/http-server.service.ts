import { Service } from 'typedi';
import http, { IncomingMessage, Server, ServerResponse} from 'http';
import { Pipeline } from './pipeline.service';

@Service({
  global: true
})
export class HttpServer {
  private server: Server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    this.pipeline.execute(req, res);
  });

  constructor(
    private pipeline: Pipeline<[req: IncomingMessage, res: ServerResponse]>,
  ) {
  }

  public use = this.pipeline.use.bind(this.pipeline);
  public on = this.server.on.bind(this.server);
  public addListener = this.server.addListener.bind(this.server);
  public removeListener = this.server.removeListener.bind(this.server);
  public listen = this.server.listen.bind(this.server);

}
