import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function withTemporarySqlite(prefix, callback) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const resources = new Set();
  const open = (Constructor, ...args) => {
    const resource = new Constructor(...args);
    const close = resource.close.bind(resource);
    resource.close = () => {
      close();
      resources.delete(resource);
    };
    resources.add(resource);
    return resource;
  };
  try {
    return callback(join(directory, 'catalog.sqlite'), open);
  } finally {
    const errors = [];
    for (const resource of [...resources].reverse()) {
      try { resource.close(); } catch (error) { errors.push(error); }
    }
    try { rmSync(directory, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'SQLite fixture cleanup failed');
  }
}
