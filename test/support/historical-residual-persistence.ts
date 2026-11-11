import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, expect } from 'vitest';

interface Entry {
  input: unknown;
  result?: unknown;
  error?: Record<string, unknown>;
  sql: { sql: string; exec?: boolean; args?: unknown }[];
}
interface History {
  constants: Record<string, unknown>;
  sql: Record<string, string>;
  records: Record<string, Record<string, Entry[]>>;
}
// Independent, immutable JS observations. Only fixed fixture SQL is replayed;
// production code and concurrent workers always execute their native NestJS code.
const packed = JSON.parse(
  readFileSync(
    new URL('./frozen-residual-persistence.json', import.meta.url),
    'utf8',
  ),
) as { values: unknown[]; data: unknown };
function expand(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if ('$ref' in value) {
    if (
      !Number.isInteger(value.$ref) ||
      !Object.hasOwn(packed.values, value.$ref)
    )
      throw new Error('Invalid historical persistence reference');
    return expand(packed.values[value.$ref]);
  }
  if (Array.isArray(value)) return value.map(expand);
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, expand(v)]),
  );
}
const history = expand(packed.data) as History;
const cursors = new Map<string, Record<string, number>>();
const usedModules = new Set<string>();
function encode(value: any): any {
  if (
    value instanceof DatabaseSync ||
    (value && typeof value === 'object' && 'db' in value)
  )
    return '<database>';
  if (typeof value === 'function') return '<function>';
  if (value === undefined) return { __undefined: true };
  if (typeof value === 'bigint') return { __bigint: String(value) };
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Set) return { __set: [...value].map(encode) };
  if (Array.isArray(value)) return value.map(encode);
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, encode(v)]),
  );
}
function decode(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if ('__undefined' in value) return undefined;
  if ('__bigint' in value) return BigInt(value.__bigint);
  if ('__set' in value) return new Set(value.__set.map(decode));
  if (Array.isArray(value)) return value.map(decode);
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, decode(v)]),
  );
}
function observe(label: string, args: unknown[], db?: DatabaseSync): any {
  const scenario = expect.getState().currentTestName ?? '';
  const consumed = cursors.get(scenario) ?? {};
  cursors.set(scenario, consumed);
  const index = consumed[label] ?? 0;
  const entry = history.records[scenario]?.[label]?.[index];
  expect(
    entry,
    `Missing historical observation: ${label} (${scenario}) #${index}`,
  ).toBeDefined();
  expect(encode(args), `${label} historical input`).toEqual(entry!.input);
  consumed[label] = index + 1;
  for (const op of entry!.sql) {
    if (!db) throw new Error(`Historical database required: ${label}`);
    const sql = history.sql[op.sql];
    if (!sql) throw new Error(`Missing historical SQL: ${op.sql}`);
    if (op.exec) db.exec(sql);
    else db.prepare(sql).run(...(decode(op.args) as SQLInputValue[]));
  }
  if (entry!.error) {
    const details = decode(entry!.error);
    throw Object.assign(new Error(details.message), details);
  }
  return decode(entry!.result);
}
afterEach(() => {
  const scenario = expect.getState().currentTestName ?? '';
  const consumed = cursors.get(scenario) ?? {};
  for (const [label, entries] of Object.entries(
    history.records[scenario] ?? {},
  ))
    if ([...usedModules].some((module) => label.startsWith(module + '.')))
      expect(consumed[label] ?? 0, `${label} historical coverage`).toBe(
        entries.length,
      );
});
export function historicalResidualPersistence(module: string): any {
  usedModules.add(module);
  const prefix = module + '.';
  const names = new Set<string>();
  for (const labels of Object.values(history.records))
    for (const label of Object.keys(labels))
      if (label.startsWith(prefix))
        names.add(label.slice(prefix.length).split('.')[0]!);
  const constants = Object.fromEntries(
    Object.entries(history.constants)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), decode(value)]),
  );
  if (!names.size && !Object.keys(constants).length)
    throw new Error(`Unknown historical persistence module: ${module}`);
  return {
    ...constants,
    ...Object.fromEntries(
      [...names].map((name) => {
        const label = prefix + name;
        if (!/^[A-Z]/.test(name))
          return [name, (...args: any[]) => observe(label, args, args[0]?.db)];
        return [
          name,
          class HistoricalReference {
            readonly db: DatabaseSync | undefined;
            constructor(...args: any[]) {
              const ownsDatabase = typeof args[0] === 'string';
              const db = ownsDatabase
                ? new DatabaseSync(args[0], {
                    readOnly: args[1]?.readOnly ?? false,
                  })
                : args[0]?.db;
              this.db = db;
              try {
                observe(label + '.new', [], db);
              } catch (error) {
                if (ownsDatabase) db?.close();
                throw error;
              }
              return new Proxy(this, {
                get(target, key) {
                  if (key === 'then') return undefined;
                  if (Reflect.has(target, key)) return Reflect.get(target, key);
                  return (...input: any[]) => {
                    const value = observe(label + '.' + String(key), input, db);
                    if (key === 'close' && ownsDatabase) db?.close();
                    return value;
                  };
                },
              });
            }
          },
        ];
      }),
    ),
  };
}
