/** Interpret only repository I/O; the same algorithm stays synchronous for SQLite. */
export function runResearchIo<T>(
  steps: Generator<unknown, T, any>,
): T | Promise<T> {
  function resume(method: 'next' | 'throw', input?: unknown): T | Promise<T> {
    for (;;) {
      const step = method === 'next' ? steps.next(input) : steps.throw(input);
      if (step.done) return step.value;
      if (step.value instanceof Promise) {
        return step.value.then(
          (value) => resume('next', value),
          (error: unknown) => resume('throw', error),
        );
      }
      method = 'next';
      input = step.value;
    }
  }
  return resume('next');
}
