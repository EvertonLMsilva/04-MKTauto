import { HumanApprovalService } from './human-approval.service.js';
import { validateHumanApprovalIdentity } from '../domain/human-approval-contracts.js';
import { manualReleaseHandoff } from './manual-release-handoff.js';
import type { CampaignOperationalFacts } from '../../content-operations/application/campaign-operations.port.js';
import {
  assertPackageApprovalBinding,
  assertPublicationHandoff,
} from './publication-handoff.js';
import {
  affiliateHash,
  rejectAffiliateDynamicPrice,
  affiliateBrandName,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  distributionFail as fail,
  exact,
  hashValue,
  publicText,
  https,
  timestamp,
  seal,
  validatePrepare,
  validatePublication,
  validateResults,
} from '../domain/manual-distribution-contracts.js';
export class ManualDistributionService {
  [key: string]: any;
  constructor({
    repository,
    evidence,
    now = (): any => new Date().toISOString(),
  }: any) {
    if (
      !repository?.command ||
      !evidence ||
      ['getVideoRender', 'getQualityControlReport', 'verifyMedia'].some(
        (k: any): any => typeof evidence[k] !== 'function',
      )
    )
      throw new TypeError(
        'distribution persistence and evidence ports required',
      );
    Object.assign(this, { repository, evidence, now });
  }
  prepare(raw: any, key: any): any {
    const v: any = validatePrepare(raw),
      repo: any = this.repository;
    rejectAffiliateDynamicPrice(v.caption, 'caption');
    return repo.command('PACKAGE', v, key, (): any => {
      const campaign: any = repo.catalog.getCampaign(
        v.campaignId,
        v.campaignRevision,
      );
      if (!campaign) fail('DISTRIBUTION_CAMPAIGN_NOT_FOUND');
      publicText(campaign.cta, 'cta');
      publicText(campaign.disclosure, 'disclosure');
      https(campaign.affiliateUrl, 'affiliateUrl');
      const product: any = repo.catalog.getProduct(
          campaign.productId,
          campaign.productRevision,
        ),
        r: any = this.evidence.getVideoRender(v.videoRenderId),
        q: any = this.evidence.getQualityControlReport(
          v.qualityControlReportId,
        );
      if (!r || !q) fail('DISTRIBUTION_ARTIFACT_NOT_FOUND');
      const identity: any = validateHumanApprovalIdentity({
        projectId: r.projectId,
        projectVersion: r.projectVersion,
        pipelineRunId: r.pipelineRunId,
        videoRenderId: r.videoRenderId,
        videoRenderRevision: r.revision,
        videoRenderContentHash: r.contentHash,
        qualityControlReportId: q.qualityControlReportId,
        qualityControlReportContentHash: q.contentHash,
      });
      const briefing: any = repo.catalog.resolveRunBriefing(r.pipelineRunId);
      if (
        campaign.projectId !== r.projectId ||
        briefing?.campaignId !== campaign.campaignId ||
        briefing.campaignRevision !== campaign.revision
      )
        fail('DISTRIBUTION_CAMPAIGN_BINDING_MISMATCH');
      const p: any = seal({
        schemaVersion: 'manual-publication-package/1.0.0',
        campaignId: campaign.campaignId,
        campaignRevision: campaign.revision,
        campaignHash: affiliateHash(campaign),
        productId: product.productId,
        productRevision: product.revision,
        productHash: affiliateHash(product),
        productName: product.name,
        platform: v.platform,
        account: v.account,
        identity,
        mediaReference: r.logicalReference,
        caption: v.caption,
        cta: campaign.cta,
        disclosure: campaign.disclosure,
        link: campaign.affiliateUrl,
        rightsEvidence: product.evidence,
        originRights: r.origin?.rights ?? null,
        qualityControl: q,
        commercialApprovalRequired: true,
      });
      return repo.put('PACKAGE', p.contentHash, p);
    });
  }
  getPackage(hash: any): any {
    hashValue(hash, 'packageHash');
    return this.repository.get('PACKAGE', hash);
  }
  #package(hash: any): any {
    const p: any = this.getPackage(hash);
    if (!p) fail('DISTRIBUTION_PACKAGE_NOT_FOUND');
    return p;
  }
  #gate(p: any): any {
    const repo: any = this.repository,
      c: any = repo.catalog.getCampaign(p.campaignId, p.campaignRevision),
      product: any = repo.catalog.getProduct(p.productId, p.productRevision);
    if (
      !c ||
      !product ||
      affiliateHash(c) !== p.campaignHash ||
      affiliateHash(product) !== p.productHash
    )
      fail('DISTRIBUTION_CAMPAIGN_CHANGED');
    // Internal demonstration remains ineligible even if a fixture claims commercial rights.
    if (
      [
        p.campaignId,
        p.productId,
        p.productName,
        affiliateBrandName(product),
      ].some((v: any): any => /aura[\s_-]*one/i.test(v))
    )
      fail('DISTRIBUTION_DEMO_INELIGIBLE');
    const r: any = this.evidence.getVideoRender(p.identity.videoRenderId),
      q: any = this.evidence.getQualityControlReport(
        p.identity.qualityControlReportId,
      );
    if (
      r?.origin?.sourceContentHash ===
        'b9c51d26a9dc35e3048ba3bac3fdc6b0baa4d6397022b8310c89bee963a59dd0' ||
      r?.origin?.generationRequestId === 'live_01_aura_video_1'
    )
      fail('DISTRIBUTION_DEMO_INELIGIBLE');
    if (
      !r ||
      !q ||
      r.contentHash !== p.identity.videoRenderContentHash ||
      r.revision !== p.identity.videoRenderRevision ||
      r.logicalReference !== p.mediaReference
    )
      fail('DISTRIBUTION_MEDIA_CHANGED');
    if (
      r.projectId !== p.identity.projectId ||
      r.projectVersion !== p.identity.projectVersion ||
      r.pipelineRunId !== p.identity.pipelineRunId
    )
      fail('DISTRIBUTION_MEDIA_CHANGED');
    if (
      q.contentHash !== p.identity.qualityControlReportContentHash ||
      q.videoRenderId !== r.videoRenderId ||
      q.videoRenderContentHash !== r.contentHash ||
      q.projectId !== r.projectId ||
      q.projectVersion !== r.projectVersion ||
      q.pipelineRunId !== r.pipelineRunId
    )
      fail('DISTRIBUTION_QC_BINDING_MISMATCH');
    if (q.result !== 'PASS' || q.approvalBlocked !== false)
      fail('DISTRIBUTION_QC_FAILED');
    if (
      q.evidence?.publicationAuthorization?.grant?.scope?.mode === 'fake' &&
      p.platform !== 'instagram'
    )
      fail('DISTRIBUTION_DESTINATION_RIGHTS_REQUIRED');
    const rightsCodes: any =
      q.schemaVersion === 'quality-control-report/1.0.0'
        ? ['MEDIA_RIGHTS_VALID', 'VOICE_RIGHTS_VALID']
        : ['COMMERCIAL_RIGHTS', 'PROCESSING_RIGHTS', 'NARRATION_RIGHTS'];
    if (
      rightsCodes.some(
        (code: any): any =>
          !q.findings?.some(
            (f: any): any => f.code === code && f.status === 'PASS',
          ) ||
          q.findings.some(
            (f: any): any => f.code === code && f.status !== 'PASS',
          ),
      ) ||
      r.origin?.rights?.commercialUseAuthorized === false
    )
      fail('DISTRIBUTION_RIGHTS_REQUIRED');
    if (this.evidence.verifyMedia(r.logicalReference) !== r.contentHash)
      fail('DISTRIBUTION_MEDIA_CHANGED');
    return { r, q };
  }
  review(v: any, key: any): any {
    exact(v, ['packageHash', 'decision', 'actor', 'justification']);
    hashValue(v.packageHash, 'packageHash');
    return this.repository.command(
      'REVIEW',
      v,
      key,
      (): any => {
        const p: any = this.#package(v.packageHash);
        // Scope the existing approval service to this complete package. Legacy media
        // decisions stay untouched; envelope hash binds destination, copy and rights.
        const repo: any = this.repository,
          port: any = {
            getVideoRender: (id: any): any => this.evidence.getVideoRender(id),
            getQualityControlReport: (id: any): any =>
              this.evidence.getQualityControlReport(id),
            getHumanApprovalDecision: (): any =>
              repo.get('REVIEW', p.contentHash)?.mediaDecision ?? null,
            findApprovedHumanApprovalDecision: (): any => null,
            registerHumanApprovalDecision: (mediaDecision: any): any =>
              mediaDecision,
          };
        const mediaDecision: any = new HumanApprovalService({
          repository: port,
          now: this.now,
        }).decide({
          ...p.identity,
          decision: v.decision,
          actor: v.actor,
          justification: v.justification,
        });
        return repo.put(
          'REVIEW',
          p.contentHash,
          seal({
            schemaVersion: 'manual-package-review/1.0.0',
            packageHash: p.contentHash,
            mediaDecision,
          }),
        );
      },
      (): any => {
        if (v.decision === 'APPROVED') this.#gate(this.#package(v.packageHash));
      },
    );
  }
  getReview(hash: any): any {
    hashValue(hash, 'packageHash');
    return this.repository.get('REVIEW', hash);
  }
  // Shared read-only gates for official publishing; never creates approval or a
  // manual publication record. Revalidate on every external mutation.
  revokeApproval(value: unknown) {
    return this.repository.revokeApproval(value, this.now());
  }
  validateForPublication(hash: any, handoff?: CampaignOperationalFacts): any {
    const p: any = this.#package(hash);
    const { q } = this.#gate(p);
    const review = this.getReview(hash);
    if (
      Number(
        this.repository.db.prepare('PRAGMA user_version').get()?.user_version,
      ) >= 42 &&
      review &&
      this.repository.isApprovalRevoked(review.contentHash)
    )
      fail('DISTRIBUTION_APPROVAL_REVOKED');
    if (review?.mediaDecision.decision !== 'APPROVED')
      fail('DISTRIBUTION_APPROVAL_REQUIRED');
    assertPackageApprovalBinding(p, review);
    if (handoff) assertPublicationHandoff(handoff, p, q);
    return p;
  }
  manualHandoff(hash: string) {
    const pkg = this.validateForPublication(hash);
    if (pkg.contentHash !== hash || affiliateHash(pkg) !== hash)
      fail('DISTRIBUTION_PERSISTED_INTEGRITY');
    return manualReleaseHandoff(pkg, this.getReview(hash));
  }
  recordPublication(raw: any, key: any): any {
    const v: any = validatePublication(raw);
    return this.repository.command(
      'PUBLICATION',
      v,
      key,
      (): any => {
        const p: any = this.#package(v.packageHash);
        if (
          p.qualityControl?.evidence?.publicationAuthorization?.grant?.scope
            ?.mode === 'fake'
        )
          fail('DISTRIBUTION_FAKE_ONLY');
        const review: any = this.getReview(p.contentHash);
        if (review?.mediaDecision.decision !== 'APPROVED')
          fail('DISTRIBUTION_APPROVAL_REQUIRED');
        if (v.externalUrl !== null) {
          const host: any = new URL(v.externalUrl).hostname.toLowerCase(),
            domains: any = (
              {
                instagram: ['instagram.com'],
                facebook: ['facebook.com', 'fb.watch'],
                threads: ['threads.net', 'threads.com'],
                tiktok: ['tiktok.com'],
                youtube: ['youtube.com', 'youtu.be'],
              } as Record<string, string[]>
            )[p.platform];
          if (
            !domains.some((d: any): any => host === d || host.endsWith(`.${d}`))
          )
            fail('DISTRIBUTION_EXTERNAL_DESTINATION_MISMATCH');
        }
        const existing: any = this.listPublications(p.contentHash)[0];
        if (existing) {
          for (const k of Object.keys(v))
            if (existing[k] !== v[k]) fail('DISTRIBUTION_PUBLICATION_CONFLICT');
          return existing;
        }
        const pub: any = seal({
          schemaVersion: 'manual-publication/1.0.0',
          publicationId: `manual_publication:${p.contentHash}`,
          ...v,
          platform: p.platform,
          account: p.account,
          campaignId: p.campaignId,
          campaignRevision: p.campaignRevision,
          reviewHash: review.contentHash,
          recordedAt: timestamp(this.now(), 'recordedAt'),
        });
        return this.repository.put('PUBLICATION', pub.publicationId, pub);
      },
      (): any => this.validateForPublication(v.packageHash),
    );
  }
  getPublication(id: any): any {
    publicText(id, 'publicationId');
    return this.repository.get('PUBLICATION', id);
  }
  listPublications(hash: any): any {
    return this.repository.list('PUBLICATION', hash);
  }
  recordResults(raw: any, key: any): any {
    const v: any = validateResults(raw);
    return this.repository.command('RESULTS', v, key, (): any => {
      const pub: any = this.getPublication(v.publicationId);
      if (!pub || pub.state !== 'PUBLISHED')
        fail('DISTRIBUTION_CONFIRMED_PUBLICATION_REQUIRED');
      const identity: any = affiliateHash({
        publicationId: v.publicationId,
        periodStart: v.periodStart,
        periodEnd: v.periodEnd,
        sourceReference: v.sourceReference,
        attribution: v.attribution,
      });
      const prior: any = this.repository.get('RESULTS', identity);
      if (prior) {
        for (const k of Object.keys(v))
          if (JSON.stringify(prior[k]) !== JSON.stringify(v[k]))
            fail('DISTRIBUTION_RESULTS_CONFLICT');
        return prior;
      }
      return this.repository.put(
        'RESULTS',
        identity,
        seal({
          schemaVersion: 'manual-commercial-results/1.0.0',
          ...v,
          packageHash: pub.packageHash,
          campaignId: pub.campaignId,
          campaignRevision: pub.campaignRevision,
          recordedAt: timestamp(this.now(), 'recordedAt'),
        }),
      );
    });
  }
  listResults(publicationId: any): any {
    const pub: any = this.getPublication(publicationId);
    if (!pub) fail('DISTRIBUTION_PUBLICATION_NOT_FOUND');
    return this.repository
      .list('RESULTS', pub.packageHash)
      .filter((r: any): any => r.publicationId === publicationId);
  }
}
