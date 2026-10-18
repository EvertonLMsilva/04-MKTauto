import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalEvidenceStorage } from './infrastructure/local-evidence-storage.js';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'evidence-root-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
it('normalizes absolute separators and trailing separator without moving media', () => {
  const configured =
    process.platform === 'win32' ? root.replace(/\\/g, '/') + '/' : root + '/';
  const store = new LocalEvidenceStorage(configured);
  expect(store.root).toBe(resolve(root));
  const bytes = Buffer.from('isolated evidence');
  const hash = store.put(bytes, 'json');
  expect(store.read(hash, 'json')).toEqual(bytes);
});
it('still refuses relative roots', () => {
  expect(() => new LocalEvidenceStorage('outputs/media')).toThrow(
    'LOCAL_ROOT_INVALID',
  );
});
it('refuses a redirected root and redirected hash bucket', () => {
  const outside = join(root, 'outside'),
    safe = join(root, 'safe'),
    alias = join(root, 'alias');
  mkdirSync(outside);
  mkdirSync(safe);
  symlinkSync(
    outside,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  expect(() => new LocalEvidenceStorage(alias)).toThrow('LOCAL_ROOT_INVALID');
  const store = new LocalEvidenceStorage(safe);
  mkdirSync(join(safe, 'sha256'));
  symlinkSync(
    outside,
    join(safe, 'sha256', 'ab'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  expect(() => store.path('ab' + '0'.repeat(62), 'json')).toThrow(
    'LOCAL_REFERENCE_INVALID',
  );
});
it('preserves containment, extensions and hash verification', () => {
  const store = new LocalEvidenceStorage(root);
  expect(() => store.path('../escape', 'json')).toThrow(
    'LOCAL_REFERENCE_INVALID',
  );
  expect(() => store.path('a'.repeat(64), 'exe')).toThrow(
    'LOCAL_REFERENCE_INVALID',
  );
  const hash = store.put(Buffer.from('original'), 'json');
  writeFileSync(store.path(hash, 'json'), 'changed');
  expect(() => store.read(hash, 'json')).toThrow('LOCAL_FILE_HASH_MISMATCH');
});
