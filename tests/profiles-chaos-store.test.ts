import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http, { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createRecordingLogger, createYxorp, fetchYxorp, YxorpInstance } from './helpers/create-yxorp';
import { applyProfile } from '../src/services/proxy-config';
import { applyCliOverrides } from '../src/services/cli-overrides';
import { validateConfig } from '../src/services/config-validator';
import { ChaosMiddleware } from '../src/middleware/chaos.middleware';
import { Config } from '../src/services/config.service';
import { Pipeline } from '../src/services/pipeline.service';
import { buildProxyConfig } from '../src/services/proxy-config';
import { ChaosOptions } from '../src/types/yxorp-config';

const fixtures = path.resolve(__dirname, 'fixtures');

let target: http.Server;
let targetUrl: string;

beforeAll(async () => {
  const targetServer = await startTargetServer();
  target = targetServer.server;
  targetUrl = `http://localhost:${targetServer.port}`;
});

afterAll(async () => {
  await stopTargetServer(target);
});

describe('profiles', () => {
  const config = {
    target: 'http://example.com',
    proxyPort: 0,
    mockRules: [{ method: 'GET', path: '/api/orders', json: ['base'] }],
    profiles: {
      empty: { mockRules: [{ method: 'GET', path: '/api/orders', json: [] }] },
      slow: { chaos: { delay: 100 } },
    },
  };

  it('puts the active profile rules before the base rules', () => {
    expect(applyProfile({ ...config, profile: 'empty' }).mockRules!.map(rule => (rule as any).json))
      .toEqual([[], ['base']]);
    expect(applyProfile(config).mockRules).toEqual(config.mockRules);
    expect(applyProfile({ ...config, profile: 'slow' }).chaos).toEqual({ delay: 100 });
  });

  it('can be selected with --profile', () => {
    expect(applyCliOverrides(config, ['node', 'yxorp', '--profile', 'empty']).profile).toBe('empty');
  });

  it('must exist', () => {
    expect(validateConfig({ ...config, target: 'http://example.com', profile: 'nope' }))
      .toContainEqual('"profile" is "nope", but there is no such profile (available: empty, slow)');
  });

  it('switches the served responses', async () => {
    const withProfile = await createYxorp({ ...config, target: targetUrl, profile: 'empty' } as any);
    const without = await createYxorp({ ...config, target: targetUrl } as any);

    try {
      expect(JSON.parse((await fetchYxorp(withProfile.port, '/api/orders')).body)).toEqual([]);
      expect(JSON.parse((await fetchYxorp(without.port, '/api/orders')).body)).toEqual(['base']);
    } finally {
      await withProfile.stop();
      await without.stop();
    }
  });
});

describe('chaos', () => {
  /** A server running ChaosMiddleware with a scripted random() and a terminal "ok" handler. */
  async function chaosServer(chaos: ChaosOptions, randoms: number[]) {
    const appConfig = new Config();
    appConfig.set(buildProxyConfig({ target: 'http://example.com', proxyPort: 0, chaos }));

    const pipeline = new Pipeline<[IncomingMessage, ServerResponse]>();
    pipeline.use(
      new ChaosMiddleware(appConfig, createRecordingLogger().logger, () => randoms.shift() ?? 0.99),
      { use: (_req, res) => { res.end('ok'); } },
    );

    const server = http.createServer((req, res) => { void pipeline.execute(req, res); });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    return { port, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
  }

  it('answers with the error status at the error rate', async () => {
    const server = await chaosServer({ errorRate: 0.5, errorStatus: 500 }, [0.4, 0.6]);

    try {
      const failed = await fetchYxorp(server.port, '/x');
      expect(failed.statusCode).toBe(500);
      expect(failed.body).toBe('yxorp: injected failure (chaos)\n');
      expect((await fetchYxorp(server.port, '/x')).body).toBe('ok');
    } finally {
      await server.close();
    }
  });

  it('drops the connection at the drop rate', async () => {
    const server = await chaosServer({ dropRate: 0.1 }, [0.05]);

    try {
      await expect(fetchYxorp(server.port, '/x')).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it('adds latency within the configured range', async () => {
    const server = await chaosServer({ delay: { min: 100, max: 300 } }, [0]);

    try {
      const started = Date.now();
      expect((await fetchYxorp(server.port, '/x')).body).toBe('ok');
      expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    } finally {
      await server.close();
    }
  });

  it('only affects matching paths', async () => {
    const server = await chaosServer({ errorRate: 1, paths: ['/api/*rest'] }, [0, 0]);

    try {
      expect((await fetchYxorp(server.port, '/api/users')).statusCode).toBe(503);
      expect((await fetchYxorp(server.port, '/static/app.js')).body).toBe('ok');
    } finally {
      await server.close();
    }
  });

  it('applies before mocks, with errorRate 1', async () => {
    const yxorp = await createYxorp({
      target: targetUrl,
      chaos: { errorRate: 1 },
      mockRules: [{ method: 'GET', path: '/m', json: {} }],
    });

    try {
      expect((await fetchYxorp(yxorp.port, '/m')).statusCode).toBe(503);
    } finally {
      await yxorp.stop();
    }
  });
});

describe('ctx.store', () => {
  let yxorp: YxorpInstance;

  beforeAll(async () => {
    yxorp = await createYxorp({
      target: targetUrl,
      mockRules: [
        { method: 'GET', path: '/todos', script: path.join(fixtures, 'mock-todos.js') },
        { method: 'POST', path: '/todos', script: path.join(fixtures, 'mock-todos.js') },
      ],
      rewriteRules: [{ method: 'GET', path: '/api/:name', script: path.join(fixtures, 'rewrite-count.js') }],
    });
  });

  afterAll(async () => {
    await yxorp.stop();
  });

  it('keeps state across requests for mock scripts', async () => {
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/todos')).body)).toEqual([]);

    const created = await fetchYxorp(yxorp.port, '/todos', { method: 'POST', body: '{"title":"milk"}' });
    expect(created.statusCode).toBe(201);
    await fetchYxorp(yxorp.port, '/todos', { method: 'POST', body: '{"title":"bread"}' });

    expect(JSON.parse((await fetchYxorp(yxorp.port, '/todos')).body)).toEqual([
      { id: 1, title: 'milk' },
      { id: 2, title: 'bread' },
    ]);
  });

  it('passes the store and params to rewrite scripts', async () => {
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/user')).body)).toEqual({ count: 1, params: { name: 'user' } });
    expect(JSON.parse((await fetchYxorp(yxorp.port, '/api/items')).body)).toEqual({ count: 2, params: { name: 'items' } });
  });
});
