import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { startTargetServer, stopTargetServer } from './helpers/target-server';
import { createYxorp, YxorpInstance } from './helpers/create-yxorp';

const tlsDir = path.resolve(__dirname, 'fixtures/tls');
const key = path.join(tlsDir, 'localhost-test-key.pem');
const cert = path.join(tlsDir, 'localhost-test-cert.pem');
const ca = fs.readFileSync(cert);

let target: http.Server;
let targetPort: number;
let yxorp: YxorpInstance;

beforeAll(async () => {
  const targetServer = await startTargetServer();
  target = targetServer.server;
  targetPort = targetServer.port;

  // WebSocket handshake support on the plain-HTTP target.
  target.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n');
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('end', () => socket.end());
  });

  yxorp = await createYxorp({
    target: `http://localhost:${targetPort}`,
    https: { key, cert },
  });
});

afterAll(async () => {
  await yxorp.stop();
  await stopTargetServer(target);
});

describe('https', () => {
  it('serves proxied requests over TLS', async () => {
    const body = await new Promise<string>((resolve, reject) => {
      https.get({ hostname: 'localhost', port: yxorp.port, path: '/api/user', ca }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    expect(JSON.parse(body)).toEqual({ id: 1, name: 'Alice' });
  });

  it('rejects plain HTTP on the TLS port', async () => {
    const result = await new Promise<string>((resolve) => {
      http.get({ hostname: 'localhost', port: yxorp.port, path: '/api/user' }, (res) => {
        res.resume();
        resolve(`status ${res.statusCode}`);
      }).on('error', () => resolve('error'));
    });

    expect(result).not.toBe('status 200');
  });

  it('proxies WebSocket upgrades over TLS (wss)', async () => {
    const echoed = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        hostname: 'localhost',
        port: yxorp.port,
        path: '/chat',
        ca,
        headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      });
      req.on('upgrade', (_res, socket) => {
        socket.once('data', (chunk) => {
          resolve(chunk.toString());
          socket.destroy();
        });
        socket.write('ping');
      });
      req.on('error', reject);
      req.end();
    });

    expect(echoed).toBe('ping');
  });

  it('fails clearly when the key file is missing', async () => {
    await expect(createYxorp({ target: `http://localhost:${targetPort}`, https: { key: './missing-key.pem', cert } }))
      .rejects.toThrow('Cannot read "https.key" file "./missing-key.pem": ENOENT');
  });
});
