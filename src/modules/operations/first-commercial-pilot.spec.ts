import { FirstCommercialPilotService } from './first-commercial-pilot.service.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  linkSync,
} from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const { inspectPilot } = await import(
  new URL(
    '../../../scripts/ops-local/first-commercial-pilot.mjs',
    import.meta.url,
  ).href
);

const hash = 'a'.repeat(64);
function fixture() {
  const event = (sequence: number, step: string, result: unknown) => ({
    sequence,
    event_type: 'STEP_DONE',
    occurred_at: '2026-11-12T00:00:00.000Z',
    evidence: { step, result },
  });
  const campaigns = {
    get: vi.fn(() => ({
      execution_id: 'exec_001',
      run_id: 'run_001',
      campaign_id: 'camp_001',
      campaign_revision: 1,
      status: 'WAITING_INPUT',
    })),
    history: vi.fn(() => [
      event(1, 'CONTEXT', { projectId: 'project_001', projectVersion: 1 }),
      event(2, 'EDITORIAL', {
        script: { scriptId: 'script_001', contentHash: hash },
      }),
      event(3, 'AUDIO', {
        voiceTrackId: 'voice_001',
        voiceTrackContentHash: hash,
      }),
      event(4, 'BURN', {
        videoRenderId: 'render_001',
        revision: 2,
        contentHash: hash,
      }),
    ]),
    tick: vi.fn(),
    resume: vi.fn(),
    approve: vi.fn(),
    schedule: vi.fn(),
  };
  const affiliate = {
    getCampaign: vi.fn(async () => ({
      productId: 'prod_001',
      productRevision: 1,
    })),
  };
  const media = {
    getVideoRender: vi.fn(() => ({
      pipelineRunId: 'run_001',
      videoRenderId: 'render_001',
      revision: 2,
      contentHash: hash,
      logicalReference: `render:sha256_${hash}`,
    })),
    verifyMedia: vi.fn(() => hash),
  };
  const local = {
    qcHandoffEvidence: vi.fn(() => ({
      report: { result: 'PASS', approvalBlocked: false },
    })),
    compose: vi.fn(),
    automaticAudio: vi.fn(),
  };
  const publishing = {
    package: vi.fn(() => ({
      campaignId: 'camp_001',
      campaignRevision: 1,
      identity: {
        pipelineRunId: 'run_001',
        videoRenderId: 'render_001',
        videoRenderContentHash: hash,
      },
    })),
    manualReadiness: vi.fn(() => ({ status: 'APPROVAL_REQUIRED' })),
    packageReview: vi.fn(() => null),
    publications: vi.fn(() => []),
    review: vi.fn(),
    recordPublication: vi.fn(),
  };
  const finance = {
    getPilotCostClosure: vi.fn(() => ({
      financiallyClosed: false,
      totalRunCost: null,
      closureStatus: 'COVERAGE_UNVERIFIED',
    })),
  };
  const preflight = {
    inspect: vi.fn(async () => ({ finance: { status: 'READY' } })),
  };
  const service = new FirstCommercialPilotService(
    campaigns as any,
    affiliate as any,
    media as any,
    local as any,
    publishing as any,
    finance as any,
    preflight as any,
  );
  return {
    service,
    campaigns,
    affiliate,
    media,
    local,
    publishing,
    finance,
    preflight,
  };
}

