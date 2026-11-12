import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { OpenAIImageService } from './application/openai-image.service.js';
import { OpenAIImageAdapter } from './infrastructure/openai-image.adapter.js';
import { OpenAIImagePersistence } from './infrastructure/openai-image.persistence.js';
import { LocalEvidenceStorage } from './infrastructure/local-evidence-storage.js';
import {
  OPENAI_IMAGE_PROFILE,
  imageRequestHash,
} from './domain/openai-image.contract.js';
import { mediaAcquisitionRequestHash } from './domain/media-acquisition-contracts.js';
import type {
  ImageFinancialOperations,
  ImageOperation,
  OfflineImageTransport,
} from './application/image-generation.port.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openai-image-recovery-'));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw Error('NO_NETWORK');
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith('openai-image-recovery-')
  )
    throw Error('TEST_CLEANUP_SCOPE_INVALID');
  rmSync(root, { recursive: true, force: true });
});
function setup() {
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
  const input: any = {
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
  input.requestHash = imageRequestHash(input);
  const operations = new Map<string, ImageOperation>();
  const finance: ImageFinancialOperations = {
    inspect: async (r) => ({
      status: 'READY_FOR_CONTROLLED_EXECUTION',
      scope: 'OFFLINE_TEST_ONLY',
      estimate: {
        requestHash: r.requestHash,
        amountUsd: '0.02',
        expiresAt: '2026-11-13T00:00:00Z',
      },
      budget: { currency: 'USD', maximumUsd: '0.10' },
      authorization: {
        requestHash: r.requestHash,
        principalId: 'operator_test',
        evidenceId: 'finance_fixture',
      },
      reservation: {
        requestHash: r.requestHash,
        reservationId: 'reservation_fixture',
        amountUsd: '0.03',
        mode: 'FAKE_ONLY',
      },
    }),
    find: async (id) => operations.get(id) ?? null,
    claim: async (r) => {
      const prior = operations.get(r.operationId);
      if (prior) return { created: false, operation: prior };
      const operation: ImageOperation = {
        operationId: r.operationId,
        requestHash: r.requestHash,
        state: 'RESERVED',
        receiptHash: null,
      };
      operations.set(r.operationId, operation);
      return { created: true, operation };
    },
    dispatch: async (id) => {
      const op = operations.get(id)!;
      if (op.state !== 'RESERVED') throw Error('DUPLICATE_DISPATCH');
      op.state = 'SUBMITTING';
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
  const reply = {
      status: 200,
      body: {
        created: 1,
        data: [
          { b64_json: png({ width: 864, height: 1536 }).toString('base64') },
        ],
      },
    },
    send = vi.fn(async () => reply);
  const transport: OfflineImageTransport = {
    mode: 'FAKE_ONLY',
    operational: false,
    generate: send,
    edit: send,
  };
  const persistence = new OpenAIImagePersistence(
    new LocalEvidenceStorage(root),
  );
  const make = (f = finance, p = persistence) =>
    new OpenAIImageService(
      new OpenAIImageAdapter(transport, f),
      p,
      {
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
        reference: () => null,
      },
      f,
      () => '2026-11-12T00:00:00Z',
    );
  return { input, finance, operations, send, reply, persistence, make };
}
it('replays exact identity/result and simulates restart using shared Finance double + physical CAS', async () => {
  const f = setup(),
    first = await f.make().execute(f.input);
  expect(await f.make().execute(f.input)).toEqual(first);
  expect(
    await f
      .make(
        f.finance,
        new OpenAIImagePersistence(new LocalEvidenceStorage(root)),
      )
      .recover(f.input),
  ).toEqual(first);
  expect(f.send).toHaveBeenCalledTimes(1);
  if (first.status === 'COMPLETED_FAKE')
    expect(first.receipt.operationalRecovery).toBe('NOT_IMPLEMENTED');
});
it('rejects changed request hash with the same operation identity', async () => {
  const f = setup();
  await f.make().execute(f.input);
  const changed = { ...f.input, prompt: 'Outra publicidade.' };
  changed.requestHash = imageRequestHash(changed);
  await expect(f.make().execute(changed)).rejects.toThrow(
    'IMAGE_OPERATION_ID_REUSED',
  );
  expect(f.send).toHaveBeenCalledTimes(1);
});
it.each([
  'absent',
  'timeout_before_bytes',
  'timeout_after_submit',
  'invalid_response',
])('keeps %s UNKNOWN without automatic retry', async (kind) => {
  const f = setup();
  if (kind === 'absent') f.send.mockResolvedValue(undefined as any);
  if (kind.startsWith('timeout'))
    f.send.mockRejectedValue(
      Object.assign(new Error('Bearer never-print-this'), {
        name: 'TimeoutError',
        stage: kind,
      }),
    );
  if (kind === 'invalid_response') f.reply.body.data = [];
  const first = await f.make().execute(f.input);
  expect(first).toMatchObject({ status: 'UNKNOWN', retryAllowed: false });
  expect(f.operations.get(f.input.operationId)?.state).toBe('UNKNOWN');
  expect((await f.make().execute(f.input)).status).toBe('UNKNOWN');
  expect((await f.make().recover(f.input)).status).toBe('UNKNOWN');
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(first)).not.toContain('Bearer');
});
it.each(['cas_write', 'financial_receipt_write'])(
  'keeps %s failure reserved for reconciliation',
  async (kind) => {
    const f = setup();
    if (kind === 'cas_write')
      vi.spyOn(f.persistence, 'save').mockImplementation(() => {
        throw Error('DISK_FULL');
      });
    else
      vi.spyOn(f.finance, 'recordOfflineResult').mockRejectedValue(
        Error('COMMIT_UNKNOWN'),
      );
    expect((await f.make().execute(f.input)).status).toBe('UNKNOWN');
    expect((await f.make().execute(f.input)).status).toBe('UNKNOWN');
    expect(f.send).toHaveBeenCalledTimes(1);
  },
);
it('never reconstructs an operation journal or guesses a receipt when Finance state is lost', async () => {
  const f = setup();
  await f.make().execute(f.input);
  f.operations.clear();
  expect(await f.make().recover(f.input)).toMatchObject({
    status: 'UNKNOWN',
    reason: 'IMAGE_OPERATION_NOT_FOUND',
    retryAllowed: false,
  });
  expect(f.send).toHaveBeenCalledTimes(1);
});
it('requires a verifiable receipt for a claimed completed operation', async () => {
  const f = setup();
  await f.make().execute(f.input);
  f.operations.get(f.input.operationId)!.receiptHash = 'f'.repeat(64);
  expect(await f.make().recover(f.input)).toMatchObject({
    status: 'UNKNOWN',
    reason: 'IMAGE_RECEIPT_UNVERIFIED',
  });
  expect(f.send).toHaveBeenCalledTimes(1);
});
it('serializes same-service concurrency and refuses conflicting in-flight identity', async () => {
  const f = setup();
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  f.send.mockImplementation(async () => {
    await wait;
    return f.reply;
  });
  const service = f.make(),
    a = service.execute(f.input),
    b = service.execute(f.input);
  const changed = { ...f.input, prompt: 'Changed.' };
  changed.requestHash = imageRequestHash(changed);
  expect(() => service.execute(changed)).toThrow('IMAGE_OPERATION_ID_REUSED');
  release();
  expect(await a).toEqual(await b);
  expect(f.send).toHaveBeenCalledTimes(1);
});
it('shares the Finance claim boundary across independent service instances', async () => {
  const f = setup();
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  f.send.mockImplementation(async () => {
    entered();
    await wait;
    return f.reply;
  });
  const a = f.make().execute(f.input);
  await started;
  expect((await f.make().execute(f.input)).status).toBe('UNKNOWN');
  release();
  expect((await a).status).toBe('COMPLETED_FAKE');
  expect(f.send).toHaveBeenCalledTimes(1);
});
