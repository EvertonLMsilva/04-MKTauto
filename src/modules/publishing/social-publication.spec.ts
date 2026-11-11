import { historicalResidualPersistence } from '../../../test/support/historical-residual-persistence.js';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { HumanApprovalRepository } = historicalResidualPersistence(
  'human-approval-repository',
);
const { AffiliateRepository } = historicalResidualPersistence(
  'affiliate-repository',
);
import { ManualDistributionRepository } from './infrastructure/manual-distribution.repository.js';
import { ManualDistributionService } from './application/manual-distribution.service.js';
import {
  provisionSocialContext,
  SocialPublicationRepository,
} from './infrastructure/social-publication.repository.js';
import { SocialPublicationService } from './application/social-publication.service.js';
import { createHash } from 'node:crypto';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { socialFail } from './domain/social-publication-contracts.js';
const { project, product, campaign, startRun } = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
const bytes: any = Buffer.from('fixture-media'),
  hash: any = createHash('sha256').update(bytes).digest('hex'),
  account: any = '123456789',
  at: any = '2026-10-12T18:00:00Z';
async function fixture(fn: any): Promise<any> {
  const root: any = mkdtempSync(join(tmpdir(), 'ig-publisher-')),
    path: any = join(root, 'offline.sqlite');
  let base: any = new HumanApprovalRepository(path);
  try {
    base.create(project());
    const catalog: any = new AffiliateRepository(base);
    catalog.registerProduct(product(), 'product');
    catalog.registerCampaign(campaign(), 'campaign');
    startRun(base);
    catalog.createBriefing(
      { briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 },
      'brief',
    );
    catalog.bindRun(
      { pipelineRunId: 'run_001', briefingId: 'brief_001' },
      'bind',
    );
    const render: any = {
      videoRenderId: 'render_001',
      revision: 1,
      contentHash: hash,
      logicalReference: `render:sha256_${hash}`,
      projectId: 'project_001',
      projectVersion: 1,
      pipelineRunId: 'run_001',
      origin: { rights: { commercialUseAuthorized: true } },
    };
    const qc: any = {
      qualityControlReportId: 'qc_001',
      contentHash: 'b'.repeat(64),
      videoRenderId: 'render_001',
      videoRenderContentHash: hash,
      projectId: 'project_001',
      projectVersion: 1,
      pipelineRunId: 'run_001',
      result: 'PASS',
      approvalBlocked: false,
      findings: [
        'COMMERCIAL_RIGHTS',
        'PROCESSING_RIGHTS',
        'NARRATION_RIGHTS',
      ].map((code: any): any => ({ code, status: 'PASS' })),
    };
    const evidence: any = {
      getVideoRender: (): any => structuredClone(render),
      getQualityControlReport: (): any => structuredClone(qc),
      verifyMedia: (): any => hash,
    };
    const calls: any = [];
    let handler: any = ({ method, url }: any): any => ({
      ok: true,
      status: 200,
      json: async (): Promise<any> =>
        method === 'POST'
          ? { id: url.endsWith('media_publish') ? '987654321' : '234567890' }
          : { status_code: 'FINISHED' },
    });
    const adapter = new InstagramGraphAdapter({
      mode: 'fake',
      accountId: account,
      apiVersion: 'v25.0',
      getAccessToken: () => 'FAKE_PRIVATE_TOKEN',
      fetch: async (url, init) => {
        const request = {
          method: init?.method,
          url: (url instanceof Request ? url.url : url.toString()).split(
            '?',
          )[0],
          headers: init?.headers,
          body: Object.fromEntries(
            new URLSearchParams(
              typeof init?.body === 'string' ? init.body : '',
            ),
          ),
        };
        calls.push({ method: request.method, url: request.url });
        const response = await handler(request);
        return { ...response, headers: new Headers() } as Response;
      },
    });
    const media: any = {
      inspect: async (): Promise<any> => ({
        contentHash: hash,
        result: 'PASS',
        policyVersion: 'instagram-reels-profile/1.0.0',
      }),
    };
    const pinned: any = {
      objectReference: 'fixture/video',
      versionId: 'v1',
      immutable: true,
      urlBoundToVersion: true,
      urlHash: createHash('sha256')
        .update('https://storage.example.test/video.mp4?signature=PRIVATE')
        .digest('hex'),
      expiresAt: '2026-10-13T18:00:00Z',
      bytes,
    };
    const storage: any = {
      mode: 'fake',
      readPinned: async (): Promise<any> => pinned,
      readVersion: async (): Promise<any> => pinned,
    };
    // Offline storage fixture: exercise the public verifier port with mutable pinned bytes.
    const checkPinned = (value: any, expected: string) => {
      if (
        !value?.immutable ||
        !value.urlBoundToVersion ||
        !value.versionId ||
        !Buffer.isBuffer(value.bytes) ||
        createHash('sha256').update(value.bytes).digest('hex') !== expected
      )
        socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED');
    };
    const transferVerifier = {
      mode: 'fake',
      async verifyTransfer(transfer: any) {
        const value = await storage.readPinned();
        checkPinned(value, transfer.contentHash);
        const proof = {
          executionMode: 'fake',
          contentHash: transfer.contentHash,
          versionId: value.versionId,
          objectReference: value.objectReference,
        };
        return { ...proof, evidenceHash: affiliateHash(proof) };
      },
      async verifyPublication(proof: any, expected: string) {
        const { evidenceHash, ...body } = proof ?? {};
        if (
          affiliateHash(body) !== evidenceHash ||
          body.contentHash !== expected ||
          body.executionMode !== 'fake'
        )
          socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED');
        checkPinned(await storage.readVersion(), expected);
      },
    };
    const make: any = (): any => {
      const manual: any = new ManualDistributionService({
        repository: new ManualDistributionRepository(
          base,
          new AffiliateRepository(base),
        ),
        evidence,
        now: (): any => at,
      });
      provisionSocialContext(base.db);
      const repository: any = new SocialPublicationRepository(base);
      return {
        manual,
        repository,
        service: new SocialPublicationService({
          repository,
          manual,
          publisher: adapter,
          media,
          transferVerifier,
          now: (): any => at,
        }),
      };
    };
    const f: any = {
      ...make(),
      render,
      qc,
      evidence,
      calls,
      adapter,
      media,
      transferVerifier,
      storage,
      path,
      root,
      base,
      catalog,
      setHandler: (h: any): any => {
        handler = h;
      },
      reopen: (): any => {
        base.close();
        base = new HumanApprovalRepository(path);
        const ports: any = make();
        Object.assign(f, ports, { base });
        return ports;
      },
    };
    f.package = (overrides: any = {}, key: any = 'package'): any =>
      f.manual.prepare(
        {
          campaignId: 'camp_001',
          campaignRevision: 1,
          videoRenderId: 'render_001',
          qualityControlReportId: 'qc_001',
          platform: 'instagram',
          account,
          caption: 'Produto autorizado',
          ...overrides,
        },
        key,
      );
    f.approve = (p: any): any =>
      f.manual.review(
        {
          packageHash: p.contentHash,
          decision: 'APPROVED',
          actor: 'operator',
          justification: null,
        },
        `approve_${p.contentHash}`,
      );
    f.prepare = async (): Promise<any> => {
      const p: any = f.package();
      f.approve(p);
      return f.service.prepare(
        { packageHash: p.contentHash, accountId: account },
        'prepare',
      );
    };
    f.transfer = (): any => ({
      url: 'https://storage.example.test/video.mp4?signature=PRIVATE',
      expiresAt: '2026-10-13T18:00:00Z',
      contentHash: hash,
    });
    await fn(f);
  } finally {
    base.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}
test('fluxo HTTP fake completo, intenção antes do POST e reinício', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    assert.equal(op.state, 'PREPARED');
    const preview: any = new PublishingController(
      { package: () => f.manual.getPackage(op.packageHash) } as any,
      {} as any,
    ).package(op.packageHash);
    f.setHandler(({ method, url, body, headers }: any): any => {
      assert.equal(headers.Authorization, 'Bearer FAKE_PRIVATE_TOKEN');
      if (method === 'POST') {
        const persisted: any = f.repository.get(op.operationId);
        assert.equal(
          persisted.state,
          url.endsWith('media_publish') ? 'PUBLISHING' : 'CREATING_CONTAINER',
        );
        if (!url.endsWith('media_publish')) {
          assert.equal(body.caption, preview.finalCaption);
          assert.equal(
            body.caption,
            [
              'Produto autorizado',
              campaign().cta,
              campaign().disclosure,
              campaign().affiliateUrl,
            ].join('\n\n'),
          );
        }
        return {
          ok: true,
          status: 200,
          json: async (): Promise<any> => ({
            id: url.endsWith('media_publish') ? '987654321' : '234567890',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async (): Promise<any> => ({ status_code: 'FINISHED' }),
      };
    });
    assert.equal(
      (await f.service.createContainer(op.operationId, f.transfer())).state,
      'PROCESSING',
    );
    assert.equal((await f.service.process(op.operationId)).state, 'READY');
    assert.equal((await f.service.publish(op.operationId)).state, 'PUBLISHED');
    const reopened: any = f.reopen();
    assert.equal(
      (await reopened.service.publish(op.operationId)).state,
      'PUBLISHED',
    );
    assert.equal(
      f.calls.filter((c: any): any => c.method === 'POST').length,
      2,
    );
    assert.equal(
      JSON.stringify(reopened.repository.get(op.operationId)).includes(
        'PRIVATE',
      ),
      false,
    );
  }));
test('timeout publicação não reenvia após reinício; FINISHED não significa publicado', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    await f.service.createContainer(op.operationId, f.transfer());
    await f.service.process(op.operationId);
    f.setHandler(({ method }: any): any => {
      if (method === 'POST') throw new Error('PRIVATE token URL');
      return {
        ok: true,
        status: 200,
        json: async (): Promise<any> => ({ status_code: 'FINISHED' }),
      };
    });
    const uncertain: any = await f.service.publish(op.operationId);
    assert.equal(uncertain.state, 'UNCERTAIN');
    assert.equal(uncertain.uncertainStage, 'PUBLISH');
    const reopened: any = f.reopen();
    await reopened.service.publish(op.operationId);
    assert.equal(
      (await reopened.service.reconcile(op.operationId)).state,
      'UNCERTAIN',
    );
    assert.equal(
      f.calls.filter((c: any): any => c.url.endsWith('media_publish')).length,
      1,
    );
    assert.equal(JSON.stringify(uncertain).includes('PRIVATE'), false);
    f.setHandler((): any => ({
      ok: true,
      status: 200,
      json: async (): Promise<any> => ({ status_code: 'PUBLISHED' }),
    }));
    assert.equal(
      (await reopened.service.reconcile(op.operationId)).state,
      'PUBLISHED',
    );
  }));
