import { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'http';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';

// Bodies beyond this are cut off (and marked truncated) — a long-lived stream
// (SSE) would otherwise grow without bound.
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface CapturedBody {
  data: Buffer;
  truncated: boolean;
}

/** One request/response pair as the client saw it. */
export interface CapturedExchange {
  startedAt: Date;
  durationMs: number;
  secure: boolean;
  // Access-log label of the middleware that answered (`proxy`, `stream`,
  // `rewrite`, `mock`, `static`, `cors`), if any.
  handledBy?: string;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: IncomingHttpHeaders;
    // Only what was actually read from the request — by the proxy, a mock
    // script, or the body readers. Empty if nothing consumed it.
    body: CapturedBody;
  };
  response: {
    statusCode: number;
    statusMessage: string;
    headers: OutgoingHttpHeaders;
    // As sent to the client — still content-encoded (gzip, ...) if it was.
    body: CapturedBody;
  };
}

export type CaptureListener = (exchange: CapturedExchange) => void | Promise<void>;

/**
 * First middleware of the server pipeline when traffic capture is on (`--har`,
 * `--record`). It observes the request and response without changing them:
 * request body chunks are seen as the stream emits them to whoever reads it,
 * response chunks as they're written. Once the response has finished, the
 * exchange is handed to every listener.
 */
export class CaptureMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private listeners: CaptureListener[],
    private logger: LoggerService,
    private maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  ) {
  }

  public use(req: IncomingMessage, res: ServerResponse, next: () => void): void | Promise<void> {
    const startedAt = new Date();
    const requestBody = this.observeRequestBody(req);
    const response = this.observeResponse(res);

    res.once('finish', () => {
      // Deferred so middleware 'finish' handlers registered later (StreamMiddleware
      // logs — and sets req.handledBy — on 'finish') run first.
      setImmediate(() => this.emit({
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        secure: !!(req.socket as { encrypted?: boolean }).encrypted,
        handledBy: req.handledBy,
        request: {
          method: req.method || 'GET',
          url: req.originalUrl ?? (req.url || '/'),
          httpVersion: req.httpVersion,
          headers: req.headers,
          body: requestBody.result(),
        },
        response: {
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: { ...res.getHeaders(), ...response.writeHeadHeaders() },
          body: response.body.result(),
        },
      }));
    });

    return next();
  }

  private emit(exchange: CapturedExchange): void {
    for (const listener of this.listeners) {
      Promise.resolve()
        .then(() => listener(exchange))
        .catch((e) => this.logger.error(e));
    }
  }

  private observeRequestBody(req: IncomingMessage) {
    const collector = new BodyCollector(this.maxBodyBytes);
    const emit = req.emit;

    req.emit = function (this: IncomingMessage, event: string | symbol, ...args: any[]) {
      if (event === 'data') {
        collector.add(args[0]);
      }

      return emit.call(this, event, ...args);
    } as typeof req.emit;

    return collector;
  }

  private observeResponse(res: ServerResponse) {
    const body = new BodyCollector(this.maxBodyBytes);
    let headersFromWriteHead: OutgoingHttpHeaders = {};

    const write = res.write;
    const end = res.end;
    const writeHead = res.writeHead;

    res.write = function (this: ServerResponse, chunk: any, ...args: any[]) {
      body.add(chunk, typeof args[0] === 'string' ? args[0] as BufferEncoding : undefined);
      return (write as (...a: any[]) => boolean).call(this, chunk, ...args);
    } as typeof res.write;

    res.end = function (this: ServerResponse, chunk?: any, ...args: any[]) {
      if (chunk !== undefined && typeof chunk !== 'function') {
        body.add(chunk, typeof args[0] === 'string' ? args[0] as BufferEncoding : undefined);
      }

      return (end as (...a: any[]) => ServerResponse).call(this, chunk, ...args);
    } as typeof res.end;

    // Headers passed straight to writeHead() don't always show up in getHeaders().
    res.writeHead = function (this: ServerResponse, ...args: any[]) {
      const headers = args.find((arg, index) => index > 0 && arg && typeof arg === 'object');

      if (Array.isArray(headers)) {
        // Flat [name, value, name, value, ...] form.
        for (let i = 0; i + 1 < headers.length; i += 2) {
          headersFromWriteHead[String(headers[i]).toLowerCase()] = headers[i + 1];
        }
      } else if (headers) {
        headersFromWriteHead = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value as any]));
      }

      return (writeHead as (...a: any[]) => ServerResponse).apply(this, args);
    } as typeof res.writeHead;

    return { body, writeHeadHeaders: () => headersFromWriteHead };
  }
}

class BodyCollector {
  private chunks: Buffer[] = [];
  private size = 0;
  private truncated = false;

  constructor(private maxBytes: number) {
  }

  public add(chunk: unknown, encoding?: BufferEncoding): void {
    if (this.truncated || chunk === undefined || chunk === null) {
      return;
    }

    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : Buffer.from(String(chunk), encoding);

    const room = this.maxBytes - this.size;

    if (buffer.length > room) {
      this.chunks.push(buffer.subarray(0, room));
      this.size = this.maxBytes;
      this.truncated = true;
      return;
    }

    this.chunks.push(buffer);
    this.size += buffer.length;
  }

  public result(): CapturedBody {
    return { data: Buffer.concat(this.chunks), truncated: this.truncated };
  }
}
