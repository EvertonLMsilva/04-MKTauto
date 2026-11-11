import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { money } from '../../finance/infrastructure/fal-generation.repository.js';
import { falFailure } from '../../finance/domain/fal-errors.js';
import type { FinanceService } from '../../finance/application/finance.service.js';
import { operationalQcIdentity } from '../../publishing/application/local-qc-identity.js';
import { FAL_VIDEO_MODEL, validateFalVideoModel } from '../domain/fal-model.js';
import type {
  FalControl,
  FalTransport,
} from '../application/fal-acquisition.port.js';
import { FalQueueClient } from './fal-queue.js';
import {
  validateFirstFalRisk,
  firstFalRiskProof,
} from '../../finance/domain/first-fal-risk.js';

export const CONTROLLED_FAL_OPERATION = 'p77_first_live_i2v';
export const CONTROLLED_FAL_IMAGE_HASH =
  '131f508980e02439741f65415247ccbe6231a12b1116bb8f2d487c561a5d0719';
const cap = money('0.50');
const scale = money('1');
const project = fileURLToPath(new URL('../../../../', import.meta.url));
function fail(code: string): never {
  throw falFailure(code);
}
const decimal = (value: bigint) => {
  const raw = value.toString().padStart(19, '0');
  return `${raw.slice(0, -18)}.${raw.slice(-18)}`.replace(/\.?0+$/, '');
};

export function validateControlledRisk(plan: any) {
  const risk = validateFirstFalRisk(plan.riskAuthorization);
  validateFalVideoModel(plan.quote?.model);
  if (
    risk.imageHash !== plan.imageHash ||
    risk.mediaRef !== plan.mediaRef ||
    risk.requestHash !== plan.requestHash ||
    risk.preparationHash !== plan.preparationHash ||
    risk.operationId !== plan.operationId ||
    risk.referenceBudgetUsd !== plan.maximumUsd ||
    !plan.authorizedReviewers?.includes(risk.authorizedIdentity) ||
    plan.quote?.webpSupported !== true
  )
    fail('FIRST_FAL_RISK_AUTHORIZATION_INVALID');
  return risk;
}

// Trusted operator configuration, never an HTTP price assertion. A public list price
// alone does not prove the enforceable maximum required by the existing Finance gate.
export function validateControlledQuote(
  q: any,
  now = new Date().toISOString(),
) {
  if (!q) fail('CONTROLLED_FAL_PRICE_UNPROVEN');
  validateFalVideoModel(q.model);
  if (
    q.includesAllCharges !== true ||
    q.maximumEnforced !== true ||
    q.webpSupported !== true ||
    !/^https:\/\/(?:docs\.)?fal\.ai\//.test(q.source ?? '') ||
    !/^[a-zA-Z0-9_.:/-]{3,120}$/.test(q.evidenceReference ?? '') ||
    !Number.isFinite(Date.parse(q.expiresAt)) ||
    Date.parse(q.expiresAt) <= Date.parse(now)
  )
    fail('CONTROLLED_FAL_PRICE_UNPROVEN');
  const seconds = money(q.maximumBillableSeconds);
  // The official schema warns that actual output can exceed requested duration.
  if (seconds < money('5.7') || money(q.unitPriceUsd) <= 0n)
    fail('CONTROLLED_FAL_PRICE_UNPROVEN');
  const total =
    (money(q.unitPriceUsd) * seconds + scale - 1n) / scale +
    money(q.additionalChargesUsd);
  if (total > cap) fail('CONTROLLED_FAL_BUDGET_EXCEEDED');
  return {
    amount: decimal(total),
    currency: 'USD',
    source: q.evidenceReference as string,
  };
}

