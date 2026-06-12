import { IncomingMessage } from 'http';
import { elapsedMs } from './request-timing';

const LABEL_WIDTH = 8;

/**
 * Formats a single access-log line with the label column padded to a fixed
 * width so entries from different middlewares (mock, rewrite, proxy, stream,
 * static) line up in the log output.
 */
export function formatAccessLog(label: string, statusCode: number | string | undefined, req: IncomingMessage): string {
  return `${label.padEnd(LABEL_WIDTH)}${statusCode} ${req.method} ${req.url} ${elapsedMs(req)}ms`;
}