test('timeout criação sem ID permanece incerto e nunca recria', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    f.setHandler((): any => {
      throw new Error('lost response');
    });
    assert.equal(
      (await f.service.createContainer(op.operationId, f.transfer())).state,
      'UNCERTAIN',
    );
    const reopened: any = f.reopen();
    await reopened.service.createContainer(op.operationId, f.transfer());
    await reopened.service.reconcile(op.operationId);
    assert.equal(f.calls.length, 1);
    assert.equal(reopened.repository.get(op.operationId).state, 'UNCERTAIN');
  }));
test('duas conexões disputam intenção; resposta atrasada não sobrescreve reconciliação', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare(),
      other: any = new HumanApprovalRepository(f.path);
    let release: any;
    try {
      const repository: any = new SocialPublicationRepository(other),
        manual: any = new ManualDistributionService({
          repository: new ManualDistributionRepository(
            other,
            new AffiliateRepository(other),
          ),
          evidence: f.evidence,
          now: (): any => at,
        }),
        service: any = new SocialPublicationService({
          repository,
          manual,
          publisher: f.adapter,
          media: f.media,
          transferVerifier: f.transferVerifier,
          now: (): any => at,
        });
      f.setHandler(
        (): any =>
          new Promise((resolve: any): any => {
            release = (): any =>
              resolve({
                ok: true,
                status: 200,
                json: async (): Promise<any> => ({ id: '234567890' }),
              });
          }),
      );
      const pending: any = f.service.createContainer(
        op.operationId,
        f.transfer(),
      );
      await new Promise<void>((resolve) => setImmediate(() => resolve()));
      assert.equal(
        (await service.createContainer(op.operationId, f.transfer())).state,
        'CREATING_CONTAINER',
      );
      assert.equal(
        (await service.reconcile(op.operationId)).state,
        'UNCERTAIN',
      );
      release();
      await pending;
      assert.equal(repository.get(op.operationId).state, 'UNCERTAIN');
      assert.equal(f.calls.length, 1);
    } finally {
      other.close();
    }
  }));
