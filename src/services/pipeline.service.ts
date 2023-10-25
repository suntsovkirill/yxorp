import { Container, Service } from 'typedi';


export interface Middleware<T extends any[]> {
  use(...args: [...T, () => void]): void;
  [k: string]: any;
}

export interface MiddlewareCtor<T extends any[]> {
  new(...args: any): Middleware<T>;
}
export type Middlewares<T extends any[]> = MiddlewareCtor<T>[];

@Service({
  transient: true,
})
export class Pipeline<T extends any[]> {
  private stack: Middlewares<T> = [];

  public use(...middlewares: Middlewares<T>) {
    this.stack.push(...middlewares);
  }

  public async execute(...args: [...T]) {
    let prevIndex = -1;

    const runner = async (index: number) => {
      if (index === prevIndex) {
        throw new Error('next() called multiple times');
      }

      prevIndex = index;

      const middleware = Container.get(this.stack[index]);

      await middleware.use(...args, () => {
        return runner(index + 1);
      });
    }

    await runner(0);
  }

}
