import { describe, it, expect } from 'vitest';
import { Pipeline } from '../src/services/pipeline.service';

describe('Pipeline', () => {
  it('runs middleware in order', async () => {
    const calls: string[] = [];
    const pipeline = new Pipeline<[string[]]>();

    pipeline.use(
      { use: (log, next) => { log.push('a'); return next(); } },
      { use: (log, next) => { log.push('b'); return next(); } },
    );

    await pipeline.execute(calls);
    expect(calls).toEqual(['a', 'b']);
  });

  it('propagates a downstream error even when next() is not returned', async () => {
    const pipeline = new Pipeline<[]>();

    pipeline.use(
      // Calls next() without returning its promise — as BootstrapMiddleware does.
      { use: (next) => { next(); } },
      { use: () => { throw new Error('downstream failure'); } },
    );

    await expect(pipeline.execute()).rejects.toThrow('downstream failure');
  });

  it('propagates a downstream error when next() is called later from an async middleware', async () => {
    const pipeline = new Pipeline<[]>();

    pipeline.use(
      { use: async (next) => { await Promise.resolve(); next(); } },
      { use: async () => { throw new Error('async downstream failure'); } },
    );

    await expect(pipeline.execute()).rejects.toThrow('async downstream failure');
  });

  it('waits for downstream middleware to finish', async () => {
    let finished = false;
    const pipeline = new Pipeline<[]>();

    pipeline.use(
      { use: (next) => { next(); } },
      { use: async () => { await new Promise(resolve => setTimeout(resolve, 20)); finished = true; } },
    );

    await pipeline.execute();
    expect(finished).toBe(true);
  });
});
