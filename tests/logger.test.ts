import { describe, it, expect } from 'vitest';
import { LoggerService, logLevelFromArgv } from '../src/services/logger.service';

function createStreams(isTTY = false) {
  const stdout = { isTTY, output: '', write(chunk: string) { this.output += chunk; } };
  const stderr = { isTTY, output: '', write(chunk: string) { this.output += chunk; } };
  return { stdout, stderr };
}

describe('LoggerService', () => {
  it('writes info/debug to stdout and warn/error to stderr', () => {
    const { stdout, stderr } = createStreams();
    const logger = new LoggerService({ level: 'debug', stdout, stderr, color: false });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(stdout.output).toBe('debug: d\ninfo: i\n');
    expect(stderr.output).toBe('warn: w\nerror: e\n');
  });

  it('drops messages below the configured level', () => {
    const { stdout, stderr } = createStreams();
    const logger = new LoggerService({ level: 'warn', stdout, stderr, color: false });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');

    expect(stdout.output).toBe('');
    expect(stderr.output).toBe('warn: w\n');
  });

  it('prints an error as its message, or its stack at the debug level', () => {
    const error = new Error('boom');

    const quiet = createStreams();
    new LoggerService({ stdout: quiet.stdout, stderr: quiet.stderr, color: false }).error(error);
    expect(quiet.stderr.output).toBe('error: boom\n');

    const verbose = createStreams();
    new LoggerService({ level: 'debug', stdout: verbose.stdout, stderr: verbose.stderr, color: false }).error(error);
    expect(verbose.stderr.output).toContain('Error: boom\n    at ');
  });

  it('inspects non-string values', () => {
    const { stdout, stderr } = createStreams();
    new LoggerService({ stdout, stderr, color: false }).info({ a: 1 });
    expect(stdout.output).toBe('info: { a: 1 }\n');
  });

  it('colorizes the level label when enabled', () => {
    const { stdout, stderr } = createStreams();
    new LoggerService({ stdout, stderr, color: true }).info('i');
    expect(stdout.output).toBe('\x1b[32minfo\x1b[39m: i\n');
  });
});

describe('logLevelFromArgv', () => {
  it('maps --quiet and --verbose to levels', () => {
    expect(logLevelFromArgv(['node', 'yxorp'])).toBe('info');
    expect(logLevelFromArgv(['node', 'yxorp', '--quiet'])).toBe('warn');
    expect(logLevelFromArgv(['node', 'yxorp', '--verbose'])).toBe('debug');
  });
});