test('gates revalidados, destino, aprovação e perfil bloqueiam antes de HTTP', (): any =>
  fixture(async (f: any): Promise<any> => {
    const p: any = f.package();
    await assert.rejects(
      f.service.prepare(
        { packageHash: p.contentHash, accountId: account },
        'no_review',
      ),
      { code: 'DISTRIBUTION_APPROVAL_REQUIRED' },
    );
    f.approve(p);
    await assert.rejects(
      f.service.prepare(
        { packageHash: p.contentHash, accountId: '999999999' },
        'wrong',
      ),
      { code: 'SOCIAL_DESTINATION_INVALID' },
    );
    const op: any = await f.service.prepare(
      { packageHash: p.contentHash, accountId: account },
      'ok',
    );
    f.render.origin.generationRequestId = 'live_01_aura_video_1';
    await assert.rejects(
      f.service.createContainer(op.operationId, f.transfer()),
      { code: 'DISTRIBUTION_DEMO_INELIGIBLE' },
    );
    delete f.render.origin.generationRequestId;
    f.qc.result = 'FAIL';
    await assert.rejects(
      f.service.createContainer(op.operationId, f.transfer()),
      { code: 'DISTRIBUTION_QC_FAILED' },
    );
    f.qc.result = 'PASS';
    f.evidence.verifyMedia = (): any => 'c'.repeat(64);
    await assert.rejects(
      f.service.createContainer(op.operationId, f.transfer()),
      { code: 'DISTRIBUTION_MEDIA_CHANGED' },
    );
    f.evidence.verifyMedia = (): any => hash;
    f.media.inspect = async (): Promise<any> => ({
      contentHash: hash,
      result: 'FAIL',
    });
    await assert.rejects(
      f.service.createContainer(op.operationId, f.transfer()),
      { code: 'SOCIAL_MEDIA_INCOMPATIBLE' },
    );
    assert.equal(f.calls.length, 0);
  }));
test('contratos fechados, legenda final, URL expirada, sem fetch global', (): any =>
  fixture(async (f: any): Promise<any> => {
    assert.throws(
      (): any =>
        new InstagramGraphAdapter({
          mode: 'fake',
          fetch: globalThis.fetch,
          accountId: account,
          apiVersion: 'v25.0',
          getAccessToken: () => '',
        }),
      { code: 'SOCIAL_OFFLINE_TRANSPORT_REQUIRED' },
    );
    const long: any = f.package({ caption: 'a'.repeat(2200) }, 'long_package');
    f.approve(long);
    await assert.rejects(
      f.service.prepare(
        { packageHash: long.contentHash, accountId: account },
        'long',
      ),
      { code: 'SOCIAL_CAPTION_INVALID' },
    );
    const op: any = await f.prepare();
    await assert.rejects(
      f.service.createContainer(op.operationId, {
        ...f.transfer(),
        expiresAt: at,
      }),
      { code: 'SOCIAL_TRANSFER_INVALID' },
    );
    await assert.rejects(
      f.service.prepare(
        { packageHash: op.packageHash, accountId: account, token: 'PRIVATE' },
        'extra',
      ),
      { code: 'DISTRIBUTION_INVALID_CONTRACT' },
    );
    assert.equal(f.calls.length, 0);
  }));
test('intenções interrompidas, rejeição HTTP e estados externos não causam retry', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    const intent: any = f.repository.transition(
      op.operationId,
      op.version,
      ['PREPARED'],
      { state: 'CREATING_CONTAINER' },
      at,
    ).value;
    assert.equal(intent.state, 'CREATING_CONTAINER');
    const reopened: any = f.reopen();
    assert.equal(
      (await reopened.service.reconcile(op.operationId)).state,
      'UNCERTAIN',
    );
    await reopened.service.createContainer(op.operationId, f.transfer());
    assert.equal(f.calls.length, 0);
    const p: any = f.package({ caption: 'Segunda versão' }, 'second');
    reopened.manual.review(
      {
        packageHash: p.contentHash,
        decision: 'APPROVED',
        actor: 'operator',
        justification: null,
      },
      'second_review',
    );
    const second: any = await reopened.service.prepare(
      { packageHash: p.contentHash, accountId: account },
      'second',
    );
    f.setHandler((): any => ({
      ok: false,
      status: 403,
      json: async (): Promise<any> => ({ error: { message: 'PRIVATE' } }),
    }));
    assert.equal(
      (await reopened.service.createContainer(second.operationId, f.transfer()))
        .state,
      'UNCERTAIN',
    );
    assert.equal(
      JSON.stringify(reopened.repository.get(second.operationId)).includes(
        'PRIVATE',
      ),
      false,
    );
  }));
test('ERROR/EXPIRED/IN_PROGRESS, GET indisponível e resposta inválida são explícitos', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    await f.service.createContainer(op.operationId, f.transfer());
    f.setHandler((): any => ({
      ok: true,
      json: async (): Promise<any> => ({ status_code: 'IN_PROGRESS' }),
    }));
    assert.equal((await f.service.process(op.operationId)).state, 'PROCESSING');
    f.setHandler((): any => {
      throw new Error('PRIVATE');
    });
    assert.equal(
      (await f.service.process(op.operationId)).errorCode,
      'SOCIAL_STATUS_UNAVAILABLE',
    );
    f.setHandler((): any => ({
      ok: true,
      json: async (): Promise<any> => ({ status_code: 'EXPIRED' }),
    }));
    assert.equal((await f.service.process(op.operationId)).state, 'EXPIRED');
    const p: any = f.package({ caption: 'Erro' }, 'error');
    f.approve(p);
    const second: any = await f.service.prepare(
      { packageHash: p.contentHash, accountId: account },
      'error',
    );
    f.setHandler((): any => ({
      ok: true,
      json: async (): Promise<any> => ({ id: '234567891' }),
    }));
    await f.service.createContainer(second.operationId, f.transfer());
    f.setHandler((): any => ({
      ok: true,
      json: async (): Promise<any> => ({ status_code: 'ERROR' }),
    }));
    assert.equal((await f.service.process(second.operationId)).state, 'FAILED');
    assert.equal(
      f.calls.filter((c: any): any => c.url.endsWith('media_publish')).length,
      0,
    );
  }));
test('identidade, transições e histórico não podem ser resetados', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    assert.deepEqual(
      await f.service.prepare(
        { packageHash: op.packageHash, accountId: account },
        'another_key',
      ),
      op,
    );
    assert.throws(
      (): any =>
        f.repository.transition(
          op.operationId,
          op.version,
          ['PREPARED'],
          { state: 'PUBLISHED' },
          at,
        ),
      { code: 'SOCIAL_TRANSITION_INVALID' },
    );
    assert.throws(
      (): any =>
        f.repository.transition(
          op.operationId,
          op.version,
          ['PREPARED'],
          { state: 'CREATING_CONTAINER', token: 'PRIVATE' },
          at,
        ),
      { code: 'SOCIAL_TRANSITION_INVALID' },
    );
    const p: any = f.package({ caption: 'Outro pacote' }, 'changed');
    f.approve(p);
    await assert.rejects(
      f.service.prepare(
        { packageHash: p.contentHash, accountId: account },
        'prepare',
      ),
      { code: 'SOCIAL_IDEMPOTENCY_CONFLICT' },
    );
    assert.throws(
      (): any => f.base.db.exec('DELETE FROM social_publication_operations'),
      /PERSISTENT_SOCIAL/,
    );
    assert.throws(
      (): any =>
        f.base.db.exec('UPDATE social_publication_events SET version=10'),
      /IMMUTABLE_SOCIAL/,
    );
    assert.equal(f.repository.get(op.operationId).state, 'PREPARED');
    assert.equal(f.calls.length, 0);
  }));
