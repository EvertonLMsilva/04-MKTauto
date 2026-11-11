import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('a raiz contém a única aplicação NestJS, com dependências e comandos oficiais', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(existsSync(new URL('../backend/package.json', import.meta.url)), false);
  assert.equal(pkg.scripts.start, 'node --env-file-if-exists=.env dist/main.js');
  assert.equal(pkg.scripts.build, 'nest build');
  assert.equal(pkg.scripts['start:prod'], pkg.scripts.start);
  assert.equal(pkg.scripts['start:dev'], 'nest start --watch');
  assert.equal(pkg.scripts['db:provision'], 'node dist/infrastructure/administration/provision.js');
  assert.equal(pkg.scripts['start:legacy'], 'node --env-file-if-exists=.env scripts/operational-cli.mjs start:legacy');
  for (const key of ['build:nest', 'start:nest', 'test:nest', 'pretest']) assert.equal(pkg.scripts[key], undefined);
  for (const key of ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', 'reflect-metadata', 'rxjs', 'typescript', '@types/node']) {
    assert.equal(typeof (pkg.dependencies?.[key] ?? pkg.devDependencies?.[key]), 'string');
  }
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
});
