import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';

let target: http.Server;
let yxorp: YxorpInstance;

beforeAll(async () => {
  const targetServer = await startTargetServer();
  target = targetServer.server;

  yxorp = await createYxorp({
    target: `http://localhost:${targetServer.port}`,
    mockRules: [
      // First matching rule wins — the most specific conditions go first.
      { method: 'GET', path: '/api/list', match: { query: { page: '2', sort: 'name' } }, json: 'page 2 by name' },
      { method: 'GET', path: '/api/list', match: { query: { page: '2' } }, json: 'page 2' },
      { method: 'GET', path: '/api/me', match: { headers: { 'X-User': 'admin' } }, json: 'admin' },
      { method: 'GET', path: '/api/me', match: { headers: { authorization: 'Bearer guest' } }, json: 'guest' },
    ],
    rewriteRules: [
      { method: 'GET', path: '/api/user', match: { query: { rewrite: 'yes' } }, json: 'rewritten' },
    ],
  });
});

afterAll(async () => {
  await yxorp.stop();
  await stopTargetServer(target);
});

describe('match conditions', () => {
  it('requires every query condition', async () => {
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/list?page=2&sort=name')).body)).toBe('page 2 by name');
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/list?sort=name&page=2&x=1')).body)).toBe('page 2 by name');
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/list?page=2')).body)).toBe('page 2');
  });

  it('falls through to the target when no rule conditions match', async () => {
    expect((await fetchYxorp(yxorp.port, '/api/list?page=3')).body).toBe('target: /api/list?page=3');
    expect((await fetchYxorp(yxorp.port, '/api/list')).body).toBe('target: /api/list');
  });

  it('matches a repeated query param on any of its values', async () => {
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/list?page=1&page=2')).body)).toBe('page 2');
  });

  it('matches request headers case-insensitively by name, exactly by value', async () => {
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/me', { headers: { 'x-user': 'admin' } })).body)).toBe('admin');
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/me', { headers: { Authorization: 'Bearer guest' } })).body)).toBe('guest');
    expect((await fetchYxorp(yxorp.port, '/api/me', { headers: { 'x-user': 'Admin' } })).body).toBe('target: /api/me');
  });

  it('applies to rewrite rules too', async () => {
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/user?rewrite=yes')).body)).toBe('rewritten');
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/user')).body)).toEqual({ id: 1, name: 'Alice' });
  });
});