test('falha ao persistir recibo é exposta; intenção sobrevive sem repetir POST', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    await f.service.createContainer(op.operationId, f.transfer());
    await f.service.process(op.operationId);
    f.base.db.exec(
      "CREATE TRIGGER fixture_receipt_failure BEFORE UPDATE ON social_publication_operations WHEN json_extract(NEW.payload_json,'$.state')='PUBLISHED' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END;",
    );
    await assert.rejects(
      f.service.publish(op.operationId),
      /fixture receipt failure/,
    );
    assert.equal(f.repository.get(op.operationId).state, 'PUBLISHING');
    const reopened: any = f.reopen();
    await reopened.service.publish(op.operationId);
    assert.equal(
      (await reopened.service.reconcile(op.operationId)).state,
      'UNCERTAIN',
    );
    assert.equal(
      f.calls.filter((c: any): any => c.url.endsWith('media_publish')).length,
      1,
    );
  }));
test('sem prova, mídia alterada ou prova ausente bloqueiam antes do POST', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    const unavailable: any = new SocialPublicationService({
      repository: f.repository,
      manual: f.manual,
      publisher: f.adapter,
      media: f.media,
      now: (): any => at,
    });
    await assert.rejects(
      unavailable.createContainer(op.operationId, f.transfer()),
      { code: 'SOCIAL_HOSTED_MEDIA_UNVERIFIED' },
    );
    f.storage.readPinned = async (): Promise<any> => ({});
    await assert.rejects(
      f.service.createContainer(op.operationId, f.transfer()),
      { code: 'SOCIAL_HOSTED_MEDIA_UNVERIFIED' },
    );
    assert.equal(f.repository.get(op.operationId).state, 'PREPARED');
    assert.equal(f.calls.length, 0);
  }));
test('evidência persistida sobrevive reinício; bytes alterados bloqueiam publicação', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    await f.service.createContainer(op.operationId, f.transfer());
    await f.service.process(op.operationId);
    const reopened: any = f.reopen();
    const original: any = await f.storage.readVersion();
    f.storage.readVersion = async (): Promise<any> => ({
      ...original,
      bytes: Buffer.from('changed'),
    });
    await assert.rejects(reopened.service.publish(op.operationId), {
      code: 'SOCIAL_HOSTED_MEDIA_UNVERIFIED',
    });
    assert.equal(
      f.calls.filter((c: any): any => c.url.endsWith('media_publish')).length,
      0,
    );
    assert.equal(reopened.repository.get(op.operationId).state, 'READY');
    assert.equal(
      JSON.stringify(reopened.repository.get(op.operationId)).includes(
        'signature=PRIVATE',
      ),
      false,
    );
  }));
test('serviço rejeita transporte LIVE em banco fake; guarda atua antes da intenção', (): any =>
  fixture(async (f: any): Promise<any> => {
    const op: any = await f.prepare();
    let calls: any = 0;
    const livePublisher = new InstagramGraphAdapter({
      mode: 'live',
      accountId: account,
      apiVersion: 'v26.0',
      getAccessToken: () => 'private',
      fetch: async () => {
        calls++;
        throw new Error('unexpected');
      },
    });
    assert.throws(
      (): any =>
        new SocialPublicationService({
          repository: f.repository,
          manual: f.manual,
          publisher: livePublisher,
          media: f.media,
        }),
      { code: 'SOCIAL_EXECUTION_MODE_MISMATCH' },
    );
    assert.equal(f.repository.get(op.operationId).state, 'PREPARED');
    assert.equal(calls, 0);
  }));
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { InstagramPublicationRepository } from './infrastructure/instagram-publication.repository.js';
import { CampaignRepository } from '../content-operations/infrastructure/campaign.repository.js';

test('P5 revoke exact review blocks manual gate; immutable evidence and replay', () =>
  fixture(async (f: any) => {
    provisionSchema(f.base.db, 42);
    const op = await f.prepare(),
      review = f.manual.getReview(op.packageHash);
    const input = {
      packageHash: op.packageHash,
      reviewHash: review.contentHash,
      actor: 'operator',
      reason: 'Authorization withdrawn',
    };
    const before = f.manual.getReview(op.packageHash);
    const r = f.manual.revokeApproval(input);
    assert.deepEqual(f.manual.revokeApproval(input), r);
    assert.throws(() => f.manual.validateForPublication(op.packageHash), {
      code: 'DISTRIBUTION_APPROVAL_REVOKED',
    });
    await assert.rejects(
      f.service.createContainer(op.operationId, f.transfer()),
      { code: 'DISTRIBUTION_APPROVAL_REVOKED' },
    );
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.manual.getReview(op.packageHash), before);
    assert.throws(
      () => f.base.db.exec('DELETE FROM instagram_approval_revocations'),
      /IMMUTABLE/,
    );
    assert.throws(
      () => f.manual.revokeApproval({ ...input, reason: 'other' }),
      { code: 'SOCIAL_REVOCATION_CONFLICT' },
    );
  }));

