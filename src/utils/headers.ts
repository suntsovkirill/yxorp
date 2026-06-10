import { IncomingHttpHeaders } from 'http';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * RFC 2616 §13.5.1 hop-by-hop headers must not be forwarded between a proxy
 * and its client — plus any header dynamically named in the `Connection`
 * header's value.
 */
export function isHopByHopHeader(name: string, headers: IncomingHttpHeaders): boolean {
  const lower = name.toLowerCase();

  if (HOP_BY_HOP_HEADERS.has(lower)) {
    return true;
  }

  const connection = headers.connection;

  if (connection) {
    const named = (Array.isArray(connection) ? connection.join(',') : connection)
      .split(',')
      .map((value) => value.trim().toLowerCase());

    if (named.includes(lower)) {
      return true;
    }
  }

  return false;
}
