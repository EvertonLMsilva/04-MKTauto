import type { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import type {
  ImageReference,
  ImageUsage,
  OpenAIImageRequest,
} from '../domain/openai-image.contract.js';
export type ImageFinanceStatus =
  | 'FINANCE_NOT_CONFIGURED'
  | 'COST_ESTIMATE_REQUIRED'
  | 'BUDGET_REQUIRED'
  | 'AUTHORIZATION_REQUIRED'
  | 'RESERVATION_REQUIRED'
  | 'UNKNOWN_COST'
  | 'READY_FOR_CONTROLLED_EXECUTION';
export interface ImageTransportReply {
  status: number;
  body: unknown;
  requestId?: unknown;
}
/** B010 accepts only isolated local doubles. No HTTP client is supplied or registered. */
export interface OfflineImageTransport {
  readonly mode: 'FAKE_ONLY';
  readonly operational: false;
  generate(
    this: void,
    body: Readonly<Record<string, unknown>>,
  ): Promise<ImageTransportReply>;
  edit(
    this: void,
    body: Readonly<Record<string, unknown>>,
  ): Promise<ImageTransportReply>;
}
export interface TrustedImageContext {
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  scriptId: string;
  scriptContentHash: string;
  scriptRevision: number;
  visualDirectionPositions: readonly number[];
  campaignId: string | null;
}
export interface TrustedImageReference extends ImageReference {
  projectId: string;
  projectVersion: number;
  mediaReference: string;
  rightsEvidence: unknown;
}
export interface ImageSourceReaders {
  context(runId: string, scriptId: string): TrustedImageContext | null;
  reference(artifactId: string): TrustedImageReference | null;
}
export interface ImageFinanceAssessment {
  status: ImageFinanceStatus;
  /** This scope can never authorize a paid transport. Not an external request flag. */
  scope?: 'OFFLINE_TEST_ONLY';
  estimate?: { requestHash: string; amountUsd: string; expiresAt: string };
  budget?: { currency: 'USD'; maximumUsd: string };
  authorization?: {
    requestHash: string;
    principalId: string;
    evidenceId: string;
  };
  reservation?: {
    requestHash: string;
    reservationId: string;
    amountUsd: string;
    mode: 'FAKE_ONLY';
  };
}
export interface ImageOperation {
  operationId: string;
  requestHash: string;
  state: 'RESERVED' | 'SUBMITTING' | 'UNKNOWN' | 'COMPLETED_FAKE';
  receiptHash: string | null;
}
/** Finance owns atomic identity claims, dispatch and durable operation/receipt binding.
 * B010 provides no implementation of this port. In-memory doubles prove only simulation.
 * Production must add a distinct trusted financial contract; fake scope never enables LIVE.
 * That contract must persist atomic unique operationId/requestHash claims, reserve and
 * dispatch before transport, and checkpoint provider trace + CAS receipt + cost evidence.
 * An unavailable/lost operation store must fail UNKNOWN, never be recreated from CAS.
 * Cross-process restart recovery requires that durable Finance implementation and tests.
 * recordOfflineResult records no real reservation, cost, billing or commercial approval.
 */
export interface ImageFinancialOperations {
  inspect(request: OpenAIImageRequest): Promise<ImageFinanceAssessment>;
  find(operationId: string): Promise<ImageOperation | null>;
  claim(
    request: OpenAIImageRequest,
  ): Promise<{ created: boolean; operation: ImageOperation }>;
  dispatch(operationId: string, requestHash: string): Promise<void>;
  recordOfflineResult(
    operationId: string,
    requestHash: string,
    receiptHash: string,
  ): Promise<void>;
  unknown(operationId: string, requestHash: string): Promise<void>;
}
export interface ParsedImageOutput {
  bytes: Buffer;
  contentHash: string;
  widthPixels: number;
  heightPixels: number;
  byteLength: number;
  usage: ImageUsage | null;
  requestId: string | null;
  providerCreated: number;
}
export interface FakeImageReceipt {
  schemaVersion: 'openai-image-fake-result/1.0.0';
  mode: 'FAKE_ONLY';
  operationId: string;
  requestHash: string;
  request: OpenAIImageRequest;
  resource: {
    contentHash: string;
    format: 'png';
    mimeType: 'image/png';
    widthPixels: number;
    heightPixels: number;
    byteLength: number;
  };
  usage: ImageUsage | null;
  requestId: string | null;
  providerCreated: number;
  lineage: ReturnType<typeof validateArtifactLineage>;
  mediaAsset: null;
  compatibility: {
    assetType: 'IMAGE';
    origin: 'PROVIDER_GENERATED';
    provider: 'openai';
    acquisitionRequestId: string;
  };
  registrationAllowed: false;
  commercialAuthorization: false;
  publicationAuthorized: false;
  financeStatus: 'UNKNOWN_COST';
  operationalRecovery: 'NOT_IMPLEMENTED';
}
export type FakeImageResult =
  | { status: 'COMPLETED_FAKE'; receiptHash: string; receipt: FakeImageReceipt }
  | {
      status: 'UNKNOWN';
      mode: 'FAKE_ONLY';
      operationId: string;
      requestHash: string;
      reason: string;
      retryAllowed: false;
      requestId: string | null;
    };

export interface ImageExecutionPort {
  assertOffline(): void;
  execute(
    request: OpenAIImageRequest,
    references: readonly Buffer[],
  ): Promise<ParsedImageOutput>;
}
export interface ImagePersistencePort {
  referenceBytes(hash: string): Buffer;
  save(
    request: OpenAIImageRequest,
    output: ParsedImageOutput,
  ): Extract<FakeImageResult, { status: 'COMPLETED_FAKE' }>;
  load(
    request: OpenAIImageRequest,
    receiptHash: string,
  ): Extract<FakeImageResult, { status: 'COMPLETED_FAKE' }>;
}