test('P5 reservation binds P4 and canonical identity across packages; concurrent claims', () =>
  fixture(async (f: any) => {
    provisionSchema(f.base.db, 42);
    const p4 = new CampaignRepository(f.base.db);
    const e = p4.schedule(
      {
        campaignId: 'camp_001',
        campaignRevision: 1,
        runId: 'run_001',
        scheduledAt: at,
      },
      {},
      at,
    );
    const op = await f.prepare(),
      p = f.manual.getPackage(op.packageHash),
      review = f.manual.getReview(op.packageHash);
    const r = new InstagramPublicationRepository(f.base.db);
    r.reserve(e.execution_id, op, p, review.contentHash, at);
    assert.throws(() => r.authorize(op, at), {
      code: 'SOCIAL_CAMPAIGN_AUTHORIZATION_REQUIRED',
    });
    const claims = await Promise.all([
      Promise.resolve().then(() => p4.claim(e.execution_id, at, 60000)),
      Promise.resolve().then(() => p4.claim(e.execution_id, at, 60000)),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    r.authorize(op, at);
    const p2 = f.package(
      { caption: 'Another approved caption' },
      'package_other',
    );
    f.approve(p2);
    const op2 = await f.service.prepare(
      { packageHash: p2.contentHash, accountId: op.accountId },
      'prepare_other',
    );
    assert.throws(
      () =>
        r.reserve(
          e.execution_id,
          op2,
          p2,
          f.manual.getReview(p2.contentHash).contentHash,
          at,
        ),
      { code: 'SOCIAL_PUBLICATION_IDENTITY_CONFLICT' },
    );
    assert.throws(
      () =>
        f.base.db.exec(
          "UPDATE instagram_publication_reservations SET destination='instagram:999999'",
        ),
      /IMMUTABLE/,
    );
    p4.cancel(e.execution_id, at);
    assert.throws(() => r.authorize(op, at), {
      code: 'SOCIAL_CAMPAIGN_AUTHORIZATION_REQUIRED',
    });
  }));

test('P5 rechecks authorization after asynchronous probes and keeps receipt on in-flight revocation', () =>
  fixture(async (f: any) => {
    let authorized = true;
    const transferVerifier = {
      mode: 'fake',
      verifyTransfer: (t: any) => f.transferVerifier.verifyTransfer(t),
      verifyPublication: (...args: any[]) =>
        f.transferVerifier.verifyPublication(...args),
    };
    const service = new SocialPublicationService({
      repository: f.repository,
      manual: f.manual,
      publisher: f.adapter,
      media: f.media,
      transferVerifier,
      now: () => at,
      authorize: () => {
        if (!authorized)
          throw Object.assign(new Error('revoked'), {
            code: 'SOCIAL_APPROVAL_REVOKED',
          });
      },
    });
    const op = await f.prepare();
    const verify = f.transferVerifier.verifyTransfer.bind(f.transferVerifier);
    transferVerifier.verifyTransfer = async (t: any) => {
      const proof = await verify(t);
      authorized = false;
      return proof;
    };
    await assert.rejects(
      service.createContainer(op.operationId, f.transfer()),
      { code: 'SOCIAL_APPROVAL_REVOKED' },
    );
    assert.equal(f.calls.length, 0);
    authorized = true;
    transferVerifier.verifyTransfer = verify;
    await service.createContainer(op.operationId, f.transfer());
    await service.process(op.operationId);
    f.setHandler(() => {
      authorized = false;
      return { ok: true, status: 200, json: async () => ({ id: '987654321' }) };
    });
    const published = await service.publish(op.operationId);
    assert.equal(published.mediaId, '987654321');
    assert.equal(published.requiresReconciliation, true);
    assert.equal((await service.publish(op.operationId)).mediaId, '987654321');
    assert.equal(
      f.calls.filter((c: any) => c.url.endsWith('media_publish')).length,
      1,
    );
  }));
import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { PublishingPersistence } from './infrastructure/publishing.persistence.js';
import { InstagramGraphAdapter } from './infrastructure/instagram-graph.adapter.js';
import { CampaignOrchestrator } from '../content-operations/application/campaign-orchestrator.js';

function p5(
  f: any,
  behavior?: (url: string, init: any) => Response | Promise<Response>,
) {
  const adapter = new InstagramGraphAdapter({
    mode: 'fake',
    accountId: account,
    apiVersion: 'v25.0',
    getAccessToken: () => 'FAKE_SECRET',
    fetch: async (url, init) => {
      f.calls.push({
        url: url instanceof Request ? url.url : url.toString(),
        method: init?.method,
      });
      if (behavior)
        return behavior(
          url instanceof Request ? url.url : url.toString(),
          init,
        );
      return new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? {
                id: (url instanceof Request
                  ? url.url
                  : url.toString()
                ).endsWith('media_publish')
                  ? '987654321'
                  : '234567890',
              }
            : (url instanceof Request ? url.url : url.toString()).includes(
                  'status_code',
                )
              ? { status_code: 'FINISHED' }
              : {
                  id: '987654321',
                  permalink: 'https://www.instagram.com/reel/example/',
                  timestamp: at,
                },
        ),
      );
    },
  });
  const store = new PublishingPersistence(
    f.path,
    {
      open: () => ({
        getCampaign: (id: string, rev: number) =>
          f.catalog.getCampaign(id, rev),
        getProduct: (id: string, rev: number) => f.catalog.getProduct(id, rev),
        close() {},
      }),
    } as any,
    {
      resolveRunBriefing: (...args: any[]) =>
        f.catalog.resolveRunBriefing(...args),
    } as any,
    {
      getVideoRender: f.evidence.getVideoRender,
      verifyMedia: f.evidence.verifyMedia,
      report: f.evidence.getQualityControlReport,
    },
  );
  return new InstagramPublicationService(
    store,
    {
      publisher: adapter,
      media: f.media,
      transfer: async () => f.transfer(),
      verifier: f.transferVerifier,
    },
    () => at,
  );
}
function scheduleP5(f: any, scheduledAt = at) {
  provisionSchema(f.base.db, 42);
  const r = new CampaignRepository(f.base.db),
    p = f.package();
  f.approve(p);
  const input = { packageHash: p.contentHash, accountId: account };
  const e = r.schedule(
    {
      campaignId: 'camp_001',
      campaignRevision: 1,
      runId: 'run_001',
      scheduledAt,
    },
    input,
    at,
  );
  const handoff = {
    videoRenderId: f.render.videoRenderId,
    contentHash: f.render.contentHash,
  };
  return { r, e, input, handoff };
}
test('P5 native runtime through P4: due schedule, concurrent ticks, durable receipts, restart and replay', () =>
  fixture(async (f: any) => {
    const { r, e, input, handoff } = scheduleP5(f);
    const makeRunner = () =>
      new CampaignOrchestrator(
        r,
        {
          steps: ['PUBLICATION'],
          execute: async () =>
            p5(f).execute(r.get(e.execution_id), input, handoff),
          reconcile: async () => p5(f).reconcile(e.execution_id),
        },
        () => at,
      );
    await Promise.all([makeRunner().tick(), makeRunner().tick()]);
    assert.equal(r.get(e.execution_id).status, 'SUCCEEDED');
    const reservation = f.base.db
      .prepare('SELECT * FROM instagram_publication_reservations')
      .get();
    const op = f.repository.get(reservation.operation_id);
    assert.equal(op.remoteReceipt.mediaId, '987654321');
    assert.equal(op.requiresReconciliation, false);
    await makeRunner().tick();
    assert.equal(f.calls.filter((c: any) => c.method === 'POST').length, 2);
    assert.equal(
      JSON.stringify(f.repository.history(op.operationId)).includes(
        'FAKE_SECRET',
      ),
      false,
    );
  }));
test('P5 P4 future schedule and cancelled execution make no calls', () =>
  fixture(async (f: any) => {
    const { r, e, input, handoff } = scheduleP5(f, '2026-10-13T18:00:00Z');
    const runner = new CampaignOrchestrator(
      r,
      {
        steps: ['PUBLICATION'],
        execute: async () =>
          p5(f).execute(r.get(e.execution_id), input, handoff),
        reconcile: async () => null,
      },
      () => at,
    );
    await runner.tick();
    assert.equal(f.calls.length, 0);
    r.cancel(e.execution_id, at);
    await runner.tick();
    assert.equal(f.calls.length, 0);
    await assert.rejects(p5(f).execute(r.get(e.execution_id), input, handoff), {
      code: 'SOCIAL_CAMPAIGN_AUTHORIZATION_REQUIRED',
    });
    assert.equal(f.calls.length, 0);
  }));
