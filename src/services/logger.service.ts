import { inspect } from 'util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const LEVEL_COLORS: Record<LogLevel, number> = { debug: 34, info: 32, warn: 33, error: 31 };

interface OutputStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export interface LoggerOptions {
  // Messages below this level are dropped (default: 'info').
  level?: LogLevel;
  // Colorize the level label (default: when the stream is a TTY and NO_COLOR isn't set).
  color?: boolean;
  // info/debug go to stdout, warn/error to stderr.
  stdout?: OutputStream;
  stderr?: OutputStream;
}

/**
 * Minimal console logger: `info: message`, with the level label colorized on
 * a terminal. Errors are printed as their message — or their stack at the
 * `debug` level (`--verbose`). The methods are instance properties so tests
 * can replace them individually.
 */
export class LoggerService {
  private readonly level: LogLevel;
  private readonly stdout: OutputStream;
  private readonly stderr: OutputStream;
  private readonly color: boolean | undefined;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.color = options.color;
  }

  public debug = (message: unknown): void => this.log('debug', message);
  public info = (message: unknown): void => this.log('info', message);
  public warn = (message: unknown): void => this.log('warn', message);
  public error = (message: unknown): void => this.log('error', message);

  private log(level: LogLevel, message: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }

    const stream = level === 'warn' || level === 'error' ? this.stderr : this.stdout;
    const label = this.useColor(stream) ? `\x1b[${LEVEL_COLORS[level]}m${level}\x1b[39m` : level;

    stream.write(`${label}: ${this.format(message)}\n`);
  }

  private format(message: unknown): string {
    if (message instanceof Error) {
      return this.level === 'debug' && message.stack ? message.stack : message.message;
    }

    return typeof message === 'string' ? message : inspect(message);
  }

  private useColor(stream: OutputStream): boolean {
    if (this.color !== undefined) {
      return this.color;
    }

    if (process.env.NO_COLOR) {
      return false;
    }

    return !!process.env.FORCE_COLOR || !!stream.isTTY;
  }
}

/**
 * Log level from `--quiet` (warnings and errors only) / `--verbose` (adds
 * debug messages and error stacks).
 */
export function logLevelFromArgv(argv: string[]): LogLevel {
  if (argv.includes('--verbose')) return 'debug';
  if (argv.includes('--quiet')) return 'warn';
  return 'info';
}
