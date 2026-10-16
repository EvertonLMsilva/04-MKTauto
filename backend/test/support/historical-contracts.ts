import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, expect } from 'vitest';

interface Observation {
  scenario: string;
  name: string;
  inputHash: string;
  result?: unknown;
  error?: Record<string, unknown>;
  count: number;
}
// Fixed JS observations captured while the original JS × TS assertions passed.
// No recording mode or fallback to production code: unknown inputs fail closed.
const data = JSON.parse(
  readFileSync(
    new URL('./frozen-discovery-contracts.json', import.meta.url),
    'utf8',
  ),
) as { values: unknown[]; modules: Record<string, Observation[]> };

function encode(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) =>
      v instanceof Set
        ? { __set: [...v] }
        : v === undefined
          ? { __undefined: true }
          : v,
    ),
  );
}
function decode(value: unknown): any {
  if (!value || typeof value !== 'object') return value;
  if ('$ref' in value) {
    const index = value.$ref;
    if (typeof index !== 'number' || !Object.hasOwn(data.values, index))
      throw new Error('Invalid historical fixture reference');
    return decode(data.values[index]);
  }
  if ('__undefined' in value) return undefined;
  if (Array.isArray(value)) return value.map(decode);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, decode(child)]),
  );
}

export function historicalContracts(
  name: string,
): Record<string, (...args: any[]) => any> {
  const vectors = data.modules[name];
  if (!vectors) throw new Error(`Unknown historical contract: ${name}`);
  const counts = vectors.map(() => 0);
  afterEach(() => {
    const scenario = expect.getState().currentTestName ?? '';
    vectors.forEach((v, i) =>
      scenario.endsWith(v.scenario)
        ? expect(counts[i], `${name}.${v.name} scenario coverage`).toBe(v.count)
        : undefined,
    );
  });
  return Object.fromEntries(
    [...new Set(vectors.map((v) => v.name))].map((method) => [
      method,
      (...args: unknown[]) => {
        const input = createHash('sha256')
          .update(JSON.stringify(encode(args)))
          .digest('hex');
        const index = vectors.findIndex(
          (v) => v.name === method && v.inputHash === input,
        );
        if (index < 0)
          throw new Error(`Missing historical observation: ${name}.${method}`);
        counts[index]++;
        const observed = vectors[index];
        if (observed.error)
          throw Object.assign(
            new Error(String(decode(observed.error).message)),
            decode(observed.error),
          );
        return decode(observed.result);
      },
    ]),
  );
}