test.each(['CREATE', 'PUBLISH'])(
  'P5 timeout at %s persists uncertainty and restart cannot replay POST',
  (stage: string) =>
    fixture(async (f: any) => {
      const { r, e, input, handoff } = scheduleP5(f);
      r.claim(e.execution_id, at, 60000);
      const service = p5(f, async (url, init) => {
        if (
          init?.method === 'POST' &&
          (stage === 'CREATE' || url.endsWith('media_publish'))
        )
          throw new Error('timeout after remote effect');
        return new Response(
          JSON.stringify(
            init?.method === 'POST'
              ? { id: '234567890' }
              : { status_code: 'FINISHED' },
          ),
        );
      });
      await assert.rejects(
        service.execute(r.get(e.execution_id), input, handoff),
        { code: 'SOCIAL_RECONCILIATION_REQUIRED' },
      );
      const count = f.calls.filter((c: any) => c.method === 'POST').length;
      assert.equal(await p5(f).reconcile(e.execution_id), null);
      await assert.rejects(
        p5(f).execute(r.get(e.execution_id), input, handoff),
        { code: 'SOCIAL_RECONCILIATION_REQUIRED' },
      );
      assert.equal(
        f.calls.filter((c: any) => c.method === 'POST').length,
        count,
      );
    }),
);
import {
  NativeCampaignWorkflow,
  campaignRequest,
} from '../content-operations/application/native-campaign-workflow.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PublishingController } from './publishing.controller.js';
import { PublishingService } from './application/publishing.service.js';

