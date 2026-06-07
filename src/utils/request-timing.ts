import { IncomingMessage } from 'http';

/**
 * Milliseconds elapsed since the request started (set by HttpServer on arrival).
 * Falls back to 0 if startTime wasn't recorded for some reason.
 */
export function elapsedMs(req: IncomingMessage): number {
  return req.startTime !== undefined ? Date.now() - req.startTime : 0;
}
