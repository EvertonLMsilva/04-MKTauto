import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  LocalEvidenceStorage,
  digest,
  documentBytes,
} from './infrastructure/local-evidence-storage.js';
import { OpenAIImagePersistence } from './infrastructure/openai-image.persistence.js';
import { parseImageResponse } from './infrastructure/openai-image.adapter.js';
import {
  OPENAI_IMAGE_PROFILE,
  imageRequestHash,
} from './domain/openai-image.contract.js';
import { mediaAcquisitionRequestHash } from './domain/media-acquisition-contracts.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
let root: string;
beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'openai-image-cas-'))));
afterEach(() => {
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith('openai-image-cas-')
  )
    throw Error('TEST_CLEANUP_SCOPE_INVALID');
  rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const a: any = {
    schemaVersion: 'media-acquisition-request/1.0.0',
    mediaAcquisitionRequestId: 'acquire_001',
    scriptId: 'script_001',
    scriptContentHash: 'a'.repeat(64),
    visualDirectionPosition: 1,
    assetType: 'IMAGE',
    requestedAt: '2026-11-12T00:00:00Z',
    contentHash: '',
  };
  a.contentHash = mediaAcquisitionRequestHash(a);
  const request: any = {
    schemaVersion: 'openai-image-request/1.0.0',
    operationId: 'image_001',
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    scriptId: 'script_001',
    scriptContentHash: 'a'.repeat(64),
    scriptRevision: 1,
    acquisitionRequest: a,
    operationType: 'GENERATE',
    prompt: 'Publicidade.',
    profile: OPENAI_IMAGE_PROFILE,
    references: [],
    requestHash: '',
  };
  request.requestHash = imageRequestHash(request);
  const bytes = png({ width: 864, height: 1536 }),
    output = parseImageResponse({
      created: 1,
      data: [{ b64_json: bytes.toString('base64') }],
    });
  const files = new LocalEvidenceStorage(root);
  return { request, output, files, store: new OpenAIImagePersistence(files) };
}
it('persists only physical fixture PNG and immutable FAKE receipt; replay survives new storage objects', () => {
  const f = fixture(),
    first = f.store.save(f.request, f.output),
    path = f.files.path(first.receipt.resource.contentHash, 'png');
  const before = digest(readFileSync(path));
  expect(f.store.save(f.request, f.output)).toEqual(first);
  expect(
    new OpenAIImagePersistence(new LocalEvidenceStorage(root)).load(
      f.request,
      first.receiptHash,
    ),
  ).toEqual(first);
  expect(digest(readFileSync(path))).toBe(before);
  expect(first.receipt.mediaAsset).toBeNull();
  expect(Object.isFrozen(first.receipt)).toBe(true);
  expect(Object.isFrozen(first.receipt.request.profile)).toBe(true);
  expect(first.receipt.registrationAllowed).toBe(false);
  expect(first.receipt.lineage).toMatchObject({
    artifactType: 'openai_image_fixture',
    pipelineRunId: f.request.pipelineRunId,
    contentHash: f.output.contentHash,
    generationMetadata: { provider: 'offline_fixture' },
  });
  expect(first.receipt.lineage.inputs).toEqual([
    {
      position: 1,
      kind: 'INTERNAL_ARTIFACT',
      inputId: f.request.scriptId,
      contentHash: f.request.scriptContentHash,
    },
  ]);
});
it.each(['png', 'receipt'])(
  'rejects tampered CAS %s without replacing it',
  (kind) => {
    const f = fixture(),
      r = f.store.save(f.request, f.output),
      path = f.files.path(
        kind === 'png' ? r.receipt.resource.contentHash : r.receiptHash,
        kind === 'png' ? 'png' : 'json',
      );
    writeFileSync(path, 'tampered');
    expect(() => f.store.load(f.request, r.receiptHash)).toThrow();
    if (kind === 'png')
      expect(() => f.store.save(f.request, f.output)).toThrow(
        'LOCAL_FILE_HASH_MISMATCH',
      );
    expect(readFileSync(path, 'utf8')).toBe('tampered');
  },
);
it('fails closed on missing output and forged cross-operation receipt binding', () => {
  const f = fixture(),
    r = f.store.save(f.request, f.output);
  const other = { ...f.request, operationId: 'other_operation' };
  other.requestHash = imageRequestHash(other);
  expect(() => f.store.load(other, r.receiptHash)).toThrow(
    'IMAGE_RECEIPT_INVALID',
  );
  rmSync(f.files.path(r.receipt.resource.contentHash, 'png'));
  expect(() => f.store.load(f.request, r.receiptHash)).toThrow();
});
it('rejects altered fake-only boundaries even when JSON has a valid new CAS hash', () => {
  const f = fixture(),
    r = f.store.save(f.request, f.output);
  const poisoned = { ...r.receipt, commercialAuthorization: true };
  const hash = f.files.put(documentBytes(poisoned), 'json');
  expect(() => f.store.load(f.request, hash)).toThrow('IMAGE_RECEIPT_INVALID');
});
it('fails after CAS output creation without claiming a committed operational receipt', () => {
  const f = fixture(),
    put = f.files.put.bind(f.files);
  vi.spyOn(f.files, 'put').mockImplementation((bytes, ext) => {
    if (ext === 'json') throw Error('TEST_WRITE_FAILURE');
    return put(bytes, ext);
  });
  expect(() => f.store.save(f.request, f.output)).toThrow('TEST_WRITE_FAILURE');
  expect(f.files.read(f.output.contentHash, 'png')).toEqual(f.output.bytes);
  // An orphan PNG cannot supply the Finance-owned operation -> receipt pointer.
  expect(() => f.store.load(f.request, 'f'.repeat(64))).toThrow();
});