test('P5 HTTP revoke and receipt endpoints use native stores and sanitize errors', () =>
  fixture(async (f: any) => {
    const { r, e, input, handoff } = scheduleP5(f);
    r.claim(e.execution_id, at, 60000);
    const instagram = p5(f);
    const result = await instagram.execute(
      r.get(e.execution_id),
      input,
      handoff,
    );
    const publishing = new PublishingService(
      {
        open: () => ({ manual: f.manual, approvals: {}, close() {} }),
        social: (action: any) => action(f.repository),
      },
      {} as any,
    );
    const module = await Test.createTestingModule({
      controllers: [PublishingController],
      providers: [
        { provide: PublishingService, useValue: publishing },
        { provide: InstagramPublicationService, useValue: instagram },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const receipt = await request(app.getHttpServer())
        .post(
          `/publishing/social-operations/${encodeURIComponent(result.operationId)}/receipt`,
        )
        .expect(201);
      assert.equal(receipt.body.remoteReceipt.mediaId, '987654321');
      const review = f.manual.getReview(input.packageHash);
      const revoke = {
        packageHash: input.packageHash,
        reviewHash: review.contentHash,
        actor: 'operator',
        reason: 'Stop publication',
      };
      await request(app.getHttpServer())
        .post('/publishing/approval-revocations')
        .send(revoke)
        .expect(201);
      await request(app.getHttpServer())
        .post('/publishing/approval-revocations')
        .send(revoke)
        .expect(201);
      const invalid = await request(app.getHttpServer())
        .post('/publishing/approval-revocations')
        .send({ ...revoke, reviewHash: 'f'.repeat(64) })
        .expect(400);
      assert.equal(invalid.body.code, 'SOCIAL_APPROVED_REVIEW_REQUIRED');
      const history = await request(app.getHttpServer())
        .get(
          `/publishing/social-operations/${encodeURIComponent(result.operationId)}/history`,
        )
        .expect(200);
      assert.equal(history.body.at(-1).mediaId, '987654321');
      assert.equal(JSON.stringify(history.body).includes('FAKE_SECRET'), false);
    } finally {
      await app.close();
    }
  }));

test('P5 NativeCampaignWorkflow delegates PUBLICATION and reconciliation through the public service', async () => {
  const publication = {
    execute: vi.fn(async () => ({ mediaId: '987654321' })),
    reconcile: vi.fn(async () => ({ verified: true })),
  };
  const workflow = new NativeCampaignWorkflow(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    publication as any,
  );
  const e = { execution_id: 'execution_001' } as any,
    raw = { publication: { packageHash: 'a'.repeat(64), accountId: account } },
    done = { HANDOFF: { contentHash: 'a'.repeat(64) } };
  await workflow.execute('PUBLICATION', e, raw, done);
  expect(publication.execute).toHaveBeenCalledWith(
    e,
    raw.publication,
    done.HANDOFF,
  );
  await workflow.reconcile(e, [
    { event_type: 'STEP_STARTED', evidence: { step: 'PUBLICATION' } },
  ] as any);
  expect(publication.reconcile).toHaveBeenCalledWith(e.execution_id);
  expect(() =>
    campaignRequest({
      publication: { accountId: '001', packageHash: 'a'.repeat(64) },
    }),
  ).toThrow();
});
test('P5 known processing continues via scheduler without human retry or duplicated create', () =>
  fixture(async (f: any) => {
    const { r, e, input, handoff } = scheduleP5(f);
    let clock = at,
      reads = 0;
    const publisher = p5(
      f,
      (url, init) =>
        new Response(
          JSON.stringify(
            init?.method === 'POST'
              ? {
                  id: url.endsWith('media_publish') ? '987654321' : '234567890',
                }
              : url.includes('status_code')
                ? { status_code: ++reads === 1 ? 'IN_PROGRESS' : 'FINISHED' }
                : {
                    id: '987654321',
                    permalink: 'https://www.instagram.com/reel/example/',
                    timestamp: at,
                  },
          ),
        ),
    );
    const runner = new CampaignOrchestrator(
      r,
      {
        steps: ['PUBLICATION'],
        execute: async () =>
          publisher.execute(r.get(e.execution_id), input, handoff),
        reconcile: async () => publisher.reconcile(e.execution_id),
      },
      () => clock,
    );
    await runner.tick();
    assert.equal(r.get(e.execution_id).status, 'WAITING_INPUT');
    await runner.tick();
    assert.equal(reads, 1);
    clock = '2026-10-12T18:01:01.000Z';
    await runner.tick();
    assert.equal(r.get(e.execution_id).status, 'SUCCEEDED');
    assert.equal(
      f.calls.filter(
        (c: any) => c.method === 'POST' && !c.url.endsWith('media_publish'),
      ).length,
      1,
    );
  }));
import { deterministicInstagramPorts } from './infrastructure/instagram-fake.js';

test('P5 explicit deterministic fake works after service restart; real mode cannot consume fake evidence', () =>
  fixture(async (f: any) => {
    const { r, e, input, handoff } = scheduleP5(f);
    r.claim(e.execution_id, at, 60000);
    const publishing = { package: (hash: string) => f.manual.getPackage(hash) };
    const media = {
      getVideoRender: f.evidence.getVideoRender,
      report: f.evidence.getQualityControlReport,
      verifyMedia: f.evidence.verifyMedia,
    };
    const ports = deterministicInstagramPorts(
      publishing,
      media,
      account,
      'v25.0',
    );
    const proof = await ports.verifier.verifyTransfer(
      await ports.transfer(input.packageHash),
    );
    assert.equal(proof.executionMode, 'fake');
    assert.equal(proof.contentHash, handoff.contentHash);
    await assert.rejects(
      ports.verifier.verifyPublication(
        { ...proof, executionMode: 'live' },
        handoff.contentHash,
      ),
      { code: 'SOCIAL_HOSTED_MEDIA_UNVERIFIED' },
    );
    const store = new PublishingPersistence(
      f.path,
      {
        open: () => ({
          getCampaign: (id: string, rev: number) =>
            f.catalog.getCampaign(id, rev),
          getProduct: (id: string, rev: number) =>
            f.catalog.getProduct(id, rev),
          close() {},
        }),
      } as any,
      {
        resolveRunBriefing: (...args: any[]) =>
          f.catalog.resolveRunBriefing(...args),
      } as any,
      media,
    );
    const result = await new InstagramPublicationService(
      store,
      ports,
      () => at,
    ).execute(r.get(e.execution_id), input, handoff);
    assert.match(result.receipt.permalink, /fake_/);
    const replay = await new InstagramPublicationService(
      store,
      deterministicInstagramPorts(publishing, media, account, 'v25.0'),
      () => at,
    ).execute(r.get(e.execution_id), input, handoff);
    assert.equal(replay.mediaId, result.mediaId);
  }));

test.each(['CREATE', 'PUBLISH'])(
  'P5 actual revocation during %s preserves effect and requires reconciliation',
  (stage: string) =>
    fixture(async (f: any) => {
      const { r, e, input, handoff } = scheduleP5(f);
      r.claim(e.execution_id, at, 60000);
      const service = p5(f, (url, init) => {
        if (
          init?.method === 'POST' &&
          (stage === 'CREATE' || url.endsWith('media_publish'))
        ) {
          const review = f.manual.getReview(input.packageHash);
          f.manual.revokeApproval({
            packageHash: input.packageHash,
            reviewHash: review.contentHash,
            actor: 'operator',
            reason: 'Revoke during HTTP',
          });
        }
        return new Response(
          JSON.stringify(
            init?.method === 'POST'
              ? {
                  id: url.endsWith('media_publish') ? '987654321' : '234567890',
                }
              : { status_code: 'FINISHED' },
          ),
        );
      });
      await assert.rejects(
        service.execute(r.get(e.execution_id), input, handoff),
        { code: 'SOCIAL_RECONCILIATION_REQUIRED' },
      );
      const operation = f.base.db
        .prepare('SELECT operation_id FROM instagram_publication_reservations')
        .get().operation_id;
      const op = f.repository.get(operation);
      assert.equal(op.requiresReconciliation, true);
      assert.ok(stage === 'CREATE' ? op.containerId : op.mediaId);
      const posts = f.calls.filter((c: any) => c.method === 'POST').length;
      const proof = await p5(f).reconcile(e.execution_id);
      assert.equal(proof?.verified, true);
      await assert.rejects(
        p5(f).execute(r.get(e.execution_id), input, handoff),
        { code: 'DISTRIBUTION_APPROVAL_REVOKED' },
      );
      assert.equal(
        f.calls.filter((c: any) => c.method === 'POST').length,
        posts,
      );
    }),
);

test.each([401, 429])(
  'P5 records classified HTTP %s and retry-after without retrying',
  (status: number) =>
    fixture(async (f: any) => {
      const { r, e, input, handoff } = scheduleP5(f);
      r.claim(e.execution_id, at, 60000);
      const service = p5(
        f,
        () =>
          new Response(
            JSON.stringify({
              error: { code: status === 401 ? 190 : 4, message: 'FAKE_SECRET' },
            }),
            { status, headers: { 'retry-after': '60' } },
          ),
      );
      await assert.rejects(
        service.execute(r.get(e.execution_id), input, handoff),
        { code: 'SOCIAL_RECONCILIATION_REQUIRED' },
      );
      const op = f.repository.get(
        f.base.db
          .prepare(
            'SELECT operation_id FROM instagram_publication_reservations',
          )
          .get().operation_id,
      );
      assert.equal(
        op.errorCode,
        status === 401 ? 'SOCIAL_AUTH_REQUIRED' : 'SOCIAL_RATE_LIMIT',
      );
      assert.equal(op.retryAfterSeconds, 60);
      assert.equal(f.calls.length, 1);
      assert.equal(
        JSON.stringify(f.repository.history(op.operationId)).includes(
          'FAKE_SECRET',
        ),
        false,
      );
    }),
);

test('P5 upgrade preserves existing social history and failed revocation never appends evidence', () =>
  fixture(async (f: any) => {
    const op = await f.prepare();
    await f.service.createContainer(op.operationId, f.transfer());
    const before = f.repository.history(op.operationId),
      original = f.repository.get(op.operationId);
    provisionSchema(f.base.db, 42);
    provisionSchema(f.base.db, 42);
    assert.deepEqual(f.repository.history(op.operationId), before);
    assert.deepEqual(f.repository.get(op.operationId), original);
    const review = f.manual.getReview(op.packageHash);
    assert.throws(
      () =>
        f.manual.revokeApproval({
          packageHash: op.packageHash,
          reviewHash: 'f'.repeat(64),
          actor: 'operator',
          reason: 'Invalid review',
        }),
      { code: 'SOCIAL_APPROVED_REVIEW_REQUIRED' },
    );
    assert.equal(
      f.base.db
        .prepare('SELECT COUNT(*) n FROM instagram_approval_revocations')
        .get().n,
      0,
    );
    assert.equal(
      f.manual.getReview(op.packageHash).contentHash,
      review.contentHash,
    );
  }));
test('P5 P4 restart after lost receipt GET reconciles known media without another POST', () =>
  fixture(async (f: any) => {
    const { r, e, input, handoff } = scheduleP5(f);
    const service = p5(f, (url, init) => {
      if (init?.method !== 'POST' && !url.includes('status_code'))
        throw new Error('receipt response lost');
      return new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? { id: url.endsWith('media_publish') ? '987654321' : '234567890' }
            : { status_code: 'FINISHED' },
        ),
      );
    });
    const makeRunner = (publication: InstagramPublicationService) =>
      new CampaignOrchestrator(
        r,
        {
          steps: ['PUBLICATION'],
          execute: async () =>
            publication.execute(r.get(e.execution_id), input, handoff),
          reconcile: async () => publication.reconcile(e.execution_id),
        },
        () => at,
      );
    await makeRunner(service).tick();
    assert.equal(r.get(e.execution_id).status, 'WAITING_RECONCILIATION');
    const posts = f.calls.filter((c: any) => c.method === 'POST').length;
    const restarted = makeRunner(p5(f));
    await restarted.resume(e.execution_id);
    await restarted.tick();
    assert.equal(r.get(e.execution_id).status, 'SUCCEEDED');
    assert.equal(f.calls.filter((c: any) => c.method === 'POST').length, posts);
  }));

