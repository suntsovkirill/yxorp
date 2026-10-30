import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';

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

/**
 * Copies every non-hop-by-hop header from the upstream response onto the client
 * response. Shared by the streaming (`StreamMiddleware`) and buffered
 * (`ProxyResMiddleware`) proxy paths so the hop-by-hop filtering lives in one
 * place rather than being re-derived per copy loop.
 */
export function forwardResponseHeaders(proxyRes: IncomingMessage, res: ServerResponse): void {
  // CORS headers yxorp already set (`cors` option) win over the target's.
  const keepOwnCors = res.hasHeader('access-control-allow-origin');

  for (const key in proxyRes.headers) {
    if (isHopByHopHeader(key, proxyRes.headers)) continue;

    const lower = key.toLowerCase();

    if (keepOwnCors && lower.startsWith('access-control-')) continue;

    if (lower === 'vary' && res.hasHeader('vary')) {
      res.setHeader('vary', mergeVary(res.getHeader('vary'), proxyRes.headers.vary));
      continue;
    }

    res.setHeader(key, proxyRes.headers[key] as string | string[]);
  }
}

function mergeVary(...values: unknown[]): string {
  const names = values
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === 'string')
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const merged: string[] = [];

  for (const name of names) {
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      merged.push(name);
    }
  }

  return merged.join(', ');
}
