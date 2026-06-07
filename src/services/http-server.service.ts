import http, { IncomingMessage, Server, ServerResponse } from 'http';
import { Pipeline } from './pipeline.service';
import { LoggerService } from './logger.service';

export class HttpServer {
  public readonly use: Pipeline<[IncomingMessage, ServerResponse]>['use'];
  public readonly on: Server['on'];
  public readonly addListener: Server['addListener'];
  public readonly removeListener: Server['removeListener'];
  public readonly listen: Server['listen'];
  public readonly close: Server['close'];
  public readonly address: Server['address'];
  private readonly server: Server;

  constructor(
    private pipeline: Pipeline<[req: IncomingMessage, res: ServerResponse]>,
    private logger: LoggerService,
  ) {
    this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      req.startTime = Date.now();

      // pipeline.execute() is async — an uncaught rejection here (e.g. a
      // synchronous throw deep in a middleware) would otherwise become an
      // unhandled promise rejection and can crash the whole process.
      this.pipeline.execute(req, res).catch((e) => {
        this.logger.error(e);

        if (!res.headersSent) {
          res.statusCode = 502;
          res.end();
        }
      });
    });

    this.use = this.pipeline.use.bind(this.pipeline);
    this.on = this.server.on.bind(this.server);
    this.addListener = this.server.addListener.bind(this.server);
    this.removeListener = this.server.removeListener.bind(this.server);
    this.listen = this.server.listen.bind(this.server);
    this.close = this.server.close.bind(this.server);
    this.address = this.server.address.bind(this.server);
  }
}
