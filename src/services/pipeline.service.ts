export interface Middleware<T extends any[]> {
  use(...args: [...T, () => void]): void | Promise<void>;
}

export class Pipeline<T extends any[]> {
  private stack: Middleware<T>[] = [];

  public use(...middlewares: Middleware<T>[]) {
    this.stack.push(...middlewares);
  }

  public async execute(...args: [...T]) {
    let prevIndex = -1;

    const runner = async (index: number) => {
      if (index === prevIndex) {
        throw new Error('next() called multiple times');
      }

      prevIndex = index;

      const middleware = this.stack[index];

      if (!middleware) {
        return;
      }

      // Keep hold of the downstream promise and await it here as well — a
      // middleware that calls `next()` without returning/awaiting it would
      // otherwise drop a downstream rejection on the floor (an unhandled
      // rejection that crashes the process, with the client left hanging).
      let downstream: Promise<void> | undefined;

      await middleware.use(...args, () => {
        downstream = runner(index + 1);
        return downstream;
      });

      if (downstream) {
        await downstream;
      }
    }

    await runner(0);
  }
}
