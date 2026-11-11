export type Io<A extends boolean, T> = A extends true ? Promise<T> : T;
/** Execute the shared Affiliate algorithm synchronously for SQLite or await each PG I/O. */
export function runAffiliateIo(steps: Generator<unknown, any, any>): any {
  function resume(method: 'next' | 'throw', input?: unknown): any {
    for (;;) {
      const step = method === 'next' ? steps.next(input) : steps.throw(input);
      if (step.done) return step.value;
      if (step.value instanceof Promise)
        return step.value.then(
          (value) => resume('next', value),
          (error) => resume('throw', error),
        );
      method = 'next';
      input = step.value;
    }
  }
  return resume('next');
}
export function iterateAffiliateIo(
  items: any[],
  operation: (...args: any[]) => Generator<unknown, any, any>,
  mode: 'map' | 'forEach' | 'some',
): any {
  return runAffiliateIo(
    (function* (): Generator<unknown, any, any> {
      const result = [];
      for (let index = 0; index < items.length; index++) {
        const value = yield runAffiliateIo(operation(items[index], index));
        if (mode === 'some' && value) return true;
        result.push(value);
      }
      return mode === 'some' ? false : mode === 'forEach' ? undefined : result;
    })(),
  );
}
