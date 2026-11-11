import {
  operationalQcIdentity,
  assertQcReviewer,
} from './local-qc-identity.js';
import { adaptationHash } from '../../media/domain/media-hash.js';
import {
  p4ReportHash,
  temporalReportId,
  temporalResult,
  validateTemporalReport,
} from '../../media/domain/p4-qc-contracts.js';
import {
  HUMAN_APPROVAL_DECISION_VERSION,
  HUMAN_APPROVAL_DECISIONS,
  humanApprovalDecisionContentHash,
  humanApprovalDecisionId,
  validateHumanApprovalDecision,
  validateHumanApprovalIdentity,
} from '../domain/human-approval-contracts.js';
const REQUEST_FIELDS: any = Object.freeze([
  'projectId',
  'projectVersion',
  'pipelineRunId',
  'videoRenderId',
  'videoRenderRevision',
  'videoRenderContentHash',
  'qualityControlReportId',
  'qualityControlReportContentHash',
  'decision',
  'actor',
  'justification',
]);
export class HumanApprovalError extends Error {
  [key: string]: any;
  constructor(code: any, field: any, message: any, options?: any) {
    super(`${code}: ${message}`, options);
    this.name = 'HumanApprovalError';
    this.code = code;
    this.field = field;
    this.publicMessage = message;
  }
}
export class HumanApprovalService {
  /** Semantic attestation only. The repository supplies independently verified
   * technical evidence and rights; no caller can submit technical PASS here. */
  static async reviewTemporal(context: {
    input: any;
    principal: unknown;
    automatic: any;
    asset: any;
    reference: any;
    technical: any;
    referenceTechnical: any;
    rightsScope?: {
      campaignId: string;
      operationScope: string;
      purpose: string;
    } | null;
  }) {
    const reviewer = assertQcReviewer(context.principal);
    operationalQcIdentity.assertActive(reviewer);
    const {
      input: request,
      asset,
      reference,
      automatic,
      technical,
      referenceTechnical,
    } = context;
    const invalid = () => {
      throw failure(
        'HUMAN_APPROVAL_REVIEW_INVALID',
        'review',
        'revisão inválida',
      );
    };
    if (
      !request ||
      Object.keys(request).sort().join(',') !==
        'automaticReportHash,criteria,decision,mediaAssetId,mediaContentHash,mediaRevision,referenceImage,schemaVersion' ||
      request.schemaVersion !== 'human-temporal-review-request/1.0.0' ||
      !['APPROVED', 'REJECTED'].includes(request.decision)
    )
      invalid();
    if (
      !request.referenceImage ||
      Object.keys(request.referenceImage).sort().join(',') !==
        'contentHash,mediaAssetId,revision'
    )
      invalid();
    if (
      request.mediaAssetId !== asset.mediaAssetId ||
      request.mediaContentHash !== asset.contentHash ||
      request.mediaRevision !== asset.revision ||
      request.automaticReportHash !== automatic.contentHash ||
      request.referenceImage?.mediaAssetId !== reference.mediaAssetId ||
      request.referenceImage.contentHash !== reference.contentHash ||
      request.referenceImage.revision !== reference.revision
    )
      throw failure(
        'HUMAN_APPROVAL_VIDEO_BINDING_MISMATCH',
        'review',
        'revisão não corresponde aos artefatos exatos',
      );
    if (
      referenceTechnical?.schemaVersion !== 'reference-image-analysis/1.0.0' ||
      referenceTechnical.validator !== 'offline-temporal-ffmpeg' ||
      referenceTechnical.version !== automatic.evidence.provenance?.version ||
      referenceTechnical.contentHash !== reference.contentHash ||
      referenceTechnical.policyHash !==
        adaptationHash(technical.parameters?.policy) ||
      referenceTechnical.width !== reference.technicalProperties.widthPixels ||
      referenceTechnical.height !==
        reference.technicalProperties.heightPixels ||
      !/^[a-f0-9]{64}$/.test(referenceTechnical.frameHash) ||
      technical.schemaVersion !== 'offline-temporal-analysis/1.1.0' ||
      technical.validator !== 'offline-temporal-ffmpeg' ||
      adaptationHash(technical.identity) !==
        adaptationHash(automatic.identity) ||
      technical.version !== automatic.evidence.provenance?.version ||
      adaptationHash(technical.parameters) !==
        adaptationHash(automatic.evidence.provenance?.parameters) ||
      asset.technicalProperties.widthPixels !== technical.metadata.width ||
      asset.technicalProperties.heightPixels !== technical.metadata.height ||
      Math.abs(
        asset.technicalProperties.durationMilliseconds -
          technical.metadata.duration * 1000,
      ) >
        1000 / technical.metadata.fps ||
      technical.measurements.decodedFrames < 2 ||
      technical.measurements.sampleCount < 2 ||
      automatic.evidence.provenance?.validator !== 'offline-temporal-ffmpeg'
    )
      throw failure(
        'HUMAN_APPROVAL_TECHNICAL_REQUIRED',
        'review',
        'evidência técnica independente obrigatória',
      );
    if (
      request.decision === 'APPROVED' &&
      ['motion', 'continuity', 'fidelity'].some(
        (criterion) => automatic.evidence[criterion] === 'FAIL',
      )
    )
      throw failure(
        'HUMAN_APPROVAL_QC_FAILED',
        'review',
        'FAIL automático não pode ser substituído',
      );
    if (
      !request.criteria ||
      Object.keys(request.criteria).sort().join(',') !==
        'continuity,fidelity,motion'
    )
      invalid();
    for (const criterion of Object.values(request.criteria) as any[]) {
      if (
        !criterion ||
        Object.keys(criterion).sort().join(',') !==
          'endSeconds,observation,startSeconds' ||
        !Number.isFinite(criterion.startSeconds) ||
        !Number.isFinite(criterion.endSeconds) ||
        criterion.startSeconds < 0 ||
        criterion.endSeconds <= criterion.startSeconds ||
        criterion.endSeconds > technical.metadata.duration
      )
        invalid();
      publicText(criterion.observation, 'observation', 1000);
      if (criterion.observation.length < 10) invalid();
    }
    for (const name of ['continuity', 'fidelity']) {
      if (
        request.criteria[name].startSeconds !== 0 ||
        request.criteria[name].endSeconds !== technical.metadata.duration
      )
        invalid();
    }
    const decisionKey = adaptationHash({
      identity: automatic.identity,
      automaticReportHash: automatic.contentHash,
      assetRevision: asset.revision,
      reference: request.referenceImage,
    });
    const requestHash = adaptationHash({
      request,
      actor: reviewer.id,
      credentialFingerprint: operationalQcIdentity.fingerprint(reviewer),
    });
    const audit = {
      schemaVersion: 'human-temporal-review/1.0.0',
      actor: reviewer.id,
      credentialFingerprint: operationalQcIdentity.fingerprint(reviewer),
      decidedAt: new Date().toISOString(),
      decision: request.decision,
      criteria: request.criteria,
      automaticReportId: automatic.qualityControlReportId,
      automaticReportHash: automatic.contentHash,
      assetRevision: asset.revision,
      assetRightsHash: adaptationHash(asset.rights),
      referenceImage: request.referenceImage,
      referenceRightsHash: adaptationHash(reference.rights),
      referenceTechnical,
      decisionKey,
      requestHash,
      ...(context.rightsScope ? { rightsScope: context.rightsScope } : {}),
    };
    const signature = operationalQcIdentity.signReview(
      reviewer,
      adaptationHash(audit),
    );
    const evidence = {
      ...automatic.evidence,
      motion: request.decision === 'APPROVED' ? 'PASS' : 'FAIL',
      continuity: request.decision === 'APPROVED' ? 'PASS' : 'FAIL',
      fidelity: request.decision === 'APPROVED' ? 'PASS' : 'FAIL',
      motionBasis:
        request.decision === 'APPROVED'
          ? 'SUBJECT_MOTION'
          : automatic.evidence.motionBasis,
      provenance: {
        reference: 'human-review:sha256_' + adaptationHash(audit),
        contentHash: adaptationHash(audit),
        validator: 'authenticated-human-qc',
        version: '1.0.0',
        parameters: { humanReview: audit, signature },
      },
    };
    const report = {
      schemaVersion: 'temporal-quality-control/1.0.0',
      identity: automatic.identity,
      qualityControlReportId: temporalReportId(automatic.identity, evidence),
      evidence,
      result: temporalResult(evidence),
      contentHash: '',
    };
    report.contentHash = p4ReportHash(report);
    return validateTemporalReport(report, automatic.identity);
  }

