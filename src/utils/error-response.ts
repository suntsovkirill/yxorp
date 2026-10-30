import { ServerResponse } from 'http';

/**
 * Sends a plain-text error response explaining what went wrong (e.g.
 * `yxorp: cannot reach http://localhost:8080: ECONNREFUSED`) instead of an
 * empty body — so a failed request is self-explanatory in the browser's
 * network tab. A no-op once headers are already sent; callers decide what to
 * do with a response that is already in flight.
 */
export function sendErrorResponse(res: ServerResponse, statusCode: number, message: string): void {
  if (res.headersSent) {
    return;
  }

  const body = `yxorp: ${message}\n`;

  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

/**
 * Short description of an error for an error response — the system error code
 * (`ECONNREFUSED`, `ENOTFOUND`) when there is one, else the message.
 */
export function describeError(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown } | undefined;

  if (e && typeof e.code === 'string') {
    return e.code;
  }

  if (e && typeof e.message === 'string' && e.message) {
    return e.message;
  }

  return String(error);
}
