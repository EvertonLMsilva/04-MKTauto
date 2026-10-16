import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, expect } from 'vitest';

interface Observation {
  name: string;
  scenario: string;
  inputHash: string;
  result?: unknown;
  error?: Record<string, unknown>;
  count: number;
}
interface HistoricalModule {
  constants: Record<string, unknown>;
  observations: Observation[];
}
// Fixed observations from passing JS × NestJS tests. No runtime JS imports,
// recording mode, or fallback to the implementation under test.
const data = JSON.parse(
  readFileSync(
    new URL('./frozen-residual-contracts.json', import.meta.url),
    'utf8',
  ),
) as { modules: Record<string, HistoricalModule> };
const counts = new Map<Observation, number>();
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
function decode(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if ('__undefined' in value) return undefined;
  if ('__set' in value) return new Set(value.__set.map(decode));
  if (Array.isArray(value)) return value.map(decode);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, decode(v)]),
  );
}
afterEach(() => {
  const scenario = expect.getState().currentTestName ?? '';
  for (const [module, vectors] of Object.entries(data.modules))
    for (const vector of vectors.observations)
      if (vector.scenario === scenario)
        expect(
          counts.get(vector) ?? 0,
          `${module}.${vector.name} historical coverage`,
        ).toBe(vector.count);
});
export function historicalResidualContracts(module: string): any {
  const vectors = data.modules[module];
  if (!vectors) throw new Error(`Unknown historical module: ${module}`);
  return {
    ...decode(vectors.constants),
    ...Object.fromEntries(
      [...new Set(vectors.observations.map((v) => v.name))].map((name) => [
        name,
        (...args: unknown[]) => {
          const inputHash = createHash('sha256')
            .update(JSON.stringify(encode(args)))
            .digest('hex');
          const scenario = expect.getState().currentTestName ?? '';
          const vector = vectors.observations.find(
            (v) =>
              v.name === name &&
              v.inputHash === inputHash &&
              v.scenario === scenario,
          );
          if (!vector)
            throw new Error(
              `Missing historical observation: ${module}.${name} (${scenario})`,
            );
          counts.set(vector, (counts.get(vector) ?? 0) + 1);
          if (vector.error) {
            const details = decode(vector.error);
            throw Object.assign(new Error(details.message), details);
          }
          return decode(vector.result);
        },
      ]),
    ),
  };
}
