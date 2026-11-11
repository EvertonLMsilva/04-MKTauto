/** Execute the shared Content algorithm synchronously for SQLite or await each PG I/O. */
export function runContentIo(steps: Generator<unknown, any, any>): any {
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
export function mapContentIo(
  items: any[],
  operation: (...args: any[]) => Generator<unknown, any, any>,
): any {
  return runContentIo(
    (function* (): Generator<unknown, any[], any> {
      const results = [];
      for (let index = 0; index < items.length; index++)
        results.push(yield runContentIo(operation(items[index], index)));
      return results;
    })(),
  );
}
