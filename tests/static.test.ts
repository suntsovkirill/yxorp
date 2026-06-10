import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, fetchYxorp } from './helpers/create-yxorp';
import http from 'http';

const fixtures = path.resolve(__dirname, 'fixtures');

let target: http.Server;
let targetPort: number;
let yxorp: { port: number; stop: () => Promise<void> };

beforeAll(async () => {
  const targetServer = await startTargetServer();
  target = targetServer.server;
  targetPort = targetServer.port;

  yxorp = await createYxorp({
    target: `http://localhost:${targetPort}`,
    staticRules: [
      {
        path: '/static',
        directory: fixtures,
      },
    ],
  });
});

afterAll(async () => {
  await yxorp.stop();
  await stopTargetServer(target);
});

describe('Static file serving', () => {
  it('serves HTML file from static directory', async () => {
    const res = await fetchYxorp(yxorp.port, '/static/hello.html');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('html');
    expect(res.body).toContain('Hello from static');
  });

  it('serves JSON file from static directory', async () => {
    const res = await fetchYxorp(yxorp.port, '/static/mock-data.json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('json');
    const data = JSON.parse(res.body);
    expect(data.mocked).toBe(true);
  });

  it('returns 404 for non-matching static path', async () => {
    const res = await fetchYxorp(yxorp.port, '/some-other-path');
    // Falls through to proxy, which returns the target's response
    expect(res.body).toContain('target:');
  });

  it('falls through to proxy for non-matching file in static path', async () => {
    const res = await fetchYxorp(yxorp.port, '/api/user');
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.name).toBe('Alice');
  });
});

describe('Symlink containment', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-symlink-'));
  const staticDir = path.join(tmpRoot, 'static');
  const outsideDir = path.join(tmpRoot, 'outside');
  fs.mkdirSync(staticDir);
  fs.mkdirSync(outsideDir);

  const secretFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(secretFile, 'top secret');

  // Symlink creation requires elevated privileges on some platforms
  // (notably Windows without Developer Mode) — skip this suite there.
  let symlinkSupported = true;
  try {
    fs.symlinkSync(secretFile, path.join(staticDir, 'escape.txt'), 'file');
  } catch {
    symlinkSupported = false;
  }

  let symlinkYxorp: { port: number; stop: () => Promise<void> };

  beforeAll(async () => {
    if (!symlinkSupported) return;

    symlinkYxorp = await createYxorp({
      target: `http://localhost:${targetPort}`,
      staticRules: [
        {
          path: '/static',
          directory: staticDir,
        },
      ],
    });
  });

  afterAll(async () => {
    await symlinkYxorp?.stop();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.skipIf(!symlinkSupported)('does not serve a file outside the static directory via a symlink', async () => {
    const res = await fetchYxorp(symlinkYxorp.port, '/static/escape.txt');
    expect(res.body).not.toContain('top secret');
  });
});
