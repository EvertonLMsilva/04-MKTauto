import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { OpenAIImageService } from './application/openai-image.service.js';
import {
  OpenAIImageAdapter,
  parseImageResponse,
} from './infrastructure/openai-image.adapter.js';
import { OpenAIImagePersistence } from './infrastructure/openai-image.persistence.js';
import {
  LocalEvidenceStorage,
  digest,
} from './infrastructure/local-evidence-storage.js';
import {
  OPENAI_IMAGE_PROFILE,
  imageRequestHash,
  MAX_IMAGE_BYTES,
} from './domain/openai-image.contract.js';
import { mediaAcquisitionRequestHash } from './domain/media-acquisition-contracts.js';
import type {
  ImageFinanceAssessment,
  ImageFinancialOperations,
  ImageOperation,
  ImageSourceReaders,
  OfflineImageTransport,
  TrustedImageReference,
} from './application/image-generation.port.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const bytes: Buffer = png({ width: 864, height: 1536 });
const response = () => ({
  created: 1794441600,
  data: [{ b64_json: bytes.toString('base64') }],
  usage: {
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 30,
    input_tokens_details: { text_tokens: 10, image_tokens: 0 },
  },
});
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openai-image-offline-'));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw Error('NO_EXTERNAL_CALLS');
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith('openai-image-offline-')
  )
    throw Error('TEST_CLEANUP_SCOPE_INVALID');
  rmSync(root, { recursive: true, force: true });
});
function setup(edit = false) {
  const files = new LocalEvidenceStorage(root),
    persistence = new OpenAIImagePersistence(files);
  const acquisition: any = {
    schemaVersion: 'media-acquisition-request/1.0.0',
    mediaAcquisitionRequestId: 'acquire_image_010',
    scriptId: 'script_001',
    scriptContentHash: 'a'.repeat(64),
    visualDirectionPosition: 1,
    assetType: 'IMAGE',
    requestedAt: '2026-11-12T00:00:00Z',
    contentHash: '',
  };
  acquisition.contentHash = mediaAcquisitionRequestHash(acquisition);
  const refHash = files.put(png(), 'png');
  const ref: any = {
    role: 'PRODUCT',
    artifactId: 'product_001',
    contentHash: refHash,
    revision: 2,
    provenance: { evidenceId: 'right_001', sourceRef: 'fixture:product' },
    commercialPurpose: 'ADVERTISING',
    externalProcessing: { provider: 'openai', evidenceId: 'right_001' },
  };
  const trusted: TrustedImageReference = {
    ...ref,
    projectId: 'project_001',
    projectVersion: 1,
    mediaReference: 'media:product_001',
    rightsEvidence: [
      {
        id: 'right_001',
        kind: 'MEDIA_USAGE_RIGHT',
        sourceRef: 'fixture:product',
        recordedAt: '2026-11-12T00:00:00Z',
        mediaAuthorization: {
          mediaRef: 'media:product_001',
          contentHash: refHash,
          commercialUse: 'GRANTED',
          processing: 'GRANTED',
          localProcessing: true,
          externalProviders: ['openai'],
        },
      },
    ],
  };
  const input: any = {
    schemaVersion: 'openai-image-request/1.0.0',
    operationId: 'image_010',
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    scriptId: 'script_001',
    scriptContentHash: 'a'.repeat(64),
    scriptRevision: 1,
    acquisitionRequest: acquisition,
    operationType: edit ? 'EDIT' : 'GENERATE',
    prompt: 'Publicidade autorizada.',
    profile: OPENAI_IMAGE_PROFILE,
    references: edit ? [ref] : [],
    requestHash: '',
  };
  input.requestHash = imageRequestHash(input);
  const sources: ImageSourceReaders = {
    context: () => ({
      pipelineRunId: 'run_001',
      projectId: 'project_001',
      projectVersion: 1,
      scriptId: 'script_001',
      scriptContentHash: 'a'.repeat(64),
      scriptRevision: 1,
      visualDirectionPositions: [1],
      campaignId: null,
    }),
    reference: () => trusted,
  };
  const transport: OfflineImageTransport = {
    mode: 'FAKE_ONLY',
    operational: false,
    generate: vi.fn(async () => ({
      status: 200,
      body: response(),
      requestId: 'req_fixture',
    })),
    edit: vi.fn(async () => ({ status: 200, body: response() })),
  };
  const operations = new Map<string, ImageOperation>();
  const assessment: ImageFinanceAssessment = {
    status: 'READY_FOR_CONTROLLED_EXECUTION',
    scope: 'OFFLINE_TEST_ONLY',
    estimate: {
      requestHash: input.requestHash,
      amountUsd: '0.02',
      expiresAt: '2026-11-13T00:00:00Z',
    },
    budget: { currency: 'USD', maximumUsd: '0.10' },
    authorization: {
      requestHash: input.requestHash,
      principalId: 'operator_test',
      evidenceId: 'finance_fixture',
    },
    reservation: {
      requestHash: input.requestHash,
      reservationId: 'reservation_fixture',
      amountUsd: '0.03',
      mode: 'FAKE_ONLY',
    },
  };
  const finance: ImageFinancialOperations = {
    inspect: vi.fn(async () => assessment),
    find: async (id) => operations.get(id) ?? null,
    claim: async (r) => {
      let op = operations.get(r.operationId);
      const created = !op;
      if (!op) {
        op = {
          operationId: r.operationId,
          requestHash: r.requestHash,
          state: 'RESERVED',
          receiptHash: null,
        };
        operations.set(r.operationId, op);
      }
      return { created, operation: op };
    },
    dispatch: async (id) => {
      operations.get(id)!.state = 'SUBMITTING';
    },
    recordOfflineResult: async (id, _hash, receiptHash) => {
      Object.assign(operations.get(id)!, {
        state: 'COMPLETED_FAKE',
        receiptHash,
      });
    },
    unknown: async (id) => {
      if (operations.get(id)?.state === 'SUBMITTING')
        operations.get(id)!.state = 'UNKNOWN';
    },
  };
  const make = (
    funding: ImageFinancialOperations | undefined = finance,
    adapter = new OpenAIImageAdapter(transport, funding),
  ) =>
    new OpenAIImageService(
      adapter,
      persistence,
      sources,
      funding,
      () => '2026-11-12T00:00:00Z',
    );
  return {
    files,
    persistence,
    input,
    sources,
    trusted,
    transport,
    finance,
    assessment,
    operations,
    make,
  };
}
it('generates only FAKE_ONLY projection from validated physical bytes; no commercial MediaAsset', async () => {
  const f = setup();
  const result = await f.make().execute(f.input);
  expect(result.status).toBe('COMPLETED_FAKE');
  if (result.status !== 'COMPLETED_FAKE') return;
  expect(result.receipt).toMatchObject({
    mode: 'FAKE_ONLY',
    mediaAsset: null,
    registrationAllowed: false,
    commercialAuthorization: false,
    publicationAuthorized: false,
    financeStatus: 'UNKNOWN_COST',
    operationalRecovery: 'NOT_IMPLEMENTED',
    compatibility: {
      assetType: 'IMAGE',
      origin: 'PROVIDER_GENERATED',
      provider: 'openai',
    },
  });
  expect(result.receipt.request).toMatchObject({
    projectId: 'project_001',
    scriptId: 'script_001',
    pipelineRunId: 'run_001',
  });
  expect(result.receipt.resource.contentHash).toBe(digest(bytes));
  expect(f.transport.generate).toHaveBeenCalledTimes(1);
  expect(f.transport.edit).not.toHaveBeenCalled();
  expect(f.transport.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      model: OPENAI_IMAGE_PROFILE.model,
      n: 1,
      size: '864x1536',
      stream: false,
    }),
  );
});
it('edits with exact authorized reference bytes and preserves original hash/revision/provenance', async () => {
  const f = setup(true),
    before = f.files.read(f.trusted.contentHash, 'png');
  const result = await f.make().execute(f.input);
  expect(result.status).toBe('COMPLETED_FAKE');
  expect(f.transport.edit).toHaveBeenCalledWith(
    expect.objectContaining({
      images: [
        { image_url: 'data:image/png;base64,' + before.toString('base64') },
      ],
    }),
  );
  expect(f.transport.generate).not.toHaveBeenCalled();
  expect(f.files.read(f.trusted.contentHash, 'png')).toEqual(before);
  if (result.status === 'COMPLETED_FAKE')
    expect(result.receipt.request.references[0]).toMatchObject({
      revision: 2,
      provenance: f.trusted.provenance,
    });
});
it('blocks all sends with absent Finance', async () => {
  const f = setup();
  const service = new OpenAIImageService(
    new OpenAIImageAdapter(f.transport),
    f.persistence,
    f.sources,
  );
  expect(await service.readiness(f.input)).toBe('FINANCE_NOT_CONFIGURED');
  await expect(service.execute(f.input)).rejects.toThrow(
    'FINANCE_NOT_CONFIGURED',
  );
  expect(f.transport.generate).not.toHaveBeenCalled();
});
it.each([
  'COST_ESTIMATE_REQUIRED',
  'BUDGET_REQUIRED',
  'AUTHORIZATION_REQUIRED',
  'RESERVATION_REQUIRED',
  'UNKNOWN_COST',
] as const)('preserves closed Finance state %s', async (status) => {
  const f = setup();
  f.assessment.status = status;
  expect(await f.make().readiness(f.input)).toBe(status);
  await expect(f.make().execute(f.input)).rejects.toThrow(status);
  expect(f.transport.generate).not.toHaveBeenCalled();
});
it.each([
  'zero_estimate',
  'zero_budget',
  'self_authorized',
  'zero_reservation',
  'wrong_hash',
  'expired',
  'controlled_reservation',
])('rejects incomplete or simulated paid authority: %s', async (kind) => {
  const f = setup();
  if (kind === 'zero_estimate') f.assessment.estimate!.amountUsd = '0';
  if (kind === 'zero_budget') f.assessment.budget!.maximumUsd = '0';
  if (kind === 'self_authorized')
    f.assessment.authorization = { authorized: true } as any;
  if (kind === 'zero_reservation') f.assessment.reservation!.amountUsd = '0';
  if (kind === 'wrong_hash')
    f.assessment.estimate!.requestHash = 'f'.repeat(64);
  if (kind === 'expired')
    f.assessment.estimate!.expiresAt = '2025-01-01T00:00:00Z';
  if (kind === 'controlled_reservation')
    f.assessment.reservation!.mode = 'CONTROLLED' as any;
  expect(await f.make().readiness(f.input)).not.toBe(
    'READY_FOR_CONTROLLED_EXECUTION',
  );
  await expect(f.make().execute(f.input)).rejects.toThrow();
  expect(f.transport.generate).not.toHaveBeenCalled();
});
it('rejects a paid transport even with a complete fake Finance double', async () => {
  const f = setup();
  const paid = { ...f.transport, mode: 'LIVE', operational: true } as any;
  await expect(
    f.make(f.finance, new OpenAIImageAdapter(paid, f.finance)).execute(f.input),
  ).rejects.toThrow('LIVE_IMAGE_TRANSPORT_DISABLED');
  expect(f.transport.generate).not.toHaveBeenCalled();
});
it.each(['context', 'hash', 'revision', 'provenance', 'permission', 'missing'])(
  'rejects untrusted reference binding: %s',
  async (kind) => {
    const f = setup(true);
    if (kind === 'context') f.sources.context = () => null;
    if (kind === 'hash') f.trusted.contentHash = 'f'.repeat(64);
    if (kind === 'revision') f.trusted.revision = 3;
    if (kind === 'provenance') f.trusted.rightsEvidence = [];
    if (kind === 'permission')
      (
        f.trusted.rightsEvidence as any[]
      )[0].mediaAuthorization.externalProviders = [];
    if (kind === 'missing') f.sources.reference = () => null;
    expect(() => f.make().execute(f.input)).toThrow();
    expect(f.transport.edit).not.toHaveBeenCalled();
  },
);
it('supports an independently authorized canonical influencer reference without role substitution', async () => {
  const f = setup(true);
  f.input.references[0].role = 'INFLUENCER';
  f.trusted.role = 'INFLUENCER';
  f.input.requestHash = imageRequestHash(f.input);
  f.assessment.estimate!.requestHash = f.input.requestHash;
  f.assessment.authorization!.requestHash = f.input.requestHash;
  f.assessment.reservation!.requestHash = f.input.requestHash;
  expect((await f.make().execute(f.input)).status).toBe('COMPLETED_FAKE');
});
it('validates optional usage/trace and keeps unavailable cost UNKNOWN', () => {
  const parsed = parseImageResponse({
    created: 1,
    data: [{ b64_json: bytes.toString('base64') }],
  });
  expect(parsed.usage).toBeNull();
  expect(parsed.requestId).toBeNull();
  expect(
    parseImageResponse(response(), 'req_fixture').usage?.total_tokens,
  ).toBe(30);
});
it.each([
  'empty',
  'incomplete',
  'extra',
  'base64',
  'padding',
  'too_large',
  'not_png',
  'wrong_dimensions',
  'metadata',
  'usage',
  'trace',
])('rejects incompatible success response: %s', (kind) => {
  let body: any = response(),
    requestId: unknown = 'req_fixture';
  if (kind === 'empty') body = {};
  if (kind === 'incomplete') body.data = [];
  if (kind === 'extra') body.privateToken = 'fixture';
  if (kind === 'base64') body.data[0].b64_json = '@@@@';
  if (kind === 'padding') body.data[0].b64_json += '=';
  if (kind === 'too_large')
    body.data[0].b64_json = 'A'.repeat(4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 4);
  if (kind === 'not_png')
    body.data[0].b64_json = Buffer.from('not png').toString('base64');
  if (kind === 'wrong_dimensions')
    body.data[0].b64_json = png().toString('base64');
  if (kind === 'metadata') body.size = '1024x1024';
  if (kind === 'usage') body.usage.total_tokens = 1;
  if (kind === 'trace') requestId = 'Bearer never-print-this';
  expect(() => parseImageResponse(body, requestId)).toThrow(
    'IMAGE_RESPONSE_INVALID',
  );
});
it.each([400, 401, 403, 429, 500])(
  'sanitizes provider failure %s without retry or raw secret echo',
  async (status) => {
    const f = setup();
    vi.mocked(f.transport.generate).mockResolvedValue({
      status,
      body: {
        error: { message: 'Bearer never-print-this https://private.invalid' },
      },
    });
    const r = await f.make().execute(f.input);
    expect(r.status).toBe('UNKNOWN');
    expect(JSON.stringify(r)).not.toMatch(/Bearer|private.invalid/);
    expect(f.transport.generate).toHaveBeenCalledTimes(1);
    expect((await f.make().execute(f.input)).status).toBe('UNKNOWN');
    expect(f.transport.generate).toHaveBeenCalledTimes(1);
  },
);

