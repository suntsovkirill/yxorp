/**
 * Programmatic API — `require('yxorp')` / `import { startYxorp } from 'yxorp'`.
 * The `yxorp` command lives in ./cli.ts.
 */
export { startYxorp, YxorpConfigError, DEFAULT_HOST } from './app';
export type { YxorpOptions, YxorpServer } from './app';
export { LoggerService } from './services/logger.service';
export type { LogLevel, LoggerOptions } from './services/logger.service';
export { validateConfig, findConfigWarnings } from './services/config-validator';
export type * from './types/yxorp-config';
