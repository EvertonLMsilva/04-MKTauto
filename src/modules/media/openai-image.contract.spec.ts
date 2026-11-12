import {
  OPENAI_IMAGE_PROFILE,
  imageRequestHash,
  validateImageRequest,
} from './domain/openai-image.contract.js';
import { mediaAcquisitionRequestHash } from './domain/media-acquisition-contracts.js';
function request() {
  const acquisitionRequest = {
    schemaVersion: 'media-acquisition-request/1.0.0',
    mediaAcquisitionRequestId: 'acquire_image_010',
    scriptId: 'script_001',
    scriptContentHash: 'a'.repeat(64),
    visualDirectionPosition: 1,
    assetType: 'IMAGE',
    requestedAt: '2026-11-12T00:00:00Z',
    contentHash: '',
  };
  acquisitionRequest.contentHash =
    mediaAcquisitionRequestHash(acquisitionRequest);
  const v: any = {
    schemaVersion: 'openai-image-request/1.0.0',
    operationId: 'image_010',
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    scriptId: 'script_001',
    scriptContentHash: 'a'.repeat(64),
    scriptRevision: 1,
    acquisitionRequest,
    operationType: 'GENERATE',
    prompt: 'Publicidade autorizada.',
    profile: OPENAI_IMAGE_PROFILE,
    references: [],
    requestHash: '',
  };
  v.requestHash = imageRequestHash(v);
  return v;
}
it('pins the approved snapshot/profile and canonicalizes identity without repairing content', () => {
  const v = request(),
    saved = validateImageRequest(v);
  expect(saved.profile.model).toBe('gpt-image-2.5-flare-2026-09-08');
  expect(Object.isFrozen(saved.profile)).toBe(true);
  expect(
    imageRequestHash(Object.fromEntries(Object.entries(v).reverse())),
  ).toBe(v.requestHash);
});
it.each([
  'extra',
  'force',
  'testMode',
  'hash',
  'model',
  'quality',
  'size',
  'format',
  'n',
  'operation',
  'acquisition',
  'script',
  'project',
  'prompt',
  'edit_without_reference',
  'generate_with_reference',
  'too_many_references',
  'url',
  'reference_hash',
  'reference_revision',
  'permission',
])('fails closed on %s', (kind) => {
  const v = request();
  const ref = {
    role: 'PRODUCT',
    artifactId: 'product_001',
    contentHash: 'b'.repeat(64),
    revision: 1,
    provenance: { evidenceId: 'right_001', sourceRef: 'fixture:product' },
    commercialPurpose: 'ADVERTISING',
    externalProcessing: { provider: 'openai', evidenceId: 'right_001' },
  };
  if (kind === 'extra') v.authorized = true;
  if (kind === 'force') v.force = true;
  if (kind === 'testMode') v.testMode = true;
  if (['model', 'quality', 'size', 'format', 'n'].includes(kind))
    v.profile = { ...v.profile, [kind]: kind === 'n' ? 2 : 'unsupported' };
  if (kind === 'operation') v.operationType = 'LIVE';
  if (kind === 'acquisition')
    v.acquisitionRequest = { ...v.acquisitionRequest, assetType: 'VIDEO' };
  if (kind === 'script') v.scriptId = 'script_other';
  if (kind === 'project') v.projectVersion = 0;
  if (kind === 'prompt') v.prompt = '';
  if (kind === 'edit_without_reference') v.operationType = 'EDIT';
  if (kind === 'generate_with_reference') v.references = [ref];
  if (
    [
      'too_many_references',
      'url',
      'reference_hash',
      'reference_revision',
      'permission',
    ].includes(kind)
  ) {
    v.operationType = 'EDIT';
    v.references = [structuredClone(ref)];
  }
  if (kind === 'too_many_references') v.references = [ref, ref, ref];
  if (kind === 'url')
    v.references[0].provenance.sourceRef = 'https://private.invalid/image.png';
  if (kind === 'reference_hash') v.references[0].contentHash = 'no hash';
  if (kind === 'reference_revision') v.references[0].revision = 0;
  if (kind === 'permission')
    v.references[0].externalProcessing = {
      provider: 'other',
      evidenceId: 'right_001',
    };
  v.requestHash = kind === 'hash' ? 'f'.repeat(64) : imageRequestHash(v);
  expect(() => validateImageRequest(v)).toThrow();
});
it('binds reference roles, revisions, rights evidence and exact source hashes into request identity', () => {
  const v = request();
  v.operationType = 'EDIT';
  v.references = [
    {
      role: 'PRODUCT',
      artifactId: 'product_001',
      contentHash: 'b'.repeat(64),
      revision: 2,
      provenance: { evidenceId: 'right_001', sourceRef: 'fixture:product' },
      commercialPurpose: 'ADVERTISING',
      externalProcessing: { provider: 'openai', evidenceId: 'right_001' },
    },
  ];
  v.requestHash = imageRequestHash(v);
  expect(validateImageRequest(v).references[0].revision).toBe(2);
  const other = structuredClone(v);
  other.references[0].revision = 3;
  expect(imageRequestHash(other)).not.toBe(v.requestHash);
});
