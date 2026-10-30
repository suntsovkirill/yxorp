import { describe, it, expect } from 'vitest';
import { compilePath, matchPath } from '../src/utils/path-pattern';

describe('path-pattern', () => {
  it('matches and decodes params, consistently across repeated calls', () => {
    expect(matchPath('/api/users/:id', '/api/users/a%20b')).toEqual({ path: '/api/users/a%20b', params: { id: 'a b' } });
    expect(matchPath('/api/users/:id', '/api/users/42')?.params).toEqual({ id: '42' });
    expect(matchPath('/api/users/:id', '/api/other')).toBeUndefined();
  });

  it('keeps throwing on a malformed pattern rather than caching a failure', () => {
    expect(() => matchPath('/api/:[bad', '/api/x')).toThrow();
    expect(() => matchPath('/api/:[bad', '/api/x')).toThrow();
  });

  it('compiles a path from params', () => {
    expect(compilePath('/v2/items/:id', { id: '5' })).toBe('/v2/items/5');
    expect(compilePath('/v2/items/:id', { id: 'a b' })).toBe('/v2/items/a%20b');
  });
});
