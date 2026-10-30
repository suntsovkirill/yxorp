import { Config } from '../../src/services/config.service';
import { LoggerService } from '../../src/services/logger.service';
import { MockRulesMatcher } from '../../src/services/rules-matchers/mock-rules-matcher.service';
import { RewriteRulesMatcher } from '../../src/services/rules-matchers/rewrite-rules-matcher.service';
import { RemoteRulesMatcher } from '../../src/services/rules-matchers/remote-rules-matcher.service';
import { createServer } from '../../src/services/yxorp-server.service';
import { buildProxyConfig } from '../../src/services/proxy-config';
import { CaptureListener } from '../../src/middleware/capture.middleware';
import { ConfigFile } from '../../src/types/yxorp-config';

export interface YxorpInstance {
  port: number;
  stop: () => Promise<void>;
}

function createSilentLogger(): LoggerService {
  const logger = new LoggerService();
  logger.info = (() => {}) as any;
  logger.error = (() => {}) as any;
  logger.warn = (() => {}) as any;
  logger.debug = (() => {}) as any;
  return logger;
}

/**
 * Logger that records every message instead of printing it — for asserting on
 * access-log lines and errors.
 */
export function createRecordingLogger(): { logger: LoggerService; messages: { level: string; message: string }[] } {
  const logger = new LoggerService();
  const messages: { level: string; message: string }[] = [];

  for (const level of ['info', 'error', 'warn', 'debug'] as const) {
    logger[level] = ((message: unknown) => {
      messages.push({ level, message: message instanceof Error ? message.message : String(message) });
    }) as any;
  }

  return { logger, messages };
}

export async function createYxorp(
  configFile: Partial<ConfigFile> & { target: string },
  options?: { logger?: LoggerService; capture?: CaptureListener[] },
): Promise<YxorpInstance> {
  const logger = options?.logger ?? createSilentLogger();

  const appConfig = new Config();
  appConfig.set(buildProxyConfig({
    ...configFile,
    proxyPort: configFile.proxyPort || 0,
  }));

  const mockRulesMatcher = new MockRulesMatcher(appConfig);
  const rewriteRulesMatcher = new RewriteRulesMatcher(appConfig);
  const remoteRulesMatcher = new RemoteRulesMatcher(appConfig);

  const { server } = createServer(
    appConfig,
    logger,
    rewriteRulesMatcher,
    mockRulesMatcher,
    remoteRulesMatcher,
    { capture: options?.capture },
  );

  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address() as { port: number } | null;
      resolve({
        port: address?.port ?? 0,
        stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
      });
    });
  });
}

import http from 'http';

export function fetchYxorp(
  yxorpPort: number,
  path: string,
  options?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<http.IncomingMessage & { body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: yxorpPort,
        path,
        method: options?.method || 'GET',
        headers: options?.headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          (res as any).body = body;
          resolve(res as http.IncomingMessage & { body: string });
        });
      }
    );
    req.on('error', reject);
    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}
