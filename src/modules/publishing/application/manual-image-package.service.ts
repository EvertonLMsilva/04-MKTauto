import { createHash } from 'node:crypto';
import {
  affiliateHash,
  immutable,
  rejectAffiliateDynamicPrice,
  validateAffiliateCampaign,
  validateAffiliateProduct,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  validateMediaRightsEvidence,
  assertMediaProcessingRights,
} from '../../media/domain/media-processing-rights.js';
import { inspectMvpPng } from '../../media/infrastructure/physical-media-inspection.js';
import {
  exact,
  publicText,
  hashValue,
  timestamp,
} from '../domain/manual-distribution-contracts.js';
import {
  instagramCaption,
  facebookCaption,
} from '../domain/social-publication-contracts.js';
import {
  MANUAL_IMAGE_PACKAGE_VERSION,
  ManualImageError,
  imageFail,
  manualImagePackageHash,
  validateManualImageInput,
  type ImageArtifact,
  type ImagePhysicalProperties,
  type ManualImagePackage,
  type ImageBlockerCode,
} from '../domain/manual-image-package-contracts.js';
type Read<T> = T | Promise<T>;
export interface ManualImageReaders {
  getCampaign(id: string, revision: number): Read<unknown>;
  getProduct(id: string, revision: number): Read<unknown>;
  getProject(
    id: string,
    version: number,
  ): Read<{ id: string; version: number } | null>;
  getRun(id: string): Read<{
    pipelineRunId: string;
    projectId: string;
    projectVersion: number;
    campaignId: string;
    campaignRevision: number;
  } | null>;
  getImage(id: string): Read<ImageArtifact | null>;
  readImageBytes(reference: string): Read<Uint8Array | null>;
  // Trusted physical decoder supplied by the host, not user metadata. No default
  // decoder/API dispatch or inferred JPEG dimensions. It must decode all bytes.
  inspectImage(bytes: Buffer): Read<ImagePhysicalProperties>;
  getDestination(
    destination: string,
    account: string,
  ): Read<{
    destination: string;
    account: string;
    projectId: string;
    enabled: boolean;
  } | null>;
  getImageQc(id: string, hash: string): Read<unknown>;
  getImageApproval(packageHash: string): Read<unknown>;
}
const nextAction = (code: ImageBlockerCode) =>
  code === 'IMAGE_QC_REQUIRED'
    ? 'PROVIDE_EXACT_IMAGE_QC'
    : code === 'HUMAN_APPROVAL_REQUIRED'
      ? 'REVIEW_EXACT_IMAGE_PACKAGE'
      : code === 'IMAGE_RIGHTS_REQUIRED'
        ? 'DOCUMENT_IMAGE_RIGHTS'
        : 'REVIEW_IMAGE_PACKAGE_INPUT';

