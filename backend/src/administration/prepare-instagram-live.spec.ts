import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareInstagramLive } from './prepare-instagram-live.js';
import { provisionSchema } from './schema-provisioner.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

test('provisions a distinct immutable LIVE context without changing the source', () => {
  const folder = mkdtempSync(join(tmpdir(), 'mkt-live-'));
  folders.push(folder);
  const source = join(folder, 'source.sqlite');
  const target = join(folder, 'live.sqlite');
  const db = new DatabaseSync(source);
  provisionSchema(db);
  const before = db.prepare('SELECT * FROM social_publication_context').get();
  db.close();
  expect(() =>
    prepareInstagramLive({
      source,
      target,
      executionId: 'missing',
      packageHash: 'missing',
      accountId: '17841447654430033',
      renderHash: 'missing',
    }),
  ).toThrow();
  const original = new DatabaseSync(source, { readOnly: true });
  expect(
    original.prepare('SELECT * FROM social_publication_context').get(),
  ).toEqual(before);
  original.close();
  const live = new DatabaseSync(target);
  expect(
    live.prepare('SELECT execution_mode FROM social_publication_context').get(),
  ).toEqual({ execution_mode: 'live' });
  expect(() =>
    live
      .prepare("UPDATE social_publication_context SET execution_mode='fake'")
      .run(),
  ).toThrow('IMMUTABLE_SOCIAL_CONTEXT');
  expect(
    live
      .prepare('SELECT count(*) AS n FROM social_publication_operations')
      .get(),
  ).toEqual({ n: 0 });
  live.close();
});
