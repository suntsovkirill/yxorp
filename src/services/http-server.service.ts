import http, { IncomingMessage, Server, ServerResponse } from 'http';
import https from 'https';
import { Pipeline } from './pipeline.service';
import { LoggerService } from './logger.service';
import { describeError, sendErrorResponse } from '../utils/error-response';

export class HttpServer {
  public readonly use: Pipeline<[IncomingMessage, ServerResponse]>['use'];
  public readonly on: Server['on'];
  public readonly once: Server['once'];
  public readonly addListener: Server['addListener'];
  public readonly removeListener: Server['removeListener'];
  public readonly listen: Server['listen'];
  public readonly close: Server['close'];
  public readonly address: Server['address'];
  private readonly server: Server;

  constructor(
    private pipeline: Pipeline<[req: IncomingMessage, res: ServerResponse]>,
    private logger: LoggerService,
    // When given, the server speaks HTTPS (and WSS) with this key/certificate.
    tls?: { key: Buffer; cert: Buffer },
  ) {
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      req.startTime = Date.now();

      // pipeline.execute() is async — an uncaught rejection here (e.g. a
      // synchronous throw deep in a middleware) would otherwise become an
      // unhandled promise rejection and can crash the whole process.
      this.pipeline.execute(req, res).catch((e) => {
        this.logger.error(e);
        sendErrorResponse(res, 502, `request failed: ${describeError(e)}`);
      });
    };

    this.server = tls ? https.createServer(tls, handler) : http.createServer(handler);

    this.use = this.pipeline.use.bind(this.pipeline);
    this.on = this.server.on.bind(this.server);
    this.once = this.server.once.bind(this.server);
    this.addListener = this.server.addListener.bind(this.server);
    this.removeListener = this.server.removeListener.bind(this.server);
    this.listen = this.server.listen.bind(this.server);
    this.close = this.server.close.bind(this.server);
    this.address = this.server.address.bind(this.server);
  }
}
