import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('npm start executa NestJS compilado e mantém dependências isoladas no backend', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const backend = JSON.parse(readFileSync(new URL('../backend/package.json', import.meta.url)));
  assert.equal(pkg.scripts.start, 'node --env-file-if-exists=.env backend/dist/main.js');
  assert.equal(pkg.scripts.build, 'npm --prefix backend run build');
  assert.equal(backend.scripts.build, 'nest build');
  assert.equal(pkg.scripts['start:legacy'], 'node --env-file-if-exists=.env scripts/operational-cli.mjs start:legacy');
  for (const key of ['build:nest', 'start:nest', 'test:nest', 'pretest']) assert.equal(pkg.scripts[key], undefined);
  for (const key of ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', 'reflect-metadata', 'rxjs', 'typescript', '@types/node']) {
    assert.equal(pkg.dependencies?.[key] ?? pkg.devDependencies?.[key], undefined);
    assert.equal(typeof (backend.dependencies?.[key] ?? backend.devDependencies?.[key]), 'string');
  }
});
