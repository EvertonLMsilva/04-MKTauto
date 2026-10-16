import type {
  MediaAsset,
  AcquisitionReceipt,
  SelectionReceipt,
} from '../domain/media.types.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import {
  ARTIFACT_LINEAGE_CONTRACT_VERSION,
  validateArtifactLineage,
} from '../../content/domain/artifact-lineage-contracts.js';
import {
  MEDIA_ACQUISITION_REQUEST_VERSION,
  mediaAcquisitionRequestHash,
  validateMediaAcquisitionRequest,
} from '../domain/media-acquisition-contracts.js';
import {
  mediaAssetIdentityHash,
  validateMediaAsset,
} from '../domain/media-asset-contracts.js';
import { validateMediaSelectionRequest } from '../domain/media-selection-contracts.js';
import { createHash } from 'node:crypto';
import { MediaDatabase } from './media-database.js';
import { assertNewPhysicalMediaIdentity } from '../domain/media-identity.js';
export class MediaAssetRepositoryError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(
    code: string,
    field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'MediaAssetRepositoryError';
    this.code = code;
    this.field = field;
  }
}
export class MediaAssetRepository extends MediaDatabase {
  getMediaSelection(mediaSelectionRequestId: string): SelectionReceipt | null {
    requireIdentifier(mediaSelectionRequestId, 'mediaSelectionRequestId', 160);
    const row = this.db
      .prepare(
        'SELECT * FROM media_selection_requests WHERE media_selection_request_id = ?',
      )
      .get(mediaSelectionRequestId);
    if (!row) return null;
    const mediaAsset = this.getMediaAsset(row.media_asset_id as string);
    if (
      !mediaAsset ||
      row.schema_version !== 'media-selection-request/1.0.0' ||
      row.script_id !== mediaAsset.scriptId ||
      row.script_content_hash !== mediaAsset.scriptContentHash ||
      row.visual_direction_position !== mediaAsset.visualDirectionPosition ||
      (row.production_profile === 'STATIC_IMAGE_V1' &&
        mediaAsset.assetType !== 'IMAGE') ||
      row.selected_asset_type !== mediaAsset.assetType
    )
      throw failure(
        'INVALID_PERSISTED_MEDIA_SELECTION',
        'mediaSelectionRequestId',
        'seleção persistida inválida',
      );
    return deepFreeze({
      requestHash: row.request_hash,
      productionProfile: row.production_profile,
      requestedAssetType: row.requested_asset_type,
      selectedAssetType: row.selected_asset_type,
      fallbackCode: row.fallback_code,
      mediaAsset,
    });
  }
  registerMediaSelection({
    request: requestValue,
    mediaAsset: assetValue,
    fallbackCode = null,
  }: any): MediaAsset {
    let request;
    let asset;
    try {
      request = validateMediaSelectionRequest(requestValue);
      asset = validateMediaAsset(assetValue);
    } catch (caught) {
      throw mapError(caught);
    }
    return this.#transaction(() => {
      const prior = this.getMediaSelection(request.mediaSelectionRequestId);
      if (prior) {
        if (prior.requestHash !== request.contentHash)
          throw failure(
            'MEDIA_SELECTION_REQUEST_ID_REUSED',
            'mediaSelectionRequestId',
            'identidade divergente',
          );
        return prior.mediaAsset;
      }
      const requestedType =
        request.productionProfile === 'MIXED_MEDIA_V2' ? 'VIDEO' : 'IMAGE';
      if (
        asset.scriptId !== request.scriptId ||
        asset.scriptContentHash !== request.scriptContentHash ||
        asset.visualDirectionPosition !== request.visualDirectionPosition
      )
        throw failure(
          'MEDIA_SELECTION_SCOPE_MISMATCH',
          'mediaAsset',
          'ativo fora do escopo',
        );
      if (
        asset.assetType !== requestedType &&
        !(
          requestedType === 'VIDEO' &&
          asset.assetType === 'IMAGE' &&
          fallbackCode === 'PROVIDER_NO_ELIGIBLE_VIDEO'
        )
      )
        throw failure(
          'MEDIA_SELECTION_FALLBACK_INVALID',
          'fallbackCode',
          'fallback inválido',
        );
      this.db
        .prepare(
          `INSERT INTO media_selection_requests
        (media_selection_request_id, schema_version, request_hash, script_id, script_content_hash,
         visual_direction_position, production_profile, requested_asset_type,
         selected_asset_type, media_asset_id, fallback_code, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.mediaSelectionRequestId,
          request.schemaVersion,
          request.contentHash,
          request.scriptId,
          request.scriptContentHash,
          request.visualDirectionPosition,
          request.productionProfile,
          requestedType,
          asset.assetType,
          asset.mediaAssetId,
          fallbackCode,
          request.requestedAt,
        );
      return this.getMediaSelection(request.mediaSelectionRequestId)!
        .mediaAsset;
    });
  }
  registerMediaAsset(value: unknown): MediaAsset {
    let asset;
    try {
      asset = validateMediaAsset(value);
    } catch (caught) {
      throw mapError(caught);
    }
    return this.#transaction(() => this.#registerValidated(asset));
  }
  registerAcquiredMediaAsset({
    request: requestValue,
    mediaAsset: assetValue,
    telemetry: telemetryValue = null,
    costEvent: costEventValue = null,
  }: any): MediaAsset {
    if (telemetryValue !== null || costEventValue !== null)
      throw failure(
        'MEDIA_FINANCE_DEPENDENCY_REQUIRED',
        'telemetry',
        'persistência financeira pertence a Finance',
      );
    let request;
    let asset;
    try {
      request = validateMediaAcquisitionRequest(requestValue);
      asset = validateMediaAsset(assetValue);
    } catch (caught) {
      throw mapError(caught);
    }
    return this.#transaction(() => {
      const prior = this.db
        .prepare(
          `SELECT request_hash, media_asset_id
        FROM media_acquisition_requests WHERE media_acquisition_request_id = ?`,
        )
        .get(request.mediaAcquisitionRequestId);
      if (prior) {
        if (prior.request_hash !== request.contentHash)
          throw failure(
            'MEDIA_ACQUISITION_REQUEST_ID_REUSED',
            'mediaAcquisitionRequestId',
            'identidade já usada com conteúdo divergente',
          );
        return this.getMediaAsset(prior.media_asset_id as string)!;
      }
      verifyAcquisitionBinding(request, asset);
      const created = this.#registerValidated(asset);
      this.db
        .prepare(
          `INSERT INTO media_acquisition_requests
        (media_acquisition_request_id, schema_version, request_hash, script_id,
         script_content_hash, visual_direction_position, asset_type, media_asset_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.mediaAcquisitionRequestId,
          request.schemaVersion,
          request.contentHash,
          request.scriptId,
          request.scriptContentHash,
          request.visualDirectionPosition,
          request.assetType,
          created.mediaAssetId,
          request.requestedAt,
        );
      return created;
    });
  }
  getMediaAcquisition(
    mediaAcquisitionRequestId: string,
  ): AcquisitionReceipt | null {
    requireIdentifier(
      mediaAcquisitionRequestId,
      'mediaAcquisitionRequestId',
      180,
    );
    const row = this.db
      .prepare(
        `SELECT * FROM media_acquisition_requests
      WHERE media_acquisition_request_id = ?`,
      )
      .get(mediaAcquisitionRequestId);
    if (!row) return null;
    try {
      const mediaAsset = this.getMediaAsset(row.media_asset_id as string);
      if (
        !mediaAsset ||
        row.schema_version !== MEDIA_ACQUISITION_REQUEST_VERSION
      )
        throw new Error('aquisição incompleta');
      const expectedHash = mediaAcquisitionRequestHash({
        schemaVersion: row.schema_version,
        mediaAcquisitionRequestId: row.media_acquisition_request_id,
        scriptId: row.script_id,
        scriptContentHash: row.script_content_hash,
        visualDirectionPosition: row.visual_direction_position,
        assetType: row.asset_type,
        requestedAt: row.created_at,
        contentHash: row.request_hash,
      });
      if (
        expectedHash !== row.request_hash ||
        mediaAsset.mediaAssetId !==
          `media_asset:${String(row.media_acquisition_request_id)}` ||
        mediaAsset.scriptId !== row.script_id ||
        mediaAsset.scriptContentHash !== row.script_content_hash ||
        mediaAsset.visualDirectionPosition !== row.visual_direction_position ||
        mediaAsset.assetType !== row.asset_type ||
        mediaAsset.createdAt !== row.created_at
      )
        throw new Error('vínculo inválido');
      return deepFreeze({ requestHash: row.request_hash, mediaAsset });
    } catch (caught) {
      if (caught instanceof MediaAssetRepositoryError) throw caught;
      throw failure(
        'INVALID_PERSISTED_MEDIA_ACQUISITION',
        'mediaAcquisitionRequestId',
        'aquisição persistida inválida',
        { cause: caught },
      );
    }
  }
  getMediaAsset(mediaAssetId: string): MediaAsset | null {
    requireIdentifier(mediaAssetId, 'mediaAssetId', 200);
    const row = this.db
      .prepare('SELECT * FROM media_assets WHERE media_asset_id = ?')
      .get(mediaAssetId);
    if (!row) return null;
    try {
      const asset = validateMediaAsset(JSON.parse(String(row.payload_json)));
      verifyPersistedColumns(asset, row);
      verifyPersistedSource(
        asset,
        this.db
          .prepare('SELECT * FROM media_asset_sources WHERE media_asset_id = ?')
          .get(asset.mediaAssetId),
      );
      if (mediaAssetIdentityHash(asset) !== row.identity_hash)
        throw new Error('identidade divergente');
      const run = this.getRun(asset.pipelineRunId);
      const script = this.getScript(asset.scriptId);
      if (!run || !script) throw new Error('escopo ausente');
      verifyScope(run, asset, 'MEDIA_ASSET_RUN_SCOPE_MISMATCH');
      verifyScript(asset, script);
      const lineage = this.getArtifact(asset.mediaAssetId);
      if (
        !lineage ||
        lineage.artifactType !== 'media_asset' ||
        lineage.contentHash !== asset.contentHash
      )
        throw new Error('linhagem divergente');
      return asset;
    } catch (caught) {
      if (caught instanceof MediaAssetRepositoryError) throw caught;
      throw failure(
        'INVALID_PERSISTED_MEDIA_ASSET',
        'mediaAssetId',
        'ativo persistido inválido',
        { cause: caught },
      );
    }
  }
  listMediaAssetsByPipelineRun(pipelineRunId: string): MediaAsset[] {
    requireIdentifier(pipelineRunId, 'pipelineRunId');
    return this.db
      .prepare(
        `SELECT media_asset_id FROM media_assets WHERE pipeline_run_id = ?
      ORDER BY created_at, script_id, visual_direction_position, asset_type, revision, media_asset_id`,
      )
      .all(pipelineRunId)
      .map(({ media_asset_id: id }: any) => this.getMediaAsset(id as string)!);
  }
  listMediaAssetsByScript(scriptId: string): MediaAsset[] {
    requireIdentifier(scriptId, 'scriptId', 200);
    return this.db
      .prepare(
        `SELECT media_asset_id FROM media_assets WHERE script_id = ?
      ORDER BY visual_direction_position, asset_type, revision, media_asset_id`,
      )
      .all(scriptId)
      .map(({ media_asset_id: id }: any) => this.getMediaAsset(id as string)!);
  }
  listMediaAssetsByVisualDirection(
    scriptId: string,
    visualDirectionPosition: number,
  ): MediaAsset[] {
    requireIdentifier(scriptId, 'scriptId', 200);
    requirePositiveInteger(
      visualDirectionPosition,
      'visualDirectionPosition',
      'INVALID_VISUAL_DIRECTION_POSITION',
    );
    return this.db
      .prepare(
        `SELECT media_asset_id FROM media_assets
      WHERE script_id = ? AND visual_direction_position = ?
      ORDER BY asset_type, revision, media_asset_id`,
      )
      .all(scriptId, visualDirectionPosition)
      .map(({ media_asset_id: id }: any) => this.getMediaAsset(id as string)!);
  }
  #registerValidated(asset: any): any {
    const identityHash = mediaAssetIdentityHash(asset);
    const prior = this.db
      .prepare(
        'SELECT identity_hash FROM media_assets WHERE media_asset_id = ?',
      )
      .get(asset.mediaAssetId);
    if (prior) {
      if (prior.identity_hash !== identityHash)
        throw failure(
          'MEDIA_ASSET_ID_REUSED',
          'mediaAssetId',
          'ID já usado com ativo incompatível',
        );
      return this.getMediaAsset(asset.mediaAssetId)!;
    }
    assertNewPhysicalMediaIdentity(asset.mediaReference, asset.contentHash);
    const logicalPrior = this.db
      .prepare(
        `SELECT media_asset_id FROM media_assets
      WHERE script_id = ? AND visual_direction_position = ? AND asset_type = ? AND revision = ?`,
      )
      .get(
        asset.scriptId,
        asset.visualDirectionPosition,
        asset.assetType,
        asset.revision,
      );
    if (logicalPrior)
      throw failure(
        'MEDIA_ASSET_REVISION_CONFLICT',
        'revision',
        'revisão já registrada para a direção visual',
      );
    const run = this.getRun(asset.pipelineRunId);
    if (!run)
      throw failure(
        'PIPELINE_RUN_NOT_FOUND',
        'pipelineRunId',
        'execução não encontrada',
      );
    verifyScope(run, asset, 'MEDIA_ASSET_RUN_SCOPE_MISMATCH');
    const script = this.getScript(asset.scriptId);
    if (!script)
      throw failure('SCRIPT_NOT_FOUND', 'scriptId', 'roteiro não encontrado');
    verifyScript(asset, script);
    const previous = this.#validateRevision(asset);
    this.#insertLineage(asset, previous);
    const technical = asset.technicalProperties;
    this.db
      .prepare(
        `INSERT INTO media_assets
      (media_asset_id, schema_version, identity_hash, pipeline_run_id, project_id,
       project_version, script_id, script_content_hash, visual_direction_position,
       asset_type, media_format, width_pixels, height_pixels, duration_milliseconds,
       content_hash, media_reference, origin, provider, usage_basis,
       commercial_use_allowed, created_at, revision, supersedes_media_asset_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        asset.mediaAssetId,
        asset.schemaVersion,
        identityHash,
        asset.pipelineRunId,
        asset.projectId,
        asset.projectVersion,
        asset.scriptId,
        asset.scriptContentHash,
        asset.visualDirectionPosition,
        asset.assetType,
        technical.format,
        technical.widthPixels,
        technical.heightPixels,
        technical.durationMilliseconds,
        asset.contentHash,
        asset.mediaReference,
        asset.origin,
        asset.provider,
        asset.rights.usageBasis,
        asset.createdAt,
        asset.revision,
        asset.supersedesMediaAssetId,
        JSON.stringify(asset),
      );
    if (asset.source !== undefined && asset.source !== null) {
      this.db
        .prepare(
          `INSERT INTO media_asset_sources
        (media_asset_id, provider, external_asset_id, license_name, license_url,
         photographer_name, photographer_url, source_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          asset.mediaAssetId,
          asset.provider,
          asset.source.externalAssetId,
          asset.source.licenseName,
          asset.source.licenseUrl,
          asset.source.photographerName,
          asset.source.photographerUrl,
          asset.source.sourceUrl,
        );
    }
    return this.getMediaAsset(asset.mediaAssetId)!;
  }
  #validateRevision(asset: any): any {
    if (asset.revision === 1) return null;
    const previous = this.getMediaAsset(asset.supersedesMediaAssetId);
    if (!previous)
      throw failure(
        'SUPERSEDED_MEDIA_ASSET_NOT_FOUND',
        'supersedesMediaAssetId',
        'ativo anterior não encontrado',
      );
    for (const field of [
      'pipelineRunId',
      'projectId',
      'projectVersion',
      'scriptId',
      'visualDirectionPosition',
      'assetType',
    ]) {
      if (previous[field as keyof typeof previous] !== asset[field])
        throw failure(
          'MEDIA_ASSET_SUPERSESSION_SCOPE_MISMATCH',
          field,
          'ativo anterior fora do escopo',
        );
    }
    if (previous.revision + 1 !== asset.revision)
      throw failure(
        'MEDIA_ASSET_REVISION_MISMATCH',
        'revision',
        'revisão não é sucessora imediata',
      );
    return previous;
  }
  #insertLineage(asset: any, previous: any): any {
    const inputs = [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: asset.scriptId,
        contentHash: asset.scriptContentHash,
      },
    ];
    if (previous)
      inputs.push({
        position: 2,
        kind: 'INTERNAL_ARTIFACT',
        inputId: previous.mediaAssetId,
        contentHash: previous.contentHash,
      });
    const artifact = validateArtifactLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: asset.mediaAssetId,
      artifactType: 'media_asset',
      artifactVersion: asset.revision,
      pipelineRunId: asset.pipelineRunId,
      projectId: asset.projectId,
      projectVersion: asset.projectVersion,
      contentIdentity: `media-asset:${asset.scriptId}:${asset.visualDirectionPosition}:${asset.assetType.toLowerCase()}`,
      hashAlgorithm: 'sha256',
      contentHash: asset.contentHash,
      inputs,
      generationMetadata: null,
      createdAt: asset.createdAt,
    });
    this.db
      .prepare(
        `INSERT INTO artifact_lineage
      (artifact_id, schema_version, artifact_type, artifact_version, identity_hash,
       pipeline_run_id, project_id, project_version, content_identity, hash_algorithm,
       content_hash, generation_metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        artifact.artifactId,
        artifact.schemaVersion,
        artifact.artifactType,
        artifact.artifactVersion,
        sha256(JSON.stringify(artifact)),
        artifact.pipelineRunId,
        artifact.projectId,
        artifact.projectVersion,
        artifact.contentIdentity,
        artifact.hashAlgorithm,
        artifact.contentHash,
        artifact.createdAt,
      );
    const insert = this.db.prepare(`INSERT INTO artifact_lineage_inputs
      (artifact_id, position, kind, input_id, content_hash) VALUES (?, ?, ?, ?, ?)`);
    for (const input of artifact.inputs)
      insert.run(
        artifact.artifactId,
        input.position,
        input.kind,
        input.inputId,
        input.contentHash,
      );
  }
  #transaction(operation: any): any {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (caught) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw mapError(caught);
    }
  }
}
function verifyPersistedSource(asset: any, row: any): any {
  if (asset.source === undefined || asset.source === null) {
    if (row) throw new Error('proveniência inesperada');
    return;
  }
  if (!row) throw new Error('proveniência ausente');
  const expected: any = {
    provider: asset.provider,
    external_asset_id: asset.source.externalAssetId,
    license_name: asset.source.licenseName,
    license_url: asset.source.licenseUrl,
    photographer_name: asset.source.photographerName,
    photographer_url: asset.source.photographerUrl,
    source_url: asset.source.sourceUrl,
  };
  for (const [field, value] of Object.entries(expected))
    if (row[field] !== value) throw new Error('proveniência divergente');
}
function verifyScript(asset: any, script: any): any {
  for (const field of ['pipelineRunId', 'projectId', 'projectVersion']) {
    if (script[field] !== asset[field])
      throw failure(
        'MEDIA_ASSET_SCRIPT_SCOPE_MISMATCH',
        field,
        'roteiro fora do escopo',
      );
  }
  if (script.contentHash !== asset.scriptContentHash)
    throw failure(
      'SCRIPT_CONTENT_HASH_MISMATCH',
      'scriptContentHash',
      'hash do roteiro divergente',
    );
  if (
    !script.visualDirections.some(
      ({ position }: any) => position === asset.visualDirectionPosition,
    )
  ) {
    throw failure(
      'VISUAL_DIRECTION_NOT_FOUND',
      'visualDirectionPosition',
      'direção visual não pertence ao roteiro',
    );
  }
}
function verifyAcquisitionBinding(request: any, asset: any): any {
  for (const field of [
    'scriptId',
    'scriptContentHash',
    'visualDirectionPosition',
    'assetType',
  ]) {
    if (request[field] !== asset[field])
      throw failure(
        'MEDIA_ACQUISITION_SCOPE_MISMATCH',
        field,
        'solicitação diverge do ativo',
      );
  }
  if (request.requestedAt !== asset.createdAt)
    throw failure(
      'MEDIA_ACQUISITION_SCOPE_MISMATCH',
      'requestedAt',
      'solicitação diverge do ativo',
    );
  if (asset.mediaAssetId !== `media_asset:${request.mediaAcquisitionRequestId}`)
    throw failure(
      'MEDIA_ACQUISITION_SCOPE_MISMATCH',
      'mediaAssetId',
      'solicitação diverge do ativo',
    );
  if (asset.revision !== 1 || asset.supersedesMediaAssetId !== null)
    throw failure(
      'MEDIA_ACQUISITION_SCOPE_MISMATCH',
      'revision',
      'aquisição inicial inválida',
    );
}
function verifyScope(stored: any, expected: any, code: any): any {
  for (const field of ['pipelineRunId', 'projectId', 'projectVersion'])
    if (stored[field] !== expected[field])
      throw failure(code, field, 'escopo divergente');
}
function verifyPersistedColumns(asset: any, row: any): any {
  const technical = asset.technicalProperties;
  const expected: any = {
    media_asset_id: asset.mediaAssetId,
    schema_version: asset.schemaVersion,
    pipeline_run_id: asset.pipelineRunId,
    project_id: asset.projectId,
    project_version: asset.projectVersion,
    script_id: asset.scriptId,
    script_content_hash: asset.scriptContentHash,
    visual_direction_position: asset.visualDirectionPosition,
    asset_type: asset.assetType,
    media_format: technical.format,
    width_pixels: technical.widthPixels,
    height_pixels: technical.heightPixels,
    duration_milliseconds: technical.durationMilliseconds,
    content_hash: asset.contentHash,
    media_reference: asset.mediaReference,
    origin: asset.origin,
    provider: asset.provider,
    usage_basis: asset.rights.usageBasis,
    commercial_use_allowed: Number(asset.rights.commercialUseAllowed),
    created_at: asset.createdAt,
    revision: asset.revision,
    supersedes_media_asset_id: asset.supersedesMediaAssetId,
  };
  for (const [field, value] of Object.entries(expected))
    if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
}
function requireIdentifier(value: any, field: any, max: any = 80): any {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw failure('INVALID_IDENTIFIER', field, 'identificador inválido');
}
function mapError(caught: any): any {
  if (caught instanceof MediaAssetRepositoryError) return caught;
  if (caught instanceof ContractValidationError)
    return failure(
      caught.code,
      caught.path,
      'contrato de ativo de mídia inválido',
      { cause: caught },
    );
  const message = String(caught?.message);
  if (
    message.includes(
      'media_assets.script_id, media_assets.visual_direction_position, media_assets.asset_type, media_assets.revision',
    )
  )
    return failure(
      'MEDIA_ASSET_REVISION_CONFLICT',
      'revision',
      'revisão já registrada',
      { cause: caught },
    );
  if (message.includes('media_assets.supersedes_media_asset_id'))
    return failure(
      'MEDIA_ASSET_ALREADY_SUPERSEDED',
      'supersedesMediaAssetId',
      'ativo já substituído',
      { cause: caught },
    );
  if (
    message.includes(
      'artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version',
    )
  )
    return failure(
      'MEDIA_ASSET_REVISION_CONFLICT',
      'revision',
      'revisão já registrada',
      { cause: caught },
    );
  if (message.includes('artifact_lineage.artifact_id'))
    return failure(
      'MEDIA_ASSET_ID_REUSED',
      'mediaAssetId',
      'ID já registrado',
      { cause: caught },
    );
  if (message.includes('IMMUTABLE_MEDIA_ASSET'))
    return failure('IMMUTABLE_MEDIA_ASSET', 'mediaAssetId', 'ativo imutável', {
      cause: caught,
    });
  if (message.includes('IMMUTABLE_MEDIA_ACQUISITION_REQUEST'))
    return failure(
      'IMMUTABLE_MEDIA_ACQUISITION_REQUEST',
      'mediaAcquisitionRequestId',
      'solicitação imutável',
      { cause: caught },
    );
  if (message.includes('MEDIA_ACQUISITION_SCOPE_MISMATCH'))
    return failure(
      'MEDIA_ACQUISITION_SCOPE_MISMATCH',
      'mediaAcquisitionRequestId',
      'solicitação fora do escopo',
      { cause: caught },
    );
  if (message.includes('MEDIA_ASSET_SCOPE_MISMATCH'))
    return failure(
      'MEDIA_ASSET_SCOPE_MISMATCH',
      'scriptId',
      'artefatos fora do escopo',
      { cause: caught },
    );
  if (message.includes('MEDIA_ASSET_REVISION_MISMATCH'))
    return failure(
      'MEDIA_ASSET_REVISION_MISMATCH',
      'revision',
      'revisão inválida',
      { cause: caught },
    );
  if (typeof caught?.code === 'string' && caught.code.startsWith('ERR_SQLITE'))
    return failure(
      'MEDIA_ASSET_PERSISTENCE_FAILED',
      'mediaAsset',
      'não foi possível persistir o ativo',
      { cause: caught },
    );
  return caught;
}
function sha256(value: any): any {
  return createHash('sha256').update(value).digest('hex');
}
function failure(
  code: string,
  field: string,
  message: string,
  options?: ErrorOptions,
): any {
  return new MediaAssetRepositoryError(code, field, message, options);
}
function deepFreeze(value: any): any {
  const clone = structuredClone(value);
  freeze(clone);
  return clone;
}

function requirePositiveInteger(value: unknown, field: string, code: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw failure(code, field, 'inteiro positivo obrigatório');
}

function freeze(value: any): any {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
