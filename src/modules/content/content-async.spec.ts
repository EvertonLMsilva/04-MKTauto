import { describe, it, expect } from 'vitest';
import { runContentIo, mapContentIo } from './application/content-io.js';
describe('Content I/O boundary', () => {
  it('keeps synchronous results and catches asynchronous failures in the shared algorithm', async () => {
    expect(
      runContentIo(
        (function* () {
          return (yield 2) + 3;
        })(),
      ),
    ).toBe(5);
    await expect(
      runContentIo(
        (function* () {
          try {
            yield Promise.reject(new Error('fail'));
          } catch {
            return 'recovered';
          }
        })(),
      ),
    ).resolves.toBe('recovered');
    const order: number[] = [];
    expect(
      await mapContentIo([1, 2], function* (value: number): Generator<
        unknown,
        number,
        any
      > {
        yield Promise.resolve();
        order.push(value);
        return value * 2;
      }),
    ).toEqual([2, 4]);
    expect(order).toEqual([1, 2]);
  });
});