it('blocks direct adapter dispatch without a Finance-owned SUBMITTING binding', async () => {
  const f = setup();
  await expect(
    new OpenAIImageAdapter(f.transport).execute(f.input, []),
  ).rejects.toThrow('FINANCE_NOT_CONFIGURED');
  await expect(
    new OpenAIImageAdapter(f.transport, f.finance).execute(f.input, []),
  ).rejects.toThrow('RESERVATION_REQUIRED');
  expect(f.transport.generate).not.toHaveBeenCalled();
});
it.each(['moderation_blocked', 'insufficient_quota'])(
  'parses %s with sanitized trace and no retry',
  async (code) => {
    const f = setup();
    vi.mocked(f.transport.generate).mockResolvedValue({
      status: code === 'insufficient_quota' ? 429 : 400,
      requestId: 'req_error_fixture',
      body: {
        error: {
          message: 'Bearer never-print-this',
          type: 'image_generation_user_error',
          code,
        },
      },
    });
    const r = await f.make().execute(f.input);
    expect(r).toMatchObject({
      status: 'UNKNOWN',
      requestId: 'req_error_fixture',
      retryAllowed: false,
      reason:
        code === 'insufficient_quota'
          ? 'IMAGE_QUOTA_EXCEEDED'
          : 'IMAGE_MODERATION_BLOCKED',
    });
    expect(JSON.stringify(r)).not.toContain('Bearer');
  },
);

