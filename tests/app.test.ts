import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createRecordingLogger, fetchYxorp } from './helpers/create-yxorp';
import * as yxorp from '../src/index';
import { startYxorp, YxorpConfigError } from '../src/index';

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

describe('startYxorp', () => {
  it('exports the API without starting anything on import', () => {
    expect(typeof yxorp.startYxorp).toBe('function');
    expect(typeof yxorp.validateConfig).toBe('function');
    expect(yxorp.DEFAULT_HOST).toBe('127.0.0.1');
  });

  it('starts a proxy from a config object, on 127.0.0.1 by default', async () => {
    const proxy = await startYxorp({
      config: { target: targetUrl, proxyPort: 0, mockRules: [{ method: 'GET', path: '/mocked', file: 'mock-data.json' }] },
      configDir: fixtures,
      logger: createRecordingLogger().logger,
    });

    try {
      expect(proxy.url).toBe(`http://127.0.0.1:${proxy.port}`);
      expect(JSON.parse((await fetchYxorp(proxy.port, '/api/user')).body)).toEqual({ id: 1, name: 'Alice' });
      // Relative rule paths resolve against configDir, not the current directory.
      expect(JSON.parse((await fetchYxorp(proxy.port, '/mocked')).body)).toEqual({ mocked: true, source: 'file', value: 42 });
    } finally {
      await proxy.close();
    }
  });

  it('loads a config file, resolving relative paths against its directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-app-'));
    fs.writeFileSync(path.join(dir, 'data.json'), '{"from":"file"}');
    fs.writeFileSync(path.join(dir, 'yxorp.json'), JSON.stringify({
      target: targetUrl,
      proxyPort: 0,
      mockRules: [{ method: 'GET', path: '/data', file: './data.json' }],
    }));

    const proxy = await startYxorp({ configPath: path.join(dir, 'yxorp.json'), logger: createRecordingLogger().logger });

    try {
      expect(JSON.parse((await fetchYxorp(proxy.port, '/data')).body)).toEqual({ from: 'file' });
    } finally {
      await proxy.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies argv overrides', async () => {
    const proxy = await startYxorp({
      config: { target: 'http://127.0.0.1:1', proxyPort: 0 },
      argv: ['node', 'yxorp', '--target', targetUrl, '--host', '0.0.0.0'],
      logger: createRecordingLogger().logger,
    });

    try {
      expect(proxy.url).toBe(`http://localhost:${proxy.port}`);
      expect(proxy.config.get().target).toBe(targetUrl);
      expect((await fetchYxorp(proxy.port, '/api/user')).statusCode).toBe(200);
    } finally {
      await proxy.close();
    }
  });

  it('rejects an invalid config with every error listed', async () => {
    const error = await startYxorp({ config: { target: 'nope', proxyPort: -1 } as any }).catch(e => e);
    expect(error).toBeInstanceOf(YxorpConfigError);
    expect(error.errors).toHaveLength(2);
    expect(error.message).toContain('Invalid config:');
  });

  it('rejects when the port is taken', async () => {
    const first = await startYxorp({ config: { target: targetUrl, proxyPort: 0 }, logger: createRecordingLogger().logger });

    try {
      await expect(startYxorp({ config: { target: targetUrl, proxyPort: first.port }, logger: createRecordingLogger().logger }))
        .rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await first.close();
    }
  });
});