// Use Finance's atomic RESERVED -> SUBMITTING transition, not an in-memory latch.
// UNKNOWN remains reserved even after a successful acknowledgement: billing is not
// settled by a request id, and neither success nor uncertainty authorizes another POST.
export function singleSubmissionQueue(
  queue: FalTransport,
  finance: FinanceService,
  proof: any,
  beforeSubmit: () => void = () => {},
): FalTransport {
  return {
    async submit(parameters, options) {
      beforeSubmit();
      finance.reserveGlobal(
        {
          ...proof,
          operationId: CONTROLLED_FAL_OPERATION,
          provider: 'fal_ai',
        },
        undefined,
        {
          authorizationMode:
            proof.kind === 'FIRST_FAL_RISK_ACCEPTED'
              ? 'FIRST_FAL_RISK_ACCEPTED'
              : 'AUTOMATIC',
        },
      );
      finance.dispatchGlobal(
        CONTROLLED_FAL_OPERATION,
        new Date().toISOString(),
      );
      try {
        return await queue.submit(parameters, options);
      } finally {
        finance.unknownGlobal(CONTROLLED_FAL_OPERATION);
      }
    },
    status: (id, options) => queue.status(id, options),
    result: (id, options) => queue.result(id, options),
    download: (url, options) => queue.download(url, options),
  };
}

function readPlan(env: NodeJS.ProcessEnv): any {
  const path = env.FAL_CONTROLLED_PLAN_FILE;
  if (!path || !isAbsolute(path)) fail('CONTROLLED_FAL_PLAN_REQUIRED');
  const rel = relative(resolve(project), resolve(path));
  const stat = lstatSync(path);
  if (
    (!rel.startsWith('..') && !isAbsolute(rel)) ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size > 65536 ||
    realpathSync.native(path) !== resolve(path) ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
  )
    fail('CONTROLLED_FAL_PLAN_INVALID');
  const plan = JSON.parse(readFileSync(path, 'utf8'));
  if (
    plan.schemaVersion !== 'controlled-fal-plan/1.0.0' ||
    plan.operationId !== CONTROLLED_FAL_OPERATION ||
    plan.maximumUsd !== '0.50' ||
    plan.maxSubmissions !== 1 ||
    !/^[a-f0-9]{64}$/.test(plan.imageHash ?? '') ||
    !isAbsolute(plan.mediaRef ?? '')
  )
    fail('CONTROLLED_FAL_PLAN_INVALID');
  return plan;
}

function image(plan: any) {
  const stat = lstatSync(plan.mediaRef);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 33554432)
    fail('CONTROLLED_FAL_IMAGE_INVALID');
  const bytes = readFileSync(plan.mediaRef);
  if (
    bytes.subarray(0, 4).toString() !== 'RIFF' ||
    bytes.subarray(8, 12).toString() !== 'WEBP' ||
    createHash('sha256').update(bytes).digest('hex') !== plan.imageHash
  )
    fail('CONTROLLED_FAL_IMAGE_HASH_MISMATCH');
  return bytes;
}

