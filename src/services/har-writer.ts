import fs from 'fs';
import path from 'path';
import { OutgoingHttpHeaders, IncomingHttpHeaders } from 'http';
import { decodeBuffer } from 'http-encoding';
import { CapturedBody, CapturedExchange } from '../middleware/capture.middleware';

const WRITE_DEBOUNCE_MS = 200;

const TEXT_CONTENT_TYPE = /^text\/|[/+](json|xml|javascript|x-www-form-urlencoded)\b|^application\/(javascript|ecmascript)|event-stream|svg/i;

type HarHeader = { name: string; value: string };

/**
 * Collects captured exchanges into a HAR 1.2 file (`--har <file>`) — open it
 * in the browser devtools' Network panel or any HAR viewer. The file is
 * rewritten shortly after each new entry and on shutdown (`flush()`), so it's
 * always a complete, valid HAR document.
 *
 * Response bodies are stored decoded (gzip/br/deflate removed) — as text for
 * textual content types, base64 otherwise. Custom fields: `_handledBy` (which
 * yxorp middleware answered: `proxy`, `stream`, `rewrite`, `mock`, ...) and
 * `_truncated` on bodies cut off by the capture size limit.
 */
export class HarWriter {
  private entries: object[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private filePath: string,
    private version: string,
  ) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  public add = async (exchange: CapturedExchange): Promise<void> => {
    this.entries.push(await toHarEntry(exchange));
    this.scheduleWrite();
  };

  /** Writes the file now — call on shutdown. */
  public flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    fs.writeFileSync(this.filePath, JSON.stringify(this.toHar(), null, 2));
  }

  private scheduleWrite(): void {
    if (this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      fs.promises.writeFile(this.filePath, JSON.stringify(this.toHar(), null, 2)).catch(() => {
        // Retried with the next entry or on flush().
      });
    }, WRITE_DEBOUNCE_MS);
    this.timer.unref();
  }

  private toHar() {
    return {
      log: {
        version: '1.2',
        creator: { name: 'yxorp', version: this.version },
        entries: this.entries,
      },
    };
  }
}

async function toHarEntry(exchange: CapturedExchange) {
  const { request, response } = exchange;
  const host = request.headers.host || 'localhost';
  const url = new URL(request.url, `${exchange.secure ? 'https' : 'http'}://${host}`);
  const requestType = headerValue(request.headers['content-type']);
  const responseType = headerValue(response.headers['content-type']);
  const responseBody = await decodeBody(response.body.data, headerValue(response.headers['content-encoding']));

  return {
    startedDateTime: exchange.startedAt.toISOString(),
    time: exchange.durationMs,
    request: {
      method: request.method,
      url: url.href,
      httpVersion: `HTTP/${request.httpVersion}`,
      headers: toHarHeaders(request.headers),
      queryString: [...url.searchParams].map(([name, value]) => ({ name, value })),
      cookies: [],
      headersSize: -1,
      bodySize: request.body.data.length,
      ...(request.body.data.length
        ? { postData: { mimeType: requestType || 'application/octet-stream', text: request.body.data.toString('utf-8'), ...truncatedFlag(request.body) } }
        : {}),
    },
    response: {
      status: response.statusCode,
      statusText: response.statusMessage || '',
      httpVersion: `HTTP/${request.httpVersion}`,
      headers: toHarHeaders(response.headers),
      cookies: [],
      content: {
        size: responseBody.length,
        mimeType: responseType || '',
        ...(isText(responseType) ? { text: responseBody.toString('utf-8') } : { text: responseBody.toString('base64'), encoding: 'base64' }),
        ...truncatedFlag(response.body),
      },
      redirectURL: headerValue(response.headers.location) || '',
      headersSize: -1,
      bodySize: response.body.data.length,
    },
    cache: {},
    timings: { send: 0, wait: exchange.durationMs, receive: 0 },
    ...(exchange.handledBy ? { _handledBy: exchange.handledBy } : {}),
  };
}

/** Decodes a captured (still content-encoded) body; falls back to the raw bytes. */
export async function decodeBody(data: Buffer, encoding: string | undefined): Promise<Buffer> {
  if (!encoding || !data.length) {
    return data;
  }

  try {
    return await decodeBuffer(data, encoding);
  } catch {
    // A truncated or malformed encoded body can't be decoded.
    return data;
  }
}

export function headerValue(value: string | string[] | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export function isText(contentType: string | undefined): boolean {
  return !!contentType && TEXT_CONTENT_TYPE.test(contentType);
}

function toHarHeaders(headers: IncomingHttpHeaders | OutgoingHttpHeaders): HarHeader[] {
  return Object.entries(headers).flatMap(([name, value]) => {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map(v => ({ name, value: String(v) }));
  });
}

function truncatedFlag(body: CapturedBody) {
  return body.truncated ? { _truncated: true } : {};
}