it('rechecks processing rights after dispatch and stops before sending if they were revoked', async () => {
  const f = setup(true),
    dispatch = f.finance.dispatch.bind(f.finance);
  f.finance.dispatch = async (id, hash) => {
    await dispatch(id, hash);
    (
      f.trusted.rightsEvidence as any[]
    )[0].mediaAuthorization.externalProviders = [];
  };
  expect((await f.make().execute(f.input)).status).toBe('UNKNOWN');
  expect(f.transport.edit).not.toHaveBeenCalled();
});

it('requires the named provenance evidence itself to authorize the exact reference identity', () => {
  const f = setup(true),
    right = structuredClone((f.trusted.rightsEvidence as any[])[0]);
  f.trusted.rightsEvidence = [
    {
      ...right,
      mediaAuthorization: {
        ...right.mediaAuthorization,
        mediaRef: 'media:other_001',
        contentHash: 'f'.repeat(64),
      },
    },
    { ...right, id: 'right_other' },
  ];
  expect(() => f.make().execute(f.input)).toThrow(
    'IMAGE_REFERENCE_PROVENANCE_MISSING',
  );
  expect(f.transport.edit).not.toHaveBeenCalled();
});

it('binds product and canonical influencer independently, including both reference hashes in fixture lineage', async () => {
  const f = setup(true),
    hash = f.files.put(png({ color: 96 }), 'png');
  const ref = {
    ...structuredClone(f.input.references[0]),
    role: 'INFLUENCER',
    artifactId: 'influencer_001',
    revision: 3,
    contentHash: hash,
    provenance: {
      evidenceId: 'right_influencer',
      sourceRef: 'fixture:influencer',
    },
    externalProcessing: { provider: 'openai', evidenceId: 'right_influencer' },
  };
  const person = {
    ...ref,
    projectId: 'project_001',
    projectVersion: 1,
    mediaReference: 'media:influencer_001',
    rightsEvidence: [
      {
        id: 'right_influencer',
        kind: 'MEDIA_USAGE_RIGHT',
        sourceRef: 'fixture:influencer',
        recordedAt: '2026-11-12T00:00:00Z',
        mediaAuthorization: {
          mediaRef: 'media:influencer_001',
          contentHash: hash,
          commercialUse: 'GRANTED',
          processing: 'GRANTED',
          localProcessing: true,
          externalProviders: ['openai'],
        },
      },
    ],
  } as TrustedImageReference;
  f.sources.reference = (id) => (id === person.artifactId ? person : f.trusted);
  f.input.references.push(ref);
  f.input.requestHash = imageRequestHash(f.input);
  f.assessment.estimate!.requestHash = f.input.requestHash;
  f.assessment.authorization!.requestHash = f.input.requestHash;
  f.assessment.reservation!.requestHash = f.input.requestHash;
  const result = await f.make().execute(f.input);
  expect(result.status).toBe('COMPLETED_FAKE');
  if (result.status === 'COMPLETED_FAKE') {
    expect(result.receipt.lineage.inputs).toHaveLength(3);
    expect(result.receipt.lineage.inputs[2]).toMatchObject({
      inputId: person.artifactId,
      contentHash: hash,
    });
  }
});