export function createFalControl(
  env: NodeJS.ProcessEnv,
  finance: FinanceService,
  transport?: FalTransport,
): FalControl {
  return {
    readiness() {
      const plan = readPlan(env);
      image(plan);
      const blockers: string[] = ['OPERATIONAL_CONFIRMATION_REQUIRED'];
      if (plan.enabled !== true) blockers.push('CONTROLLED_FAL_DISABLED');
      try {
        if (plan.riskAuthorization) {
          validateControlledRisk(plan);
          blockers.push('FINANCIAL_RISK_CONFIRMATION_REQUIRED');
        } else validateControlledQuote(plan.quote);
      } catch {
        blockers.push('CONTROLLED_FAL_PRICE_UNPROVEN');
      }
      if (!env.FAL_KEY) blockers.push('PROVIDER_CREDENTIAL_REQUIRED');
      if (
        !/^[a-f0-9]{64}$/.test(plan.requestHash ?? '') ||
        !/^[a-f0-9]{64}$/.test(plan.preparationHash ?? '')
      )
        blockers.push('CONTROLLED_FAL_REQUEST_BINDING_REQUIRED');
      return {
        operationId: CONTROLLED_FAL_OPERATION,
        model: FAL_VIDEO_MODEL,
        imageHash: plan.imageHash,
        planHash: affiliateHash(plan),
        maximumUsd: plan.maximumUsd,
        blockers,
        publicationAllowed: false,
      };
    },
    async authorize(input, options) {
      const plan = readPlan(env);
      if (plan.enabled !== true) fail('CONTROLLED_FAL_DISABLED');
      const principal = operationalQcIdentity.assertActive(options.principal);
      const confirmation = options.confirmation as any;
      if (
        !Array.isArray(plan.authorizedReviewers) ||
        !plan.authorizedReviewers.includes(principal.id) ||
        !confirmation ||
        confirmation.confirmed !== true ||
        confirmation.operationId !== plan.operationId ||
        confirmation.requestHash !== input.request.contentHash ||
        confirmation.preparationHash !== input.preparation.contentHash ||
        confirmation.planHash !== affiliateHash(plan) ||
        typeof confirmation.statement !== 'string' ||
        confirmation.statement.trim().length < 10 ||
        confirmation.statement.length > 2000 ||
        Object.hasOwn(confirmation, 'actor')
      )
        fail('FAL_EXECUTION_AUTHORIZATION_REQUIRED');
      if (
        plan.requestHash !== input.request.contentHash ||
        plan.preparationHash !== input.preparation.contentHash
      )
        fail('CONTROLLED_FAL_REQUEST_BINDING_REQUIRED');
      const risk = plan.riskAuthorization ? validateControlledRisk(plan) : null;
      if (
        risk &&
        (principal.id !== risk.authorizedIdentity ||
          confirmation.riskAcceptance?.accepted !== true ||
          confirmation.riskAcceptance?.riskHash !== affiliateHash(risk))
      )
        fail('FIRST_FAL_RISK_CONFIRMATION_REQUIRED');
      const estimate = risk
        ? {
            amount: risk.nominalUsd,
            currency: 'USD',
            source: 'operator:accepted-residual-risk',
          }
        : validateControlledQuote(plan.quote);
      if (!env.FAL_KEY) fail('PROVIDER_CREDENTIAL_REQUIRED');
      const bytes = image(plan);
      const configuration = {
        model: FAL_VIDEO_MODEL,
        mediaRef: plan.mediaRef,
        operationId: plan.operationId,
        budget: { amount: '0.50', currency: 'USD' },
        estimate,
        rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
      };
      const authorizedInput = structuredClone(input);
      authorizedInput.authorization = {
        authorized: true,
        actorId: principal.id,
        statement: confirmation.statement,
        preparationHash: input.preparation.contentHash,
        requestHash: input.request.contentHash,
        modelHash: affiliateHash(FAL_VIDEO_MODEL),
        budgetHash: affiliateHash(configuration.budget),
      };
      const proof = risk
        ? {
            ...firstFalRiskProof(
              risk,
              principal.id,
              affiliateHash(plan),
              confirmation.statement,
            ),
            pipelineRunId: input.preparation.pipelineRunId,
          }
        : {
            kind: 'ENFORCED_MAXIMUM',
            includesAllCharges: true,
            currency: 'USD',
            maximumAmount: estimate.amount,
            evidenceReference: estimate.source,
            expiresAt: plan.quote.expiresAt,
            requestHash: affiliateHash({
              planHash: affiliateHash(plan),
              requestHash: input.request.contentHash,
              preparationHash: input.preparation.contentHash,
              actor: principal.id,
            }),
            pipelineRunId: input.preparation.pipelineRunId,
            actor: principal.id,
            confirmation: {
              statement: confirmation.statement,
              planHash: confirmation.planHash,
            },
            imageHash: plan.imageHash,
          };
      return {
        input: authorizedInput,
        configuration,
        queue: singleSubmissionQueue(
          transport ?? new FalQueueClient({ apiKey: env.FAL_KEY }),
          finance,
          proof,
          () => {
            operationalQcIdentity.assertActive(principal);
            if (affiliateHash(readPlan(env)) !== affiliateHash(plan))
              fail('CONTROLLED_FAL_PLAN_CHANGED');
            image(plan);
            if (!env.FFMPEG_MEDIA_ROOT || !env.FFMPEG_PATH || !env.FFPROBE_PATH)
              fail('PROVIDER_STORAGE_CONFIGURATION_REQUIRED');
          },
        ),
        resolveImage: async (ref) => {
          if (ref !== plan.mediaRef) fail('PROVIDER_IMAGE_NOT_AUTHORIZED');
          return {
            url: 'data:image/webp;base64,' + bytes.toString('base64'),
            contentHash: plan.imageHash,
            provenance: {
              evidenceRef: plan.evidenceRef,
              sourceRef: plan.sourceRef,
            },
          };
        },
      };
    },
  };
}
