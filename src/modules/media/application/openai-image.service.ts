import { assertMediaProcessingRights } from '../domain/media-processing-rights.js';
import { adaptationHash } from '../domain/media-hash.js';
import {
  imageFail,
  traceId,
  validateImageRequest,
  type OpenAIImageRequest,
} from '../domain/openai-image.contract.js';
import type {
  FakeImageResult,
  ImageFinancialOperations,
  ImageFinanceStatus,
  ImageSourceReaders,
  ImageOperation,
  ImageExecutionPort,
  ImagePersistencePort,
} from './image-generation.port.js';
/** Offline foundation only; intentionally absent from MediaModule and all controllers. */
export class OpenAIImageService {
  private readonly pending = new Map<
    string,
    { hash: string; promise: Promise<FakeImageResult> }
  >();
  constructor(
    private readonly adapter: ImageExecutionPort,
    private readonly storage: ImagePersistencePort,
    private readonly sources: ImageSourceReaders,
    private readonly finance?: ImageFinancialOperations,
    private readonly now = () => new Date().toISOString(),
  ) {}
  prepare(raw: unknown) {
    const r = validateImageRequest(raw),
      c = this.sources.context(r.pipelineRunId, r.scriptId);
    if (
      !c ||
      [
        'pipelineRunId',
        'projectId',
        'projectVersion',
        'scriptId',
        'scriptContentHash',
        'scriptRevision',
      ].some((k) => c[k as keyof typeof c] !== r[k as keyof typeof r]) ||
      !c.visualDirectionPositions.includes(
        r.acquisitionRequest.visualDirectionPosition,
      )
    )
      imageFail('IMAGE_CONTEXT_MISMATCH');
    const references = r.references.map((ref) => {
      const trusted = this.sources.reference(ref.artifactId);
      if (
        !trusted ||
        trusted.projectId !== r.projectId ||
        trusted.projectVersion !== r.projectVersion ||
        [
          'role',
          'artifactId',
          'contentHash',
          'revision',
          'commercialPurpose',
          'provenance',
          'externalProcessing',
        ].some(
          (k) =>
            adaptationHash(trusted[k as keyof typeof trusted]) !==
            adaptationHash(ref[k as keyof typeof ref]),
        )
      )
        imageFail('IMAGE_REFERENCE_BINDING_MISMATCH');
      if (
        !Array.isArray(trusted.rightsEvidence) ||
        !trusted.rightsEvidence.some(
          (e) =>
            e &&
            e.kind === 'MEDIA_USAGE_RIGHT' &&
            e.id === ref.provenance.evidenceId &&
            e.sourceRef === ref.provenance.sourceRef &&
            e.mediaAuthorization?.mediaRef === trusted.mediaReference &&
            e.mediaAuthorization.contentHash === ref.contentHash,
        )
      )
        imageFail('IMAGE_REFERENCE_PROVENANCE_MISSING');
      assertMediaProcessingRights(
        trusted.rightsEvidence,
        { mediaRef: trusted.mediaReference, contentHash: trusted.contentHash },
        'openai',
        'OPENAI_IMAGE_EDIT',
        c.campaignId
          ? { campaignId: c.campaignId, purpose: 'ADVERTISING' }
          : undefined,
      );
      return this.storage.referenceBytes(ref.contentHash);
    });
    return { request: r, references };
  }
  async readiness(raw: unknown): Promise<ImageFinanceStatus> {
    const { request: r } = this.prepare(raw);
    if (!this.finance) return 'FINANCE_NOT_CONFIGURED';
    let a;
    try {
      a = await this.finance.inspect(r);
    } catch {
      return 'FINANCE_NOT_CONFIGURED';
    }
    const statuses: ImageFinanceStatus[] = [
      'FINANCE_NOT_CONFIGURED',
      'COST_ESTIMATE_REQUIRED',
      'BUDGET_REQUIRED',
      'AUTHORIZATION_REQUIRED',
      'RESERVATION_REQUIRED',
      'UNKNOWN_COST',
      'READY_FOR_CONTROLLED_EXECUTION',
    ];
    if (!a || !statuses.includes(a.status)) return 'FINANCE_NOT_CONFIGURED';
    if (a.status !== 'READY_FOR_CONTROLLED_EXECUTION') return a.status;
    const amount = (v: unknown) => {
      if (typeof v !== 'string' || !/^\d{1,20}(?:\.\d{1,18})?$/.test(v))
        return 0n;
      const [i, f = ''] = v.split('.');
      return BigInt(i + f.padEnd(18, '0'));
    };
    if (
      !a.estimate ||
      a.estimate.requestHash !== r.requestHash ||
      amount(a.estimate.amountUsd) <= 0n ||
      !Number.isFinite(Date.parse(this.now())) ||
      !Number.isFinite(Date.parse(a.estimate.expiresAt)) ||
      Date.parse(a.estimate.expiresAt) <= Date.parse(this.now())
    )
      return 'COST_ESTIMATE_REQUIRED';
    if (
      !a.budget ||
      a.budget.currency !== 'USD' ||
      amount(a.budget.maximumUsd) < amount(a.estimate.amountUsd)
    )
      return 'BUDGET_REQUIRED';
    if (
      !a.authorization ||
      a.authorization.requestHash !== r.requestHash ||
      !a.authorization.principalId ||
      !a.authorization.evidenceId
    )
      return 'AUTHORIZATION_REQUIRED';
    if (
      a.scope !== 'OFFLINE_TEST_ONLY' ||
      !a.reservation ||
      a.reservation.mode !== 'FAKE_ONLY' ||
      a.reservation.requestHash !== r.requestHash ||
      !a.reservation.reservationId ||
      amount(a.reservation.amountUsd) < amount(a.estimate.amountUsd) ||
      amount(a.reservation.amountUsd) > amount(a.budget.maximumUsd)
    )
      return 'RESERVATION_REQUIRED';
    return a.status;
  }
  execute(raw: unknown): Promise<FakeImageResult> {
    const prepared = this.prepare(raw),
      r = prepared.request;
    const prior = this.pending.get(r.operationId);
    if (prior) {
      if (prior.hash !== r.requestHash) imageFail('IMAGE_OPERATION_ID_REUSED');
      return prior.promise;
    }
    const promise = this.run(prepared).finally(() =>
      this.pending.delete(r.operationId),
    );
    this.pending.set(r.operationId, { hash: r.requestHash, promise });
    return promise;
  }
  private unknown(
    r: OpenAIImageRequest,
    reason: string,
    requestId: string | null = null,
  ): FakeImageResult {
    return {
      status: 'UNKNOWN',
      mode: 'FAKE_ONLY',
      operationId: r.operationId,
      requestHash: r.requestHash,
      reason,
      retryAllowed: false,
      requestId,
    };
  }
  private existing(r: OpenAIImageRequest, op: ImageOperation): FakeImageResult {
    if (op.operationId !== r.operationId || op.requestHash !== r.requestHash)
      imageFail('IMAGE_OPERATION_ID_REUSED');
    if (op.state !== 'COMPLETED_FAKE' || !op.receiptHash)
      return this.unknown(r, 'FINANCIAL_RECONCILIATION_REQUIRED');
    try {
      return this.storage.load(r, op.receiptHash);
    } catch {
      return this.unknown(r, 'IMAGE_RECEIPT_UNVERIFIED');
    }
  }
  async recover(raw: unknown): Promise<FakeImageResult> {
    const { request: r } = this.prepare(raw);
    if (!this.finance) imageFail('FINANCE_NOT_CONFIGURED');
    let op;
    try {
      op = await this.finance.find(r.operationId);
    } catch {
      return this.unknown(r, 'FINANCIAL_OPERATION_UNCERTAIN');
    }
    return op
      ? this.existing(r, op)
      : this.unknown(r, 'IMAGE_OPERATION_NOT_FOUND');
  }
  private async run({
    request: r,
  }: {
    request: OpenAIImageRequest;
    references: Buffer[];
  }): Promise<FakeImageResult> {
    if (!this.finance) imageFail('FINANCE_NOT_CONFIGURED');
    this.adapter.assertOffline();
    let op;
    try {
      op = await this.finance.find(r.operationId);
    } catch {
      return this.unknown(r, 'FINANCIAL_OPERATION_UNCERTAIN');
    }
    if (op) return this.existing(r, op);
    const status = await this.readiness(r);
    if (status !== 'READY_FOR_CONTROLLED_EXECUTION') imageFail(status);
    let claimed;
    try {
      claimed = await this.finance.claim(r);
    } catch {
      return this.unknown(r, 'FINANCIAL_OPERATION_UNCERTAIN');
    }
    if (
      claimed.operation.operationId !== r.operationId ||
      claimed.operation.requestHash !== r.requestHash
    )
      imageFail('IMAGE_OPERATION_ID_REUSED');
    if (!claimed.created) return this.existing(r, claimed.operation);
    if (
      claimed.operation.state !== 'RESERVED' ||
      claimed.operation.receiptHash !== null
    )
      return this.unknown(r, 'FINANCIAL_OPERATION_UNCERTAIN');
    try {
      await this.finance.dispatch(r.operationId, r.requestHash);
      // Revalidate current scope/rights immediately before the only transport invocation.
      const current = this.prepare(r);
      const output = await this.adapter.execute(
        current.request,
        current.references,
      );
      const result = this.storage.save(r, output);
      await this.finance.recordOfflineResult(
        r.operationId,
        r.requestHash,
        result.receiptHash,
      );
      return result;
    } catch (error) {
      try {
        await this.finance.unknown(r.operationId, r.requestHash);
      } catch {
        /* Unknown liabilities are never retried here. */
      }
      const allowed = [
        'IMAGE_TRANSPORT_UNCERTAIN',
        'IMAGE_RESPONSE_INVALID',
        'IMAGE_QUOTA_OR_RATE_LIMIT',
        'IMAGE_PROVIDER_ACCESS_DENIED',
        'IMAGE_PROVIDER_REJECTED',
        'IMAGE_MODERATION_BLOCKED',
        'IMAGE_QUOTA_EXCEEDED',
        'IMAGE_PROVIDER_ERROR_UNPARSEABLE',
      ];
      const code =
        error instanceof Error && 'code' in error ? String(error.code) : '';
      let requestId: string | null = null;
      try {
        if (error instanceof Error && 'requestId' in error)
          requestId = traceId(error.requestId);
      } catch {
        /* Discard invalid trace. */
      }
      return this.unknown(
        r,
        allowed.includes(code)
          ? code
          : 'IMAGE_EXECUTION_OR_PERSISTENCE_UNCERTAIN',
        requestId,
      );
    }
  }
}
