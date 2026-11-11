import { ResearchService } from './application/research.service.js';
import { analyzeTrendRun } from './application/trend-analysis.js';
import { TrendStoreError } from './domain/research.errors.js';

describe('Research I/O boundary', () => {
  it('preserves synchronous reads and closing for the default SQLite port', () => {
    const close = vi.fn();
    const value = { run: { id: 'sync' } };
    const service = new ResearchService({
      open: () => ({ getRun: () => value, close }),
    } as any);
    expect(service.get('getRun', 'sync')).toBe(value);
    expect(close).toHaveBeenCalledOnce();
  });

  it('awaits asynchronous open/read and closes after the read', async () => {
    const events: string[] = [];
    const service = new ResearchService<true>({
      async open() {
        events.push('open');
        return {
          async getRun() {
            await Promise.resolve();
            events.push('read');
            return { id: 'async' };
          },
          async close() {
            await Promise.resolve();
            events.push('close');
          },
        };
      },
    } as any);
    expect(await service.get('getRun', 'async')).toEqual({ id: 'async' });
    expect(events).toEqual(['open', 'read', 'close']);
  });

  it('keeps the async write and receipt inside atomic before closing', async () => {
    const events: string[] = [];
    const service = new ResearchService<true>({
      async open() {
        return {
          async atomic(operation: () => unknown) {
            events.push('begin');
            const result = await operation();
            events.push('commit');
            return result;
          },
          async recordOperation() {
            await Promise.resolve();
            events.push('write');
            return { id: 'result' };
          },
          async close() {
            events.push('close');
          },
        };
      },
    } as any);
    expect(await service.execute('recordOperation', {})).toEqual({
      id: 'result',
    });
    expect(events).toEqual(['begin', 'write', 'commit', 'close']);
  });

  it('preserves an asynchronous domain rejection and closes the handle once', async () => {
    const error = new TrendStoreError('RUN_NOT_FOUND', 'fixture');
    const close = vi.fn(async () => {
      throw new Error('CLOSE_FIXTURE_FAILURE');
    });
    const service = new ResearchService<true>({
      async open() {
        return {
          async getRun() {
            throw error;
          },
          close,
        };
      },
    } as any);
    await expect(service.get('getRun', 'missing')).rejects.toBe(error);
    expect(close).toHaveBeenCalledOnce();
  });

  it('awaits asynchronous analysis reads before checking run existence', async () => {
    const clusterer = vi.fn();
    await expect(
      analyzeTrendRun({
        store: {
          async getOperation() {
            return null;
          },
          async getRun() {
            return null;
          },
          async recordAnalysis() {},
        },
        runId: 'missing',
        idempotencyKey: 'async:missing',
        clusterer,
      }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    expect(clusterer).not.toHaveBeenCalled();
  });
});
