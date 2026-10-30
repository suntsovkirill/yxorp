import { EventEmitter } from 'events';
import { CapturedExchange } from '../middleware/capture.middleware';
import { decodeBody, headerValue, isText } from '../services/har-writer';

const DEFAULT_LIMIT = 500;

// Bodies larger than this are shown truncated in the UI (mocks get the full body).
const MAX_DISPLAY_BYTES = 1024 * 1024;

export interface TrafficSummary {
  id: number;
  startedAt: string;
  durationMs: number;
  method: string;
  url: string;
  statusCode: number;
  handledBy?: string;
  responseSize: number;
  contentType?: string;
}

export interface DisplayBody {
  // UTF-8 text, or base64 for binary content.
  text: string;
  encoding: 'utf-8' | 'base64';
  size: number;
  truncated: boolean;
}

export interface TrafficDetail extends TrafficSummary {
  request: { headers: Record<string, unknown>; body: DisplayBody };
  response: { statusMessage: string; headers: Record<string, unknown>; body: DisplayBody };
}

/**
 * The web UI's recent traffic: a ring buffer of captured exchanges (the
 * newest `limit`), fed by the capture middleware. Emits 'add' with each new
 * summary for the live view.
 */
export class TrafficLog extends EventEmitter {
  private entries: { summary: TrafficSummary; exchange: CapturedExchange }[] = [];
  private nextId = 1;

  constructor(private limit = DEFAULT_LIMIT) {
    super();
  }

  public add = (exchange: CapturedExchange): void => {
    const summary: TrafficSummary = {
      id: this.nextId++,
      startedAt: exchange.startedAt.toISOString(),
      durationMs: exchange.durationMs,
      method: exchange.request.method,
      url: exchange.request.url,
      statusCode: exchange.response.statusCode,
      handledBy: exchange.handledBy,
      responseSize: exchange.response.body.data.length,
      contentType: headerValue(exchange.response.headers['content-type']),
    };

    this.entries.push({ summary, exchange });

    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }

    this.emit('add', summary);
  };

  public list(): TrafficSummary[] {
    return this.entries.map(entry => entry.summary);
  }

  public get(id: number): CapturedExchange | undefined {
    return this.entries.find(entry => entry.summary.id === id)?.exchange;
  }

  public clear(): void {
    this.entries = [];
  }

  public async detail(id: number): Promise<TrafficDetail | undefined> {
    const entry = this.entries.find(e => e.summary.id === id);

    if (!entry) {
      return undefined;
    }

    const { request, response } = entry.exchange;

    return {
      ...entry.summary,
      request: {
        headers: { ...request.headers },
        body: await displayBody(request.body.data, headerValue(request.headers['content-type']), undefined),
      },
      response: {
        statusMessage: response.statusMessage,
        headers: { ...response.headers },
        body: await displayBody(
          response.body.data,
          headerValue(response.headers['content-type']),
          headerValue(response.headers['content-encoding']),
          response.body.truncated,
        ),
      },
    };
  }
}

/** The decoded body of an exchange — for making a mock out of it. */
export async function decodedResponseBody(exchange: CapturedExchange): Promise<Buffer> {
  return decodeBody(exchange.response.body.data, headerValue(exchange.response.headers['content-encoding']));
}

async function displayBody(data: Buffer, contentType: string | undefined, contentEncoding: string | undefined, truncated = false): Promise<DisplayBody> {
  const decoded = await decodeBody(data, contentEncoding);
  const shown = decoded.subarray(0, MAX_DISPLAY_BYTES);
  // Without a content type, show it as text if it decodes cleanly.
  const text = isText(contentType) || (!contentType && !shown.toString('utf-8').includes('�'));

  return {
    text: shown.toString(text ? 'utf-8' : 'base64'),
    encoding: text ? 'utf-8' : 'base64',
    size: decoded.length,
    truncated: truncated || decoded.length > MAX_DISPLAY_BYTES,
  };
}
