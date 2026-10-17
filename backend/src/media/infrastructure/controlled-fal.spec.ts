import {
  validateControlledQuote,
  singleSubmissionQueue,
  createFalControl,
} from './controlled-fal.js';
import { FAL_VIDEO_MODEL } from '../domain/fal-model.js';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { randomBytes, scryptSync, createHash } from 'node:crypto';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { operationalQcIdentity } from '../../publishing/application/local-qc-identity.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../../administration/schema-provisioner.js';
import { FinanceService } from '../../finance/application/finance.service.js';
import { FinanceSession } from '../../finance/infrastructure/finance.session.js';

beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('LIVE_NETWORK_FORBIDDEN');
    }),
  ),
);
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

// Synthetic financial guarantees only in isolated test databases, never operational evidence.
const quote = () => ({
  model: FAL_VIDEO_MODEL,
  unitPriceUsd: '0.04',
  maximumBillableSeconds: '5.7',
  additionalChargesUsd: '0',
  includesAllCharges: true,
  maximumEnforced: true,
  webpSupported: true,
  source: 'https://fal.ai/test-only-quote',
  evidenceReference: 'mock:enforced-ceiling',
  expiresAt: '2027-01-01T00:00:00Z',
});

describe('controlled fal operator and private plan gates', () => {
  let root: string, env: NodeJS.ProcessEnv, plan: any, principal: unknown;
  const input: any = {
    request: { contentHash: 'a'.repeat(64) },
    preparation: { contentHash: 'b'.repeat(64), pipelineRunId: 'run_001' },
  };
  const transport = () => ({
    submit: vi.fn(),
    status: vi.fn(),
    result: vi.fn(),
    download: vi.fn(),
  });
  const finance = {} as FinanceService; // These tests must fail or authorize before any financial mutation.
  const save = () =>
    writeFileSync(env.FAL_CONTROLLED_PLAN_FILE!, JSON.stringify(plan), {
      mode: 0o600,
    });
  const confirmation = () => ({
    confirmed: true,
    operationId: plan.operationId,
    requestHash: input.request.contentHash,
    preparationHash: input.preparation.contentHash,
    planHash: affiliateHash(plan),
    statement: 'Explicit simulated one-time confirmation',
  });
  beforeAll(async () => {
    root = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'fal-control-auth-')),
    );
    const secret = randomBytes(32).toString('base64url'),
      salt = randomBytes(16).toString('hex');
    const identityPath = join(root, 'identities.json');
    writeFileSync(
      identityPath,
      JSON.stringify({
        version: 1,
        identities: [
          {
            id: 'individual',
            salt,
            hash: scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
              N: 32768,
              r: 8,
              p: 1,
              maxmem: 67108864,
            }).toString('hex'),
            roles: ['QC_REVIEWER'],
            revoked: false,
          },
        ],
      }),
      { mode: 0o600 },
    );
    vi.stubEnv('QC_IDENTITIES_FILE', identityPath);
    principal = await operationalQcIdentity.authenticate(
      'Bearer individual.' + secret,
      '127.0.0.1',
    );
  });
  beforeEach(() => {
    vi.stubEnv('QC_IDENTITIES_FILE', join(root, 'identities.json'));
    const image = Buffer.from('RIFF0000WEBPsynthetic-test-input');
    const mediaRef = join(root, 'image.webp');
    writeFileSync(mediaRef, image);
    env = {
      FAL_CONTROLLED_PLAN_FILE: join(root, 'plan.json'),
      FAL_KEY: randomBytes(32).toString('hex'),
    };
    plan = {
      schemaVersion: 'controlled-fal-plan/1.0.0',
      enabled: true,
      operationId: 'p77_first_live_i2v',
      maximumUsd: '0.50',
      maxSubmissions: 1,
      imageHash: createHash('sha256').update(image).digest('hex'),
      mediaRef,
      quote: quote(),
      requestHash: input.request.contentHash,
      preparationHash: input.preparation.contentHash,
      authorizedReviewers: ['individual'],
      evidenceRef: 'operator_grant',
      sourceRef: 'test-only-source',
    };
    save();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it('keeps preparation and readiness free of network and Finance effects', async () => {
    const queue = transport(),
      control = createFalControl(env, finance, queue);
    const grant = await control.authorize(input, {
      principal,
      confirmation: confirmation(),
    });
    expect(grant.input.authorization.actorId).toBe('individual');
    expect(await grant.resolveImage(plan.mediaRef)).toMatchObject({
      contentHash: plan.imageHash,
      provenance: {
        evidenceRef: 'operator_grant',
        sourceRef: 'test-only-source',
      },
    });
    expect(queue.submit).not.toHaveBeenCalled();
    expect(control.readiness()).toMatchObject({
      operationId: plan.operationId,
      blockers: ['OPERATIONAL_CONFIRMATION_REQUIRED'],
    });
  });
  it.each([
    'disabled',
    'credential',
    'identity',
    'confirmation',
    'request',
    'hash',
    'price',
    'actor',
  ])('blocks incomplete %s before transport or reservation', async (mode) => {
    const queue = transport(),
      options: any = { principal, confirmation: confirmation() };
    if (mode === 'disabled') plan.enabled = false;
    if (mode === 'credential') delete env.FAL_KEY;
    if (mode === 'identity') options.principal = { id: 'individual' };
    if (mode === 'confirmation') options.confirmation = undefined;
    if (mode === 'request') plan.requestHash = 'c'.repeat(64);
    if (mode === 'hash') plan.imageHash = 'c'.repeat(64);
    if (mode === 'price') plan.quote.includesAllCharges = false;
    if (mode === 'actor') options.confirmation.actor = 'spoofed';
    save();
    if (options.confirmation)
      options.confirmation.planHash = affiliateHash(plan);
    await expect(
      createFalControl(env, finance, queue).authorize(input, options),
    ).rejects.toThrow();
    expect(queue.submit).not.toHaveBeenCalled();
  });
  it('rechecks private plan and exact file immediately before a paid POST', async () => {
    const queue = transport();
    const control = createFalControl(env, finance, queue);
    const grant = await control.authorize(input, {
      principal,
      confirmation: confirmation(),
    });
    plan.enabled = false;
    save();
    await expect(grant.queue.submit({})).rejects.toThrow(
      'CONTROLLED_FAL_PLAN_CHANGED',
    );
    plan.enabled = true;
    save();
    writeFileSync(plan.mediaRef, 'changed');
    await expect(grant.queue.submit({})).rejects.toThrow(
      'CONTROLLED_FAL_IMAGE_HASH_MISMATCH',
    );
    expect(queue.submit).not.toHaveBeenCalled();
  });
});
describe('controlled fal financial boundary', () => {
  it('requires an exact, unexpired, complete maximum including all charges', () => {
    expect(validateControlledQuote(quote(), '2026-10-17T00:00:00Z')).toEqual({
      amount: '0.228',
      currency: 'USD',
      source: 'mock:enforced-ceiling',
    });
    for (const change of [
      { maximumEnforced: false },
      { includesAllCharges: false },
      { webpSupported: false },
      { expiresAt: '2026-10-16T00:00:00Z' },
      { additionalChargesUsd: null },
      { model: { ...FAL_VIDEO_MODEL, resolution: '1080P' } },
      { maximumBillableSeconds: '5' },
      { source: 'https://example.com/price' },
    ]) {
      expect(() =>
        validateControlledQuote(
          { ...quote(), ...change },
          '2026-10-17T00:00:00Z',
        ),
      ).toThrow();
    }
    expect(() =>
      validateControlledQuote({ ...quote(), unitPriceUsd: '0.1' }),
    ).toThrow('CONTROLLED_FAL_BUDGET_EXCEEDED');
  });
  it.each(['success', 'timeout'] as const)(
    'persists one dispatch across concurrent calls and restart: %s',
    async (outcome) => {
      const dir = mkdtempSync(join(tmpdir(), 'controlled-fal-'));
      const f = {
        path: join(dir, 'test.sqlite'),
        close: () => rmSync(dir, { recursive: true, force: true }),
      };
      const db = new DatabaseSync(f.path);
      provisionSchema(db);
      db.close();
      const finance = () =>
        new FinanceService({ open: () => new FinanceSession(f.path) });
      const submit = vi.fn(async () => {
        if (outcome === 'timeout') throw new Error('uncertain network');
        return { requestId: 'simulated-request' };
      });
      const original = {
        submit,
        status: vi.fn(),
        result: vi.fn(),
        download: vi.fn(),
      };
      const proof = {
        kind: 'ENFORCED_MAXIMUM',
        includesAllCharges: true,
        currency: 'USD',
        maximumAmount: '0.228',
        evidenceReference: 'mock:enforced',
        expiresAt: '2027-01-01T00:00:00Z',
        requestHash: 'a'.repeat(64),
      };
      try {
        const first = singleSubmissionQueue(original, finance(), proof);
        const second = singleSubmissionQueue(original, finance(), proof);
        await Promise.allSettled([
          first.submit({ prompt: 'fixture' }),
          second.submit({ prompt: 'fixture' }),
        ]);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(finance().getGlobalOperation('p77_first_live_i2v')?.state).toBe(
          'UNKNOWN',
        );
        await expect(
          singleSubmissionQueue(original, finance(), proof).submit({
            prompt: 'fixture',
          }),
        ).rejects.toThrow();
        expect(submit).toHaveBeenCalledTimes(1);
        expect(
          finance().getGlobalOperation('p77_first_live_i2v')?.actual_usd,
        ).toBeNull();
      } finally {
        f.close();
      }
    },
  );
});