  [key: string]: any;
  constructor({ repository, now = (): any => new Date().toISOString() }: any) {
    requireMethods(
      repository,
      [
        'getVideoRender',
        'getQualityControlReport',
        'getHumanApprovalDecision',
        'registerHumanApprovalDecision',
        'findApprovedHumanApprovalDecision',
      ],
      'repository',
    );
    this.repository = repository;
    this.now = now;
  }
  decide(value: any): any {
    const request: any = validateRequest(value);
    const id: any = humanApprovalDecisionId(request);
    const prior: any = this.repository.getHumanApprovalDecision(id);
    if (prior) {
      if (sameRequest(prior, request)) return prior;
      throw failure(
        'HUMAN_APPROVAL_DECISION_CONFLICT',
        'decision',
        'já existe decisão divergente para este render e QC',
      );
    }
    const render: any = this.repository.getVideoRender(request.videoRenderId);
    if (
      !render ||
      render.videoRenderId !== request.videoRenderId ||
      render.revision !== request.videoRenderRevision ||
      render.contentHash !== request.videoRenderContentHash ||
      render.pipelineRunId !== request.pipelineRunId ||
      render.projectId !== request.projectId ||
      render.projectVersion !== request.projectVersion
    ) {
      throw failure(
        'HUMAN_APPROVAL_VIDEO_BINDING_MISMATCH',
        'videoRenderId',
        'decisão não corresponde ao render final exato',
      );
    }
    const qc: any = this.repository.getQualityControlReport(
      request.qualityControlReportId,
    );
    if (
      !qc ||
      qc.qualityControlReportId !== request.qualityControlReportId ||
      qc.contentHash !== request.qualityControlReportContentHash ||
      qc.videoRenderId !== request.videoRenderId ||
      qc.videoRenderContentHash !== request.videoRenderContentHash ||
      qc.pipelineRunId !== request.pipelineRunId ||
      qc.projectId !== request.projectId ||
      qc.projectVersion !== request.projectVersion
    ) {
      throw failure(
        'HUMAN_APPROVAL_QC_BINDING_MISMATCH',
        'qualityControlReportId',
        'decisão não corresponde ao QC exato',
      );
    }
    if (
      request.decision === 'APPROVED' &&
      (qc.result === 'FAIL' || qc.approvalBlocked === true)
    ) {
      throw failure(
        'HUMAN_APPROVAL_QC_FAILED',
        'decision',
        'QC com FAIL bloqueia aprovação',
      );
    }
    const decision: any = {
      schemaVersion: HUMAN_APPROVAL_DECISION_VERSION,
      humanApprovalDecisionId: id,
      ...request,
      decidedAt: this.now(),
      contentHash: '',
    };
    decision.contentHash = humanApprovalDecisionContentHash(decision);
    return this.repository.registerHumanApprovalDecision(
      validateHumanApprovalDecision(decision),
    );
  }
  findApproved(value: any): any {
    const identity: any = validateHumanApprovalIdentity(value);
    return this.repository.findApprovedHumanApprovalDecision(identity);
  }
}
export function validateRequest(value: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw failure(
      'HUMAN_APPROVAL_REQUEST_INVALID',
      'request',
      'requisição de decisão inválida',
    );
  for (const key of Object.keys(value))
    if (!REQUEST_FIELDS.includes(key))
      throw failure(
        'HUMAN_APPROVAL_REQUEST_INVALID',
        key,
        'campo não permitido',
      );
  for (const key of REQUEST_FIELDS)
    if (!(key in value))
      throw failure('HUMAN_APPROVAL_REQUEST_INVALID', key, 'campo obrigatório');
  let identity: any;
  try {
    identity = validateHumanApprovalIdentity(value);
  } catch (caught: any) {
    throw failure(
      'HUMAN_APPROVAL_REQUEST_INVALID',
      caught.path ?? 'request',
      'identidade inválida',
      { cause: caught },
    );
  }
  if (!HUMAN_APPROVAL_DECISIONS.includes(value.decision))
    throw failure(
      'HUMAN_APPROVAL_REQUEST_INVALID',
      'decision',
      'decisão inválida',
    );
  publicText(value.actor, 'actor', 100);
  if (value.justification !== null)
    publicText(value.justification, 'justification', 1000);
  if (value.decision === 'REJECTED' && value.justification === null)
    throw failure(
      'HUMAN_APPROVAL_JUSTIFICATION_REQUIRED',
      'justification',
      'informe a justificativa da rejeição',
    );
  return Object.freeze({
    ...identity,
    decision: value.decision,
    actor: value.actor,
    justification: value.justification,
  });
}
function sameRequest(prior: any, request: any): any {
  return REQUEST_FIELDS.every(
    (field: any): any => prior[field] === request[field],
  );
}
function publicText(value: any, field: any, max: any): any {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    /(?:bearer\s+\S+|sk-[a-z0-9_-]{3,}|[?&](?:token|signature|credential|key)=|(?:^|[\\/])users[\\/]|[a-z]:[\\/])/i.test(
      value,
    )
  )
    throw failure(
      'HUMAN_APPROVAL_REQUEST_INVALID',
      field,
      'texto público inválido',
    );
}
function requireMethods(value: any, methods: any, name: any): any {
  if (
    !value ||
    methods.some((method: any): any => typeof value[method] !== 'function')
  )
    throw new TypeError(`${name} obrigatório`);
}
function failure(code: any, field: any, message: any, options?: any): any {
  return new HumanApprovalError(code, field, message, options);
}
