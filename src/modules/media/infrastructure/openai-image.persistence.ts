import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import type {
  FakeImageReceipt,
  ParsedImageOutput,
} from '../application/image-generation.port.js';
import {
  exact,
  freezeImageData,
  imageFail,
  integer,
  MAX_IMAGE_BYTES,
  traceId,
  validateImageRequest,
  validateUsage,
  type OpenAIImageRequest,
} from '../domain/openai-image.contract.js';
import { adaptationHash } from '../domain/media-hash.js';
import {
  LocalEvidenceStorage,
  documentBytes,
  digest,
} from './local-evidence-storage.js';
import { inspectMvpPng } from './physical-media-inspection.js';
/** Immutable FAKE receipts in explicit disposable CAS, never a MediaAsset catalog or operation journal.
 * The authoritative operation -> receipt mapping belongs to the injected Finance port.
 */
export class OpenAIImagePersistence {
  constructor(
    private readonly files: LocalEvidenceStorage,
    private readonly referenceFiles: LocalEvidenceStorage = files,
  ) {}
  referenceBytes(hash: string) {
    const bytes = this.referenceFiles.read(hash, 'png', MAX_IMAGE_BYTES);
    inspectMvpPng(bytes);
    return bytes;
  }
  save(request: OpenAIImageRequest, output: ParsedImageOutput) {
    request = validateImageRequest(request);
    inspectMvpPng(output.bytes, { widthPixels: 864, heightPixels: 1536 });
    if (
      output.bytes.length > MAX_IMAGE_BYTES ||
      digest(output.bytes) !== output.contentHash ||
      output.byteLength !== output.bytes.length ||
      output.widthPixels !== 864 ||
      output.heightPixels !== 1536
    )
      imageFail('IMAGE_OUTPUT_INTEGRITY_INVALID');
    const receipt: FakeImageReceipt = {
      schemaVersion: 'openai-image-fake-result/1.0.0',
      mode: 'FAKE_ONLY',
      operationId: request.operationId,
      requestHash: request.requestHash,
      request,
      resource: {
        contentHash: output.contentHash,
        format: 'png',
        mimeType: 'image/png',
        widthPixels: 864,
        heightPixels: 1536,
        byteLength: output.byteLength,
      },
      usage: output.usage,
      requestId: output.requestId,
      providerCreated: output.providerCreated,
      lineage: fakeLineage(request, output.contentHash),
      mediaAsset: null,
      compatibility: {
        assetType: 'IMAGE',
        origin: 'PROVIDER_GENERATED',
        provider: 'openai',
        acquisitionRequestId:
          request.acquisitionRequest.mediaAcquisitionRequestId,
      },
      registrationAllowed: false,
      commercialAuthorization: false,
      publicationAuthorized: false,
      financeStatus: 'UNKNOWN_COST',
      operationalRecovery: 'NOT_IMPLEMENTED',
    };
    this.files.put(output.bytes, 'png');
    const receiptHash = this.files.put(documentBytes(receipt), 'json');
    return this.load(request, receiptHash);
  }
  load(raw: OpenAIImageRequest, receiptHash: string) {
    const request = validateImageRequest(raw);
    const r = JSON.parse(
      this.files.read(receiptHash, 'json', 2097152).toString('utf8'),
    ) as FakeImageReceipt;
    exact(r, [
      'schemaVersion',
      'mode',
      'operationId',
      'requestHash',
      'request',
      'resource',
      'usage',
      'requestId',
      'providerCreated',
      'lineage',
      'mediaAsset',
      'compatibility',
      'registrationAllowed',
      'commercialAuthorization',
      'publicationAuthorized',
      'financeStatus',
      'operationalRecovery',
    ]);
    if (
      r.schemaVersion !== 'openai-image-fake-result/1.0.0' ||
      r.mode !== 'FAKE_ONLY' ||
      r.operationId !== request.operationId ||
      r.requestHash !== request.requestHash ||
      adaptationHash(validateImageRequest(r.request)) !==
        adaptationHash(request) ||
      r.mediaAsset !== null ||
      r.registrationAllowed !== false ||
      r.commercialAuthorization !== false ||
      r.publicationAuthorized !== false ||
      r.financeStatus !== 'UNKNOWN_COST' ||
      r.operationalRecovery !== 'NOT_IMPLEMENTED'
    )
      imageFail('IMAGE_RECEIPT_INVALID');
    if (
      adaptationHash(validateArtifactLineage(r.lineage)) !==
      adaptationHash(fakeLineage(request, r.resource.contentHash))
    )
      imageFail('IMAGE_RECEIPT_INVALID');
    exact(r.resource, [
      'contentHash',
      'format',
      'mimeType',
      'widthPixels',
      'heightPixels',
      'byteLength',
    ]);
    exact(r.compatibility, [
      'assetType',
      'origin',
      'provider',
      'acquisitionRequestId',
    ]);
    if (
      r.compatibility.assetType !== 'IMAGE' ||
      r.compatibility.origin !== 'PROVIDER_GENERATED' ||
      r.compatibility.provider !== 'openai' ||
      r.compatibility.acquisitionRequestId !==
        request.acquisitionRequest.mediaAcquisitionRequestId ||
      r.resource.format !== 'png' ||
      r.resource.mimeType !== 'image/png' ||
      r.resource.widthPixels !== 864 ||
      r.resource.heightPixels !== 1536
    )
      imageFail('IMAGE_RECEIPT_INVALID');
    integer(r.resource.byteLength);
    integer(r.providerCreated, 0);
    traceId(r.requestId);
    if (r.usage !== null) validateUsage(r.usage);
    const bytes = this.files.read(
      r.resource.contentHash,
      'png',
      MAX_IMAGE_BYTES,
    );
    inspectMvpPng(bytes, { widthPixels: 864, heightPixels: 1536 });
    if (bytes.length !== r.resource.byteLength)
      imageFail('IMAGE_RECEIPT_INVALID');
    return Object.freeze({
      status: 'COMPLETED_FAKE' as const,
      receiptHash,
      receipt: freezeImageData(r),
    });
  }
}

function fakeLineage(request: OpenAIImageRequest, contentHash: string) {
  return validateArtifactLineage({
    schemaVersion: 'artifact-lineage/1.0.0',
    artifactId:
      'image_fixture:' +
      adaptationHash({
        operationId: request.operationId,
        requestHash: request.requestHash,
      }),
    artifactType: 'openai_image_fixture',
    artifactVersion: 1,
    pipelineRunId: request.pipelineRunId,
    projectId: request.projectId,
    projectVersion: request.projectVersion,
    contentIdentity: null,
    hashAlgorithm: 'sha256',
    contentHash,
    inputs: [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: request.scriptId,
        contentHash: request.scriptContentHash,
      },
      ...request.references.map((r, i) => ({
        position: i + 2,
        kind: 'INTERNAL_ARTIFACT',
        inputId: r.artifactId,
        contentHash: r.contentHash,
      })),
    ],
    generationMetadata: {
      provider: 'offline_fixture',
      model: 'openai-image-foundation/1',
      taskType: 'offline_image_fixture',
      promptVersion: 'none',
      configurationHash: request.requestHash,
      publicConfiguration: null,
    },
    createdAt: request.acquisitionRequest.requestedAt,
  });
}