export class ManualImagePackageService {
  constructor(private readonly readers: ManualImageReaders) {}
  async prepare(raw: unknown) {
    try {
      const input = validateManualImageInput(raw);
      let campaign, product;
      try {
        campaign = validateAffiliateCampaign(
          await this.readers.getCampaign(
            input.campaignId,
            input.campaignRevision,
          ),
        );
        product = validateAffiliateProduct(
          await this.readers.getProduct(input.productId, input.productRevision),
        );
      } catch {
        imageFail('CAMPAIGN_PRODUCT_MISMATCH');
      }
      if (
        campaign.campaignId !== input.campaignId ||
        campaign.revision !== input.campaignRevision ||
        affiliateHash(campaign) !== input.campaignHash ||
        product.productId !== input.productId ||
        product.revision !== input.productRevision ||
        affiliateHash(product) !== input.productHash ||
        campaign.productId !== product.productId ||
        campaign.productRevision !== product.revision ||
        campaign.projectId !== input.projectId
      )
        imageFail('CAMPAIGN_PRODUCT_MISMATCH');
      const project = await this.readers.getProject(
        input.projectId,
        input.projectVersion,
      );
      if (
        project?.id !== input.projectId ||
        project.version !== input.projectVersion
      )
        imageFail('CAMPAIGN_PRODUCT_MISMATCH');
      if (input.pipelineRunId !== null) {
        const run = await this.readers.getRun(input.pipelineRunId);
        if (
          !run ||
          run.pipelineRunId !== input.pipelineRunId ||
          run.projectId !== input.projectId ||
          run.projectVersion !== input.projectVersion ||
          run.campaignId !== input.campaignId ||
          run.campaignRevision !== input.campaignRevision
        )
          imageFail('CAMPAIGN_PRODUCT_MISMATCH');
      }
      try {
        rejectAffiliateDynamicPrice(input.caption, 'caption');
      } catch {
        imageFail('IMAGE_PRICE_UNSUPPORTED');
      }
      try {
        (input.destination === 'instagram'
          ? instagramCaption
          : facebookCaption)({
          caption: input.caption,
          cta: campaign.cta,
          disclosure: campaign.disclosure,
          link: campaign.affiliateUrl,
        });
      } catch {
        imageFail('IMAGE_CONTENT_INVALID');
      }
      const target = await this.readers.getDestination(
        input.destination,
        input.account,
      );
      if (
        !target?.enabled ||
        target.destination !== input.destination ||
        target.account !== input.account ||
        target.projectId !== input.projectId
      )
        imageFail('IMAGE_DESTINATION_INVALID');
      const found = await this.readers.getImage(input.imageArtifactId);
      if (!found) imageFail('IMAGE_NOT_FOUND');
      const image = immutable(found);
      if (
        image.imageArtifactId !== input.imageArtifactId ||
        image.imageContentHash !== input.imageContentHash ||
        image.mediaReference !== input.mediaReference ||
        image.productId !== input.productId ||
        image.productRevision !== input.productRevision ||
        image.projectId !== input.projectId ||
        image.projectVersion !== input.projectVersion ||
        image.format !== input.format ||
        image.widthPixels !== input.widthPixels ||
        image.heightPixels !== input.heightPixels
      )
        imageFail('CAMPAIGN_PRODUCT_MISMATCH');
      let rightsReferences: ManualImagePackage['rightsReferences'];
      try {
        if (
          image.rightsEvidence.some(
            (e) =>
              !product.evidence.some(
                (p) => affiliateHash(p) === affiliateHash(e),
              ),
          )
        )
          imageFail('IMAGE_RIGHTS_REQUIRED');
        if (
          !product.media.some(
            (m) =>
              m.mediaRef === input.mediaReference &&
              image.rightsEvidence.some(
                (e) =>
                  (e as any).id === m.evidenceRef &&
                  affiliateHash(e) ===
                    affiliateHash(
                      product.evidence.find((p) => p.id === m.evidenceRef),
                    ),
              ),
          )
        )
          imageFail('IMAGE_RIGHTS_REQUIRED');
        validateMediaRightsEvidence(image.rightsEvidence, {
          mediaRef: input.mediaReference,
          contentHash: input.imageContentHash,
        });
        const scope = {
          mediaRef: input.mediaReference,
          contentHash: input.imageContentHash,
        };
        const context = {
          campaignId: input.campaignId,
          purpose: 'MANUAL_IMAGE_DISTRIBUTION',
        };
        assertMediaProcessingRights(
          image.rightsEvidence,
          scope,
          null,
          input.imageArtifactId,
          context,
        );
        if (input.externalProvider !== null)
          assertMediaProcessingRights(
            image.rightsEvidence,
            scope,
            input.externalProvider,
            input.imageArtifactId,
            context,
          );
        rightsReferences = image.rightsEvidence.map((e: any) => {
          publicText(e.id, 'rightsId');
          publicText(e.sourceRef, 'rightsReference');
          return {
            id: e.id as string,
            sourceRef: e.sourceRef as string,
            evidenceHash: affiliateHash(e),
          };
        });
      } catch {
        imageFail('IMAGE_RIGHTS_REQUIRED');
      }
      const source = await this.readers.readImageBytes(input.mediaReference);
      if (!source) imageFail('IMAGE_NOT_FOUND');
      if (
        !(source instanceof Uint8Array) ||
        source.byteLength < 1 ||
        source.byteLength > 20971520
      )
        imageFail('IMAGE_PHYSICAL_INVALID');
      const bytes = Buffer.from(source);
      if (
        createHash('sha256').update(bytes).digest('hex') !==
        input.imageContentHash
      )
        imageFail('IMAGE_HASH_MISMATCH');
      try {
        if (input.format === 'png') inspectMvpPng(bytes, input);
        else if (
          bytes[0] !== 255 ||
          bytes[1] !== 216 ||
          bytes[bytes.length - 2] !== 255 ||
          bytes[bytes.length - 1] !== 217
        )
          imageFail('IMAGE_PHYSICAL_INVALID');
        const physical = await this.readers.inspectImage(Buffer.from(bytes));
        if (
          physical.fullyDecoded !== true ||
          physical.format !== input.format ||
          physical.widthPixels !== input.widthPixels ||
          physical.heightPixels !== input.heightPixels
        )
          imageFail('IMAGE_PHYSICAL_INVALID');
      } catch {
        imageFail('IMAGE_PHYSICAL_INVALID');
      }
      let qc: any = null;
      try {
        const supplied = await this.readers.getImageQc(
          input.imageArtifactId,
          input.imageContentHash,
        );
        if (supplied) qc = immutable(supplied);
      } catch {
        /* An unavailable QC reader is not QC evidence. */
      }
      let qcPass = false;
      try {
        exact(qc, [
          'schemaVersion',
          'reportId',
          'imageArtifactId',
          'imageContentHash',
          'productId',
          'productRevision',
          'format',
          'widthPixels',
          'heightPixels',
          'result',
          'policyVersion',
          'evidenceReference',
          'contentHash',
        ]);
        publicText(qc.reportId, 'reportId');
        publicText(qc.policyVersion, 'policyVersion');
        publicText(qc.evidenceReference, 'evidenceReference');
        hashValue(qc.contentHash, 'qcHash');
        qcPass =
          qc.schemaVersion === 'manual-image-qc/1.0.0' &&
          qc.result === 'PASS' &&
          affiliateHash(qc) === qc.contentHash &&
          qc.imageArtifactId === input.imageArtifactId &&
          qc.imageContentHash === input.imageContentHash &&
          qc.productId === input.productId &&
          qc.productRevision === input.productRevision &&
          qc.format === input.format &&
          qc.widthPixels === input.widthPixels &&
          qc.heightPixels === input.heightPixels;
      } catch {
        /* Absent, invalid or insufficient evidence remains required. */
      }
      const body: Omit<ManualImagePackage, 'packageHash' | 'review'> = {
        ...input,
        schemaVersion: MANUAL_IMAGE_PACKAGE_VERSION,
        sizeBytes: bytes.length,
        cta: campaign.cta,
        disclosure: campaign.disclosure,
        affiliateUrl: campaign.affiliateUrl,
        rightsReferences,
        qualityControl: {
          status: qcPass ? 'PASS' : 'IMAGE_QC_REQUIRED',
          reportId: qcPass ? qc.reportId : null,
          contentHash: qcPass ? qc.contentHash : null,
        },
      };
      const packageHash = manualImagePackageHash(body);
      let reviewHash: string | null = null;
      if (qcPass) {
        let review: any = null;
        try {
          const supplied = await this.readers.getImageApproval(packageHash);
          if (supplied) review = immutable(supplied);
          exact(review, [
            'schemaVersion',
            'decisionId',
            'actor',
            'packageHash',
            'imageArtifactId',
            'imageContentHash',
            'qualityControlHash',
            'decision',
            'reviewedAt',
            'revoked',
            'contentHash',
          ]);
          publicText(review.decisionId, 'decisionId');
          publicText(review.actor, 'actor', 100);
          timestamp(review.reviewedAt, 'reviewedAt');
          hashValue(review.contentHash, 'reviewHash');
          if (
            review.schemaVersion === 'manual-image-review/1.0.0' &&
            review.decision === 'APPROVED' &&
            review.revoked === false &&
            review.packageHash === packageHash &&
            review.imageArtifactId === input.imageArtifactId &&
            review.imageContentHash === input.imageContentHash &&
            review.qualityControlHash === qc.contentHash &&
            affiliateHash(review) === review.contentHash
          )
            reviewHash = review.contentHash;
        } catch {
          /* No video/other-image review is implicitly accepted. */
        }
      }
      const blockers: ImageBlockerCode[] = [
        ...(qcPass ? [] : ['IMAGE_QC_REQUIRED' as const]),
        ...(reviewHash ? [] : ['HUMAN_APPROVAL_REQUIRED' as const]),
      ];
      return immutable({
        status: 'PREPARED' as const,
        package: {
          ...body,
          packageHash,
          review: {
            status: reviewHash
              ? ('APPROVED' as const)
              : ('HUMAN_APPROVAL_REQUIRED' as const),
            contentHash: reviewHash,
          },
        },
        blockers: blockers.map((code) => ({
          code,
          nextAction: nextAction(code),
        })),
        publicationAuthorized: false as const,
        nextDependency:
          'IMAGE_PACKAGE_PERSISTENCE_AND_EXACT_HUMAN_DECISION' as const,
      });
    } catch (error) {
      const code =
        error instanceof ManualImageError
          ? error.code
          : 'IMAGE_EVIDENCE_UNAVAILABLE';
      return immutable({
        status: 'BLOCKED' as const,
        package: null,
        blockers: [{ code, nextAction: nextAction(code) }],
        publicationAuthorized: false as const,
        nextDependency:
          'IMAGE_PACKAGE_PERSISTENCE_AND_EXACT_HUMAN_DECISION' as const,
      });
    }
  }
}
