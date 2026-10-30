/**
 * Splits a request URL (`req.url`, e.g. `/api/users?page=2`) into its path and
 * query parts. Rule patterns describe paths only, so they must be matched
 * against `pathname` — matching the raw `req.url` makes any request with a
 * query string miss its rule.
 */
export function splitUrl(url: string): { pathname: string; search: string } {
  const queryIndex = url.indexOf('?');

  return queryIndex === -1
    ? { pathname: url, search: '' }
    : { pathname: url.slice(0, queryIndex), search: url.slice(queryIndex) };
}
