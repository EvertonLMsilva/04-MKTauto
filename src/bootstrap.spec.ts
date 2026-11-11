import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from './infrastructure/administration/schema-provisioner.js';
import { bootstrap, validateConfiguration } from './bootstrap.js';

describe('official bootstrap', () => {
  it('requires an absolute existing schema 41 database and a valid TCP port', () => {
    expect(() => validateConfiguration({})).toThrow('PROJECT_API_DATABASE');
    expect(() =>
      validateConfiguration({ PROJECT_API_DATABASE: 'relative.sqlite' }),
    ).toThrow('PROJECT_API_DATABASE');
    expect(() =>
      validateConfiguration({
        PROJECT_API_DATABASE: join(tmpdir(), 'unused.sqlite'),
        PORT: 'abc',
      }),
    ).toThrow('PORT');
  });

  it('rejects schema 39 at startup without migrating it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mktauto-preflight-'));
    const path = join(directory, 'db.sqlite');
    const db = new DatabaseSync(path);
    try {
      provisionSchema(db, 39);
      expect(() =>
        validateConfiguration({ PROJECT_API_DATABASE: path }),
      ).toThrow('SCHEMA_41_REQUIRED');
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(39);
    } finally {
      db.close();
      rmSync(directory, { recursive: true });
    }
  });

  it('starts HTTP and releases the listener on shutdown without changing the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mktauto-start-'));
    const path = join(directory, 'db.sqlite');
    const db = new DatabaseSync(path);
    provisionSchema(db);
    const history = db.prepare('SELECT * FROM schema_migrations').all();
    db.close();
    const previous = process.env.PROJECT_API_DATABASE;
    process.env.PROJECT_API_DATABASE = path;
    let app: Awaited<ReturnType<typeof bootstrap>> | undefined;
    try {
      app = await bootstrap({ PROJECT_API_DATABASE: path, PORT: '0' });
      const url = await app.getUrl();
      expect((await fetch(url)).status).toBe(200);
      await app.close();
      await expect(fetch(url)).rejects.toThrow();
      const check = new DatabaseSync(path, { readOnly: true });
      try {
        expect(check.prepare('SELECT * FROM schema_migrations').all()).toEqual(
          history,
        );
      } finally {
        check.close();
      }
    } finally {
      await app?.close();
      if (previous === undefined) delete process.env.PROJECT_API_DATABASE;
      else process.env.PROJECT_API_DATABASE = previous;
      rmSync(directory, { recursive: true });
    }
  });
});