test('P5 recovered expired claim cannot be reused to publish under a new owner', () =>
  fixture(async (f: any) => {
    const { r, e, input, handoff } = scheduleP5(f);
    const old = r.claim(e.execution_id, at, 1000)!;
    const prepared = await f.service.prepare(input, 'preexisting_operation');
    const pkg = f.manual.getPackage(input.packageHash),
      review = f.manual.getReview(input.packageHash);
    new InstagramPublicationRepository(f.base.db).reserve(
      e.execution_id,
      prepared,
      pkg,
      review.contentHash,
      at,
    );
    r.recover('2026-10-12T18:00:02.000Z');
    const verified = await p5(f).reconcile(e.execution_id);
    assert.equal(verified?.verified, true);
    r.resume(e.execution_id, at, r.get(e.execution_id).version, verified);
    r.claim(e.execution_id, at, 60000);
    await assert.rejects(p5(f).execute(old, input, handoff), {
      code: 'SOCIAL_CAMPAIGN_AUTHORIZATION_REQUIRED',
    });
    assert.equal(f.calls.filter((c: any) => c.method === 'POST').length, 0);
  }));

test('P5 changed caption or destination requires a new exact approval before remote effects', () =>
  fixture(async (f: any) => {
    const { r, e, input, handoff } = scheduleP5(f);
    r.claim(e.execution_id, at, 60000);
    for (const [change, key] of [
      [{ caption: 'Changed after approval' }, 'changed_caption'],
      [{ account: '999999999' }, 'changed_account'],
    ] as any[]) {
      const pkg = f.package(change, key);
      await assert.rejects(
        p5(f).execute(
          r.get(e.execution_id),
          { packageHash: pkg.contentHash, accountId: pkg.account },
          handoff,
        ),
        { code: 'DISTRIBUTION_APPROVAL_REQUIRED' },
      );
    }
    f.evidence.verifyMedia = () => 'f'.repeat(64);
    await assert.rejects(p5(f).execute(r.get(e.execution_id), input, handoff), {
      code: 'DISTRIBUTION_MEDIA_CHANGED',
    });
    assert.equal(f.calls.length, 0);
  }));
test('P5 does not republish historical artifact under another package after upgrade', () =>
  fixture(async (f: any) => {
    const historical = await f.prepare();
    await f.service.createContainer(historical.operationId, f.transfer());
    await f.service.process(historical.operationId);
    await f.service.publish(historical.operationId);
    provisionSchema(f.base.db, 42);
    const p = f.package(
      { caption: 'New caption for historical video' },
      'historical_other',
    );
    f.approve(p);
    const r = new CampaignRepository(f.base.db),
      e = r.schedule(
        {
          campaignId: 'camp_001',
          campaignRevision: 1,
          runId: 'run_001',
          scheduledAt: at,
        },
        {},
        at,
      );
    r.claim(e.execution_id, at, 60000);
    const posts = f.calls.filter((c: any) => c.method === 'POST').length;
    await assert.rejects(
      p5(f).execute(
        r.get(e.execution_id),
        { packageHash: p.contentHash, accountId: account },
        {
          contentHash: f.render.contentHash,
          videoRenderId: f.render.videoRenderId,
        },
      ),
      { code: 'SOCIAL_PUBLICATION_IDENTITY_CONFLICT' },
    );
    assert.equal(f.calls.filter((c: any) => c.method === 'POST').length, posts);
  }));
import { PublishingModule } from './publishing.module.js';
import {
  PUBLISHING_DATABASE,
  SOCIAL_HISTORY_DATABASE,
} from './infrastructure/publishing.persistence.js';
import { MediaService } from '../media/application/media.service.js';
import { AFFILIATE_REPOSITORY } from '../affiliate/application/ports/affiliate-repository.port.js';
import { AFFILIATE_RUN_CONTEXT } from '../affiliate/application/ports/affiliate-run-context.port.js';

test('P5 Nest module selects explicit fake configuration and exposes durable receipt over HTTP', () =>
  fixture(async (f: any) => {
    const { r, e, input, handoff } = scheduleP5(f);
    r.claim(e.execution_id, new Date().toISOString(), 60000);
    vi.stubEnv('INSTAGRAM_PUBLICATION_MODE', 'fake');
    vi.stubEnv('INSTAGRAM_ACCOUNT_ID', account);
    vi.stubEnv('INSTAGRAM_API_VERSION', 'v25.0');
    const module = await Test.createTestingModule({
      imports: [PublishingModule],
    })
      .overrideProvider(PUBLISHING_DATABASE)
      .useValue(f.path)
      .overrideProvider(SOCIAL_HISTORY_DATABASE)
      .useValue(f.path)
      .overrideProvider(MediaService)
      .useValue({
        getVideoRender: f.evidence.getVideoRender,
        verifyMedia: f.evidence.verifyMedia,
        report: f.evidence.getQualityControlReport,
      })
      .overrideProvider(AFFILIATE_REPOSITORY)
      .useValue({
        open: () => ({
          getCampaign: (id: string, rev: number) =>
            f.catalog.getCampaign(id, rev),
          getProduct: (id: string, rev: number) =>
            f.catalog.getProduct(id, rev),
          close() {},
        }),
      })
      .overrideProvider(AFFILIATE_RUN_CONTEXT)
      .useValue({
        resolveRunBriefing: (...args: any[]) =>
          f.catalog.resolveRunBriefing(...args),
      })
      .compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const result = await app
        .get(InstagramPublicationService)
        .execute(r.get(e.execution_id), input, handoff);
      const receipt = await request(app.getHttpServer())
        .get(
          `/publishing/social-operations/${encodeURIComponent(result.operationId)}`,
        )
        .expect(200);
      assert.equal(receipt.body.executionMode, 'fake');
      assert.match(receipt.body.remoteReceipt.permalink, /fake_/);
      const review = f.manual.getReview(input.packageHash);
      await request(app.getHttpServer())
        .post('/publishing/approval-revocations')
        .send({
          packageHash: input.packageHash,
          reviewHash: review.contentHash,
          actor: 'operator',
          reason: 'Withdraw approved package',
        })
        .expect(201);
    } finally {
      await app.close();
      vi.unstubAllEnvs();
    }
  }));
