import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, expect } from 'vitest';

// Read-only legacy observations, captured with the original JS × TS assertions
// passing. No update/record mode: changes to production cannot refresh the oracle.
interface Entry {
  args: any[];
  result?: any;
  error?: { name: string; message: string; code?: string; field?: string };
  effects: { method: string; args: any[] }[];
  rows?: Record<string, SQLInputValue>[][];
}
const suites = ['project', 'research'].map(
  (name) =>
    JSON.parse(
      readFileSync(
        new URL('./frozen-' + name + '.json', import.meta.url),
        'utf8',
      ),
    ).records as Record<string, Record<string, Entry[]>>,
);
const records = Object.assign({}, ...suites) as Record<
  string,
  Record<string, Entry[]>
>;
const cursors = new Map<string, Record<string, number>>();
function clean(value: any): any {
  if (value === undefined) return { $undefined: true };
  if (typeof value === 'function') return '<function>';
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, key === 'store' ? '<store>' : clean(value[key])]),
    );
  return value;
}
function decode(value: any): any {
  if (value && typeof value === 'object') {
    if (value.$undefined === true && Object.keys(value).length === 1)
      return undefined;
    if (Array.isArray(value)) return value.map(decode);
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decode(item)]),
    );
  }
  return value;
}
// Each retained scenario must consume its entire independent reference, including
// error results. Dropping a call/assertion cannot silently reduce golden coverage.
afterEach(() => {
  const name = expect.getState().currentTestName!;
  const expected = records[name] ?? {};
  const consumed = cursors.get(name) ?? {};
  for (const [label, entries] of Object.entries(expected))
    expect(consumed[label] ?? 0, label).toBe(entries.length);
  cursors.delete(name);
});
export function reference(label: string, database?: DatabaseSync) {
  return (...args: any[]) => {
    const name = expect.getState().currentTestName!;
    const consumed = cursors.get(name) ?? {};
    cursors.set(name, consumed);
    const index = consumed[label] ?? 0;
    const entry = records[name]?.[label]?.[index];
    expect(entry, 'Missing frozen observation: ' + label).toBeDefined();
    consumed[label] = index + 1;
    expect(clean(args), label + ' input').toEqual(entry!.args);
    for (const effect of entry!.effects)
      args[0].store[effect.method](...decode(effect.args));
    if (database && entry!.rows) seedRows(database, entry!.rows);
    if (entry!.error) {
      const details = decode(entry!.error);
      throw Object.assign(new Error(details.message), details);
    }
    return decode(entry!.result);
  };
}
export function seedRows(
  db: DatabaseSync,
  tables: Record<string, SQLInputValue>[][],
) {
  // Independent raw SQL fixture, never a call into the new service/repository.
  // Append immutable evidence; verify existing snapshots/commands byte for byte.
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  try {
    for (const [index, table] of [
      'projects',
      'project_snapshots',
      'project_commands',
    ].entries()) {
      for (const row of tables[index]!) {
        const keys =
          table === 'projects'
            ? ['id']
            : table === 'project_snapshots'
              ? ['project_id', 'version']
              : ['idempotency_key'];
        const where = keys.map((key) => key + '=?').join(' AND ');
        const values = keys.map((key) => row[key]!);
        const existing = db
          .prepare('SELECT * FROM ' + table + ' WHERE ' + where)
          .get(...values);
        if (existing && table !== 'projects') {
          expect(existing).toEqual(row);
          continue;
        }
        if (existing) {
          const columns = Object.keys(row).filter((key) => !keys.includes(key));
          db.prepare(
            'UPDATE ' +
              table +
              ' SET ' +
              columns.map((key) => key + '=?').join(',') +
              ' WHERE ' +
              where,
          ).run(...columns.map((key) => row[key]!), ...values);
        } else {
          const columns = Object.keys(row);
          db.prepare(
            'INSERT INTO ' +
              table +
              ' (' +
              columns.join(',') +
              ') VALUES (' +
              columns.map(() => '?').join(',') +
              ')',
          ).run(...columns.map((key) => row[key]!));
        }
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
export class ReferenceProjectDatabase {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }
  close() {
    this.db.close();
  }
}
export class ReferenceProjectService {
  readonly createProject: (...args: any[]) => any;
  readonly createProjectVersion: (...args: any[]) => any;
  readonly archiveProject: (...args: any[]) => any;
  constructor(repository: ReferenceProjectDatabase) {
    this.createProject = reference('project.createProject', repository.db);
    this.createProjectVersion = reference(
      'project.createProjectVersion',
      repository.db,
    );
    this.archiveProject = reference('project.archiveProject', repository.db);
  }
}
export function referenceResearchStore(): any {
  return new Proxy(
    {},
    {
      get(_target, key) {
        return key === 'close'
          ? () => {}
          : reference('researchStore.' + String(key));
      },
    },
  );
}
