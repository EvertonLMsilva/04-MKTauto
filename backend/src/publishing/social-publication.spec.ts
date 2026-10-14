const { SocialPublicationRepository: awaitedLegacySocial } = await import(
  new URL('../../../src/social-publication-repository.js', import.meta.url).href
);
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { HumanApprovalRepository } = await import(
  new URL('../../../src/human-approval-repository.js', import.meta.url).href
);
const { AffiliateRepository } = await import(
  new URL('../../../src/affiliate-repository.js', import.meta.url).href
);
import { ManualDistributionRepository } from './infrastructure/manual-distribution.repository.js';
import { ManualDistributionService } from './application/manual-distribution.service.js';
import { SocialPublicationRepository } from './infrastructure/social-publication.repository.js';
import { SocialPublicationService } from './application/social-publication.service.js';
const { InstagramPublisherAdapter } = await import(
  new URL('../../../src/adapters/instagram-publisher.js', import.meta.url).href
);
import { createHash } from 'node:crypto';
const { HostedInstagramMediaIntegrity } = await import(
  new URL(
    '../../../src/adapters/hosted-instagram-media-integrity.js',
    import.meta.url,
  ).href
);
const { InstagramHttpTransport } = await import(
  new URL('../../../src/adapters/instagram-http-transport.js', import.meta.url)
    .href
);
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
    const adapter: any = new InstagramPublisherAdapter({
      http: {
        offline: true,
        request: async (request: any): Promise<any> => {
          calls.push({ method: request.method, url: request.url });
          return handler(request);
        },
      },
      accountId: account,
      apiVersion: 'v25.0',
      getAccessToken: (): any => 'FAKE_PRIVATE_TOKEN',
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
    const transferVerifier: any = new HostedInstagramMediaIntegrity({
      mode: 'fake',
      storage,
      now: (): any => at,
    });
    const make: any = (): any => {
      const manual: any = new ManualDistributionService({
        repository: new ManualDistributionRepository(
          base,
          new AffiliateRepository(base),
        ),
        evidence,
        now: (): any => at,
      });
      new awaitedLegacySocial(base);
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
    f.setHandler(({ method, url, body, headers }: any): any => {
      assert.equal(headers.Authorization, 'Bearer FAKE_PRIVATE_TOKEN');
      if (method === 'POST') {
        const persisted: any = f.repository.get(op.operationId);
        assert.equal(
          persisted.state,
          url.endsWith('media_publish') ? 'PUBLISHING' : 'CREATING_CONTAINER',
        );
        if (!url.endsWith('media_publish'))
          assert.equal(
            body.caption,
            [
              'Produto autorizado',
              campaign().cta,
              campaign().disclosure,
              campaign().affiliateUrl,
            ].join('\n\n'),
          );
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
        new InstagramPublisherAdapter({
          http: { request: globalThis.fetch },
          accountId: account,
          apiVersion: 'v25.0',
          getAccessToken: (): any => '',
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
    const livePublisher: any = new InstagramPublisherAdapter({
      http: new InstagramHttpTransport({
        mode: 'live',
        fetchImpl: async (): Promise<any> => {
          calls++;
          throw new Error('unexpected');
        },
      }),
      accountId: account,
      apiVersion: 'v26.0',
      getAccessToken: (): any => 'private',
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
