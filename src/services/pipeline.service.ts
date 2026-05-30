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

      await middleware.use(...args, () => {
        return runner(index + 1);
      });
    }

    await runner(0);
  }
}
