import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import { fail } from './video-financial-contracts.js';

// One explicitly accepted experiment, not an enforced provider price guarantee.
export function validateFirstFalRisk(r: any, now = new Date().toISOString()) {
  const model = {
    endpoint: 'minimax/h3-max-turbo/image-to-video',
    duration: 5,
    resolution: '768P',
    prompt_expansion_mode: 'disabled',
    enable_safety_checker: true,
  };
  if (
    !r ||
    Object.keys(r).some(
      (key) =>
        ![
          'schemaVersion',
          'operationId',
          'model',
          'mediaRef',
          'imageHash',
          'requestHash',
          'preparationHash',
          'authorizedIdentity',
          'referenceBudgetUsd',
          'nominalUsd',
          'maximumCostGuaranteed',
          'residualOverrunAccepted',
          'maxSubmissions',
          'retries',
          'paidFallback',
          'publicationAllowed',
          'expiresAt',
        ].includes(key),
    ) ||
    r.schemaVersion !== 'fal-first-live-risk/1.0.0' ||
    r.operationId !== 'p77_first_live_i2v' ||
    Object.keys(r.model ?? {}).length !== Object.keys(model).length ||
    affiliateHash(r.model ?? {}) !== affiliateHash(model) ||
    r.imageHash !==
      '131f508980e02439741f65415247ccbe6231a12b1116bb8f2d487c561a5d0719' ||
    typeof r.mediaRef !== 'string' ||
    !r.mediaRef.trim() ||
    !/^[a-f0-9]{64}$/.test(r.requestHash ?? '') ||
    !/^[a-f0-9]{64}$/.test(r.preparationHash ?? '') ||
    r.referenceBudgetUsd !== '0.50' ||
    r.nominalUsd !== '0.13' ||
    r.maximumCostGuaranteed !== false ||
    r.residualOverrunAccepted !== true ||
    r.maxSubmissions !== 1 ||
    r.retries !== 0 ||
    r.paidFallback !== false ||
    r.publicationAllowed !== false ||
    !Number.isFinite(Date.parse(r.expiresAt)) ||
    Date.parse(r.expiresAt) <= Date.parse(now)
  )
    fail('FIRST_FAL_RISK_AUTHORIZATION_INVALID', 'risk');
  affiliateIdentifier(r.authorizedIdentity, 'authorizedIdentity');
  return immutable(structuredClone(r));
}

export function firstFalRiskProof(
  risk: any,
  actor: string,
  planHash: string,
  statement: string,
  now = new Date().toISOString(),
) {
  const r = validateFirstFalRisk(risk, now);
  if (
    actor !== r.authorizedIdentity ||
    !/^[a-f0-9]{64}$/.test(planHash) ||
    typeof statement !== 'string' ||
    statement.trim().length < 10 ||
    statement.length > 2000
  )
    fail('FIRST_FAL_RISK_AUTHORIZATION_INVALID', 'acceptance');
  const body = {
    risk: r,
    riskHash: affiliateHash(r),
    actor,
    planHash,
    statement,
  };
  return {
    ...body,
    kind: 'FIRST_FAL_RISK_ACCEPTED',
    operationId: r.operationId,
    provider: 'fal_ai',
    requestHash: affiliateHash(body),
    currency: 'USD',
    reservationAmount: r.referenceBudgetUsd,
    maximumCostGuaranteed: false,
    expiresAt: r.expiresAt,
    acceptedAt: now,
  };
}

export function validateFirstFalRiskProof(proof: any, now: string) {
  const expected = firstFalRiskProof(
    proof.risk,
    proof.actor,
    proof.planHash,
    proof.statement,
    now,
  );
  if (
    Object.keys(proof).some(
      (key) => ![...Object.keys(expected), 'pipelineRunId'].includes(key),
    )
  )
    fail('FIRST_FAL_RISK_AUTHORIZATION_INVALID', 'proof');
  for (const field of Object.keys(expected)) {
    if (
      field !== 'acceptedAt' &&
      affiliateHash({ value: proof[field] }) !==
        affiliateHash({ value: (expected as any)[field] })
    )
      fail('FIRST_FAL_RISK_AUTHORIZATION_INVALID', field);
  }
  if (
    !Number.isFinite(Date.parse(proof.acceptedAt)) ||
    Date.parse(proof.acceptedAt) > Date.parse(now)
  )
    fail('FIRST_FAL_RISK_AUTHORIZATION_INVALID', 'acceptedAt');
}
