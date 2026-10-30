import { IncomingMessage } from 'http';
import { LoggerService } from '../services/logger.service';
import { elapsedMs } from './request-timing';

const LABEL_WIDTH = 8;

/**
 * Formats a single access-log line with the label column padded to a fixed
 * width so entries from different middlewares (mock, rewrite, proxy, stream,
 * static) line up in the log output.
 */
export function formatAccessLog(label: string, statusCode: number | string | undefined, req: IncomingMessage): string {
  return `${label.padEnd(LABEL_WIDTH)}${statusCode} ${req.method} ${req.originalUrl ?? req.url} ${elapsedMs(req)}ms`;
}

/**
 * Writes the request's access-log line and records which middleware handled it
 * (`req.handledBy`, e.g. `stream`, `mock`) — traffic capture (HAR/record) uses
 * it to tell upstream responses from local ones.
 */
export function logAccess(logger: LoggerService, label: string, statusCode: number | string | undefined, req: IncomingMessage): void {
  req.handledBy = label;
  logger.info(formatAccessLog(label, statusCode, req));
}