describe('first pilot read projection, not commercial acceptance', () => {
  it('preserves identities, unknown costs and pending approval without mutating a workflow', async () => {
    const f = fixture();
    const r = await f.service.inspect({
      executionId: 'exec_001',
      packageHash: hash,
    });
    expect(r.project).toEqual({ id: 'project_001', revision: 1 });
    expect(r.product).toEqual({ id: 'prod_001', revision: 1 });
    expect(r.physicalMedia).toBe('VERIFIED');
    expect(r.qc).toBe('PASS');
    expect(r.package?.approval).toBe('PENDING');
    expect(r.blockers).toContain('COST_COVERAGE_UNVERIFIED');
    expect(r.finance.costs).toMatchObject({
      totalRunCost: null,
      financiallyClosed: false,
    });
    expect(r.commercialAcceptance).toBe('NOT_ASSESSED');
    expect(r.publicationAuthorized).toBe(false);
    for (const method of [
      f.campaigns.tick,
      f.campaigns.schedule,
      f.campaigns.resume,
      f.campaigns.approve,
      f.local.compose,
      f.local.automaticAudio,
      f.publishing.review,
      f.publishing.recordPublication,
    ])
      expect(method).not.toHaveBeenCalled();
  });
  it('rejects a package from another run before reading its review or publications', async () => {
    const f = fixture();
    f.publishing.package.mockReturnValue({
      ...f.publishing.package(),
      identity: {
        pipelineRunId: 'other_run',
        videoRenderId: 'render_001',
        videoRenderContentHash: hash,
      },
    });
    await expect(
      f.service.inspect({ executionId: 'exec_001', packageHash: hash }),
    ).rejects.toMatchObject({ code: 'PILOT_PACKAGE_SCOPE_MISMATCH' });
    expect(f.publishing.publications).not.toHaveBeenCalled();
  });
  it('fails closed when bytes change and does not leak a private path from verification errors', async () => {
    const f = fixture();
    f.media.verifyMedia.mockImplementation(() => {
      throw Error('private-secret-path');
    });
    const r = await f.service.inspect({ executionId: 'exec_001' });
    expect(r.physicalMedia).toBe('INVALID');
    expect(r.qc).toBe('INVALID');
    expect(r.blockers).toContain('PILOT_PHYSICAL_EVIDENCE_INVALID');
    expect(JSON.stringify(r)).not.toContain('private-secret-path');
  });
  it('keeps unavailable Finance unknown without assuming zero cost', async () => {
    const f = fixture();
    f.finance.getPilotCostClosure.mockImplementation(() => {
      throw Error('unavailable');
    });
    const r = await f.service.inspect({ executionId: 'exec_001' });
    expect(r.finance.costs).toEqual({
      status: 'UNKNOWN',
      amount: null,
      reason: 'FINANCE_COSTS_UNAVAILABLE',
    });
    expect(r.blockers).toContain('FINANCE_COSTS_UNAVAILABLE');
  });
  it('rejects invalid identifiers and hashes before persistence access', async () => {
    const f = fixture();
    await expect(
      f.service.inspect({ executionId: '../live' }),
    ).rejects.toThrow();
    await expect(
      f.service.inspect({ executionId: 'exec_001', packageHash: 'invalid' }),
    ).rejects.toThrow();
    expect(f.campaigns.get).not.toHaveBeenCalled();
  });
  it('prioritizes the current functional pause over unresolved cost coverage', async () => {
    const f = fixture();
    const history = f.campaigns.history();
    f.campaigns.history.mockReturnValue([
      ...history,
      {
        sequence: 5,
        event_type: 'PAUSED',
        occurred_at: '2026-11-12T00:00:00.000Z',
        evidence: { step: 'AUDIO', code: 'AUDIO_REQUIRED' },
      } as any,
    ]);
    const r = await f.service.inspect({ executionId: 'exec_001' });
    expect(r.currentStep).toBe('AUDIO');
    expect(r.nextAction).toBe('AUDIO_REQUIRED');
    expect(r.blockers).toContain('COST_COVERAGE_UNVERIFIED');
  });
});

describe('disposable-only smoke guards', () => {
  let root: string;
  let config: Record<string, unknown>;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'first-pilot-guard-'));
    for (const name of ['data', 'media', 'voice', 'render', 'evidence', 'tmp'])
      mkdirSync(join(root, name));
    const db = new DatabaseSync(join(root, 'data', 'pilot.sqlite'));
    db.exec('CREATE TABLE fixture (id TEXT PRIMARY KEY)');
    db.close();
    config = {
      schemaVersion: 'first-commercial-pilot-local/1.0.0',
      classification: 'FICTITIOUS_TEST_ONLY',
      provider: 'fake',
      root,
      executionId: 'exec_001',
    };
  });
  afterEach(() => {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith('first-pilot-guard-')
    )
      throw Error('TEST_CLEANUP_BOUNDARY_INVALID');
    rmSync(root, { recursive: true, force: true });
  });
  const configure = () => {
    writeFileSync(join(root, 'config.json'), JSON.stringify(config));
    return ['--verify', '--config', join(root, 'config.json')];
  };
  it('rejects missing explicit mode and configuration', async () => {
    await expect(inspectPilot([])).rejects.toThrow('PILOT_USAGE_REQUIRED');
  });
  it('rejects operational data classification before opening services', async () => {
    config.classification = 'LIVE';
    const inspect = vi.fn();
    await expect(inspectPilot(configure(), inspect)).rejects.toThrow(
      'PILOT_DISPOSABLE_FIXTURE_REQUIRED',
    );
    expect(inspect).not.toHaveBeenCalled();
  });
  it('requires a marker bound to the exact database bytes', async () => {
    writeFileSync(
      join(root, 'FICTITIOUS_TEST_ONLY.json'),
      JSON.stringify({
        purpose: 'MKTAUTO-RELEASE-FIRST-COMMERCIAL-PILOT-001',
        classification: 'FICTITIOUS_TEST_ONLY',
        databaseSha256: '0'.repeat(64),
      }),
    );
    await expect(inspectPilot(configure())).rejects.toThrow(
      'PILOT_DISPOSABLE_IDENTITY_MISMATCH',
    );
  });
  it('rejects invalid scope even with a correct disposable marker', async () => {
    writeFileSync(
      join(root, 'FICTITIOUS_TEST_ONLY.json'),
      JSON.stringify({
        purpose: 'MKTAUTO-RELEASE-FIRST-COMMERCIAL-PILOT-001',
        classification: 'FICTITIOUS_TEST_ONLY',
        databaseSha256: createHash('sha256')
          .update(readFileSync(join(root, 'data', 'pilot.sqlite')))
          .digest('hex'),
      }),
    );
    config.executionId = '../LIVE';
    await expect(inspectPilot(configure())).rejects.toThrow(
      'PILOT_QUERY_INVALID',
    );
  });
  it('rejects hard-linked databases to protect shared resources', async () => {
    linkSync(join(root, 'data', 'pilot.sqlite'), join(root, 'shared.sqlite'));
    await expect(inspectPilot(configure())).rejects.toThrow(
      'PILOT_REGULAR_FILE_REQUIRED',
    );
  });
});
