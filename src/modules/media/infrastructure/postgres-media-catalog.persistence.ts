import { createHash } from 'node:crypto';
import { PostgresDatabase } from '../../../infrastructure/database/postgres/index.js';
import type { MediaRepository } from '../application/media.port.js';
import type {
  MediaAsset,
  AcquisitionReceipt,
  SelectionReceipt,
} from '../domain/media.types.js';
import {
  validateMediaAsset,
  mediaAssetIdentityHash,
} from '../domain/media-asset-contracts.js';
import { validateMediaAcquisitionRequest } from '../domain/media-acquisition-contracts.js';
import { validateMediaSelectionRequest } from '../domain/media-selection-contracts.js';
import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import { assertNewPhysicalMediaIdentity } from '../domain/media-identity.js';
import { MediaAssetRepositoryError } from './media-asset.repository.js';
import {
  PostgresMediaCatalogSession,
  mediaCatalogFailure as fail,
  mediaCatalogError,
} from './postgres-media-catalog.session.js';

export type AsyncMediaCatalogRepository = {
  [K in keyof MediaRepository]: MediaRepository[K] extends (
    ...args: infer P
  ) => infer R
    ? (...args: P) => Promise<Awaited<R>>
    : never;
};
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function identifier(value: string, field: string, max = 200) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw fail('INVALID_IDENTIFIER', field, 'identificador inválido');
}
function sameScope(
  a: Record<string, any>,
  b: Record<string, any>,
  code: string,
  fields = ['pipelineRunId', 'projectId', 'projectVersion'],
) {
  for (const field of fields)
    if (a[field] !== b[field]) throw fail(code, field, 'escopo divergente');
}
function lineage(asset: MediaAsset, previous: MediaAsset | null) {
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
  return validateArtifactLineage({
    schemaVersion: 'artifact-lineage/1.0.0',
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
}
export class PostgresMediaCatalogRepository implements AsyncMediaCatalogRepository {
  constructor(private readonly session: PostgresMediaCatalogSession) {}
  async close(): Promise<void> {
    this.session.close();
  }
  private async scope(asset: MediaAsset) {
    const run = await this.session.getRun(asset.pipelineRunId);
    if (!run)
      throw fail(
        'PIPELINE_RUN_NOT_FOUND',
        'pipelineRunId',
        'execução não encontrada',
      );
    sameScope(run, asset, 'MEDIA_ASSET_RUN_SCOPE_MISMATCH');
    const script = await this.session.getScript(asset.scriptId);
    if (!script)
      throw fail('SCRIPT_NOT_FOUND', 'scriptId', 'roteiro não encontrado');
    sameScope(script, asset, 'MEDIA_ASSET_SCRIPT_SCOPE_MISMATCH');
    if (script.contentHash !== asset.scriptContentHash)
      throw fail(
        'SCRIPT_CONTENT_HASH_MISMATCH',
        'scriptContentHash',
        'hash do roteiro divergente',
      );
    if (
      !script.visualDirections.some(
        (d) => d.position === asset.visualDirectionPosition,
      )
    )
      throw fail(
        'VISUAL_DIRECTION_NOT_FOUND',
        'visualDirectionPosition',
        'direção visual não pertence ao roteiro',
      );
  }
  private async previous(asset: MediaAsset): Promise<MediaAsset | null> {
    if (asset.revision === 1) return null;
    const previous = await this.getMediaAsset(asset.supersedesMediaAssetId!);
    if (!previous)
      throw fail(
        'SUPERSEDED_MEDIA_ASSET_NOT_FOUND',
        'supersedesMediaAssetId',
        'ativo anterior não encontrado',
      );
    sameScope(previous, asset, 'MEDIA_ASSET_SUPERSESSION_SCOPE_MISMATCH', [
      'pipelineRunId',
      'projectId',
      'projectVersion',
      'scriptId',
      'visualDirectionPosition',
      'assetType',
    ]);
    if (previous.revision + 1 !== asset.revision)
      throw fail(
        'MEDIA_ASSET_REVISION_MISMATCH',
        'revision',
        'revisão não é sucessora imediata',
      );
    return previous;
  }
  private async register(asset: MediaAsset): Promise<MediaAsset> {
    const prior = (
      await this.session.query(
        'media',
        'SELECT identity_hash FROM media.media_assets WHERE media_asset_id=$1',
        [asset.mediaAssetId],
      )
    ).rows[0];
    if (prior) {
      if (prior.identity_hash !== mediaAssetIdentityHash(asset))
        throw fail(
          'MEDIA_ASSET_ID_REUSED',
          'mediaAssetId',
          'ID já usado com ativo incompatível',
        );
      return (await this.getMediaAsset(asset.mediaAssetId))!;
    }
    assertNewPhysicalMediaIdentity(asset.mediaReference, asset.contentHash);
    if (
      (
        await this.session.query(
          'media',
          'SELECT 1 FROM media.media_assets WHERE script_id=$1 AND visual_direction_position=$2 AND asset_type=$3 AND revision=$4',
          [
            asset.scriptId,
            asset.visualDirectionPosition,
            asset.assetType,
            asset.revision,
          ],
        )
      ).rows.length
    )
      throw fail(
        'MEDIA_ASSET_REVISION_CONFLICT',
        'revision',
        'revisão já registrada para a direção visual',
      );
    await this.scope(asset);
    const previous = await this.previous(asset);
    if (
      previous &&
      (
        await this.session.query(
          'media',
          'SELECT 1 FROM media.media_assets WHERE supersedes_media_asset_id=$1',
          [previous.mediaAssetId],
        )
      ).rows.length
    )
      throw fail(
        'MEDIA_ASSET_ALREADY_SUPERSEDED',
        'supersedesMediaAssetId',
        'ativo já substituído',
      );
    const a = lineage(asset, previous);
    await this.session.query(
      'content',
      `INSERT INTO content.artifact_lineage(artifact_id,schema_version,artifact_type,artifact_version,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12)`,
      [
        a.artifactId,
        a.schemaVersion,
        a.artifactType,
        a.artifactVersion,
        hash(a),
        a.pipelineRunId,
        a.projectId,
        a.projectVersion,
        a.contentIdentity,
        a.hashAlgorithm,
        a.contentHash,
        a.createdAt,
      ],
    );
    for (const input of a.inputs)
      await this.session.query(
        'content',
        'INSERT INTO content.artifact_lineage_inputs(artifact_id,position,kind,input_id,content_hash) VALUES($1,$2,$3,$4,$5)',
        [
          a.artifactId,
          input.position,
          input.kind,
          input.inputId,
          input.contentHash,
        ],
      );
    const t = asset.technicalProperties;
    await this.session.query(
      'media',
      `INSERT INTO media.media_assets(media_asset_id,schema_version,identity_hash,pipeline_run_id,project_id,project_version,script_id,script_content_hash,visual_direction_position,asset_type,media_format,width_pixels,height_pixels,duration_milliseconds,content_hash,media_reference,origin,provider,usage_basis,commercial_use_allowed,created_at,revision,supersedes_media_asset_id,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,1,$20,$21,$22,$23)`,
      [
        asset.mediaAssetId,
        asset.schemaVersion,
        mediaAssetIdentityHash(asset),
        asset.pipelineRunId,
        asset.projectId,
        asset.projectVersion,
        asset.scriptId,
        asset.scriptContentHash,
        asset.visualDirectionPosition,
        asset.assetType,
        t.format,
        t.widthPixels,
        t.heightPixels,
        t.durationMilliseconds,
        asset.contentHash,
        asset.mediaReference,
        asset.origin,
        asset.provider,
        asset.rights.usageBasis,
        asset.createdAt,
        asset.revision,
        asset.supersedesMediaAssetId,
        JSON.stringify(asset),
      ],
    );
    if (asset.source)
      await this.session.query(
        'media',
        'INSERT INTO media.media_asset_sources VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          asset.mediaAssetId,
          asset.provider,
          asset.source.externalAssetId,
          asset.source.licenseName,
          asset.source.licenseUrl,
          asset.source.photographerName,
          asset.source.photographerUrl,
          asset.source.sourceUrl,
        ],
      );
    return (await this.getMediaAsset(asset.mediaAssetId))!;
  }
  async registerMediaAsset(value: unknown): Promise<MediaAsset> {
    let asset: MediaAsset;
    try {
      asset = validateMediaAsset(value);
    } catch (error) {
      throw mediaCatalogError(error);
    }
    return this.session.run(() => this.register(asset), true);
  }
  async getMediaAsset(id: string): Promise<MediaAsset | null> {
    identifier(id, 'mediaAssetId');
    return this.session.run(() => this.read(id, new Set()));
  }
  private async read(
    id: string,
    seen: Set<string>,
  ): Promise<MediaAsset | null> {
    if (seen.has(id))
      throw fail(
        'INVALID_PERSISTED_MEDIA_ASSET',
        'mediaAssetId',
        'ciclo de supersession',
      );
    seen.add(id);
    const row = (
      await this.session.query(
        'media',
        'SELECT * FROM media.media_assets WHERE media_asset_id=$1',
        [id],
      )
    ).rows[0];
    if (!row) return null;
    try {
      const asset = validateMediaAsset(JSON.parse(row.payload_json));
      const t = asset.technicalProperties;
      const expected: Record<string, unknown> = {
        media_asset_id: asset.mediaAssetId,
        schema_version: asset.schemaVersion,
        identity_hash: mediaAssetIdentityHash(asset),
        pipeline_run_id: asset.pipelineRunId,
        project_id: asset.projectId,
        project_version: asset.projectVersion,
        script_id: asset.scriptId,
        script_content_hash: asset.scriptContentHash,
        visual_direction_position: asset.visualDirectionPosition,
        asset_type: asset.assetType,
        media_format: t.format,
        width_pixels: t.widthPixels,
        height_pixels: t.heightPixels,
        duration_milliseconds: t.durationMilliseconds,
        content_hash: asset.contentHash,
        media_reference: asset.mediaReference,
        origin: asset.origin,
        provider: asset.provider,
        usage_basis: asset.rights.usageBasis,
        commercial_use_allowed: 1,
        created_at: asset.createdAt,
        revision: asset.revision,
        supersedes_media_asset_id: asset.supersedesMediaAssetId,
      };
      if (Object.entries(expected).some(([k, v]) => row[k] !== v))
        throw new Error('INVALID_COLUMNS');
      const source = (
        await this.session.query(
          'media',
          'SELECT * FROM media.media_asset_sources WHERE media_asset_id=$1',
          [id],
        )
      ).rows[0];
      if (!asset.source) {
        if (source) throw new Error('UNEXPECTED_SOURCE');
      } else {
        const fields = {
          provider: asset.provider,
          external_asset_id: asset.source.externalAssetId,
          license_name: asset.source.licenseName,
          license_url: asset.source.licenseUrl,
          photographer_name: asset.source.photographerName,
          photographer_url: asset.source.photographerUrl,
          source_url: asset.source.sourceUrl,
        };
        if (!source || Object.entries(fields).some(([k, v]) => source[k] !== v))
          throw new Error('INVALID_SOURCE');
      }
      await this.scope(asset);
      const previous = asset.supersedesMediaAssetId
        ? await this.read(asset.supersedesMediaAssetId, seen)
        : null;
      if (asset.revision > 1 && !previous) throw new Error('MISSING_PREVIOUS');
      if (previous) {
        sameScope(previous, asset, 'MEDIA_ASSET_SUPERSESSION_SCOPE_MISMATCH', [
          'pipelineRunId',
          'projectId',
          'projectVersion',
          'scriptId',
          'visualDirectionPosition',
          'assetType',
        ]);
        if (previous.revision + 1 !== asset.revision)
          throw new Error('INVALID_REVISION');
      }
      const a = lineage(asset, previous);
      const stored = (
        await this.session.query(
          'content',
          'SELECT * FROM content.artifact_lineage WHERE artifact_id=$1',
          [id],
        )
      ).rows[0];
      const inputs = (
        await this.session.query(
          'content',
          'SELECT position,kind,input_id AS "inputId",content_hash AS "contentHash" FROM content.artifact_lineage_inputs WHERE artifact_id=$1 ORDER BY position',
          [id],
        )
      ).rows;
      if (!stored) throw new Error('MISSING_LINEAGE');
      const actual = validateArtifactLineage({
        schemaVersion: stored.schema_version,
        artifactId: stored.artifact_id,
        artifactType: stored.artifact_type,
        artifactVersion: stored.artifact_version,
        pipelineRunId: stored.pipeline_run_id,
        projectId: stored.project_id,
        projectVersion: stored.project_version,
        contentIdentity: stored.content_identity,
        hashAlgorithm: stored.hash_algorithm,
        contentHash: stored.content_hash,
        inputs,
        generationMetadata:
          stored.generation_metadata_json === null
            ? null
            : JSON.parse(stored.generation_metadata_json),
        createdAt: stored.created_at,
      });
      if (
        stored.identity_hash !== hash(actual) ||
        JSON.stringify(actual) !== JSON.stringify(a)
      )
        throw new Error('INVALID_LINEAGE');
      return asset;
    } catch (error) {
      if (error instanceof MediaAssetRepositoryError) throw error;
      throw fail(
        'INVALID_PERSISTED_MEDIA_ASSET',
        'mediaAssetId',
        'ativo persistido inválido',
      );
    }
  }
  private async list(sql: string, args: unknown[]): Promise<MediaAsset[]> {
    return this.session.run(async () => {
      const rows = (await this.session.query('media', sql, args)).rows;
      const assets: MediaAsset[] = [];
      for (const row of rows)
        assets.push((await this.getMediaAsset(row.media_asset_id))!);
      return assets;
    });
  }
  async listMediaAssetsByPipelineRun(id: string): Promise<MediaAsset[]> {
    identifier(id, 'pipelineRunId', 80);
    return this.list(
      'SELECT media_asset_id FROM media.media_assets WHERE pipeline_run_id=$1 ORDER BY created_at,script_id,visual_direction_position,asset_type,revision,media_asset_id',
      [id],
    );
  }
  async listMediaAssetsByScript(id: string): Promise<MediaAsset[]> {
    identifier(id, 'scriptId');
    return this.list(
      'SELECT media_asset_id FROM media.media_assets WHERE script_id=$1 ORDER BY visual_direction_position,asset_type,revision,media_asset_id',
      [id],
    );
  }
  async listMediaAssetsByVisualDirection(
    id: string,
    position: number,
  ): Promise<MediaAsset[]> {
    identifier(id, 'scriptId');
    if (!Number.isSafeInteger(position) || position < 1)
      throw fail(
        'INVALID_VISUAL_DIRECTION_POSITION',
        'visualDirectionPosition',
        'inteiro positivo obrigatório',
      );
    return this.list(
      'SELECT media_asset_id FROM media.media_assets WHERE script_id=$1 AND visual_direction_position=$2 ORDER BY asset_type,revision,media_asset_id',
      [id, position],
    );
  }
  async registerAcquiredMediaAsset(value: unknown): Promise<MediaAsset> {
    const input = value as {
      request: unknown;
      mediaAsset: unknown;
      telemetry?: unknown;
      costEvent?: unknown;
    };
    if (input.telemetry != null || input.costEvent != null)
      throw fail(
        'MEDIA_FINANCE_DEPENDENCY_REQUIRED',
        'telemetry',
        'persistência financeira pertence a Finance',
      );
    let request, asset;
    try {
      request = validateMediaAcquisitionRequest(input.request);
      asset = validateMediaAsset(input.mediaAsset);
    } catch (error) {
      throw mediaCatalogError(error);
    }
    return this.session.run(async () => {
      const prior = await this.getMediaAcquisition(
        request.mediaAcquisitionRequestId,
      );
      if (prior) {
        if (prior.requestHash !== request.contentHash)
          throw fail(
            'MEDIA_ACQUISITION_REQUEST_ID_REUSED',
            'mediaAcquisitionRequestId',
            'identidade já usada com conteúdo divergente',
          );
        return prior.mediaAsset;
      }
      sameScope(request, asset, 'MEDIA_ACQUISITION_SCOPE_MISMATCH', [
        'scriptId',
        'scriptContentHash',
        'visualDirectionPosition',
        'assetType',
      ]);
      if (request.requestedAt !== asset.createdAt)
        throw fail(
          'MEDIA_ACQUISITION_SCOPE_MISMATCH',
          'requestedAt',
          'solicitação diverge do ativo',
        );
      if (
        asset.mediaAssetId !==
        `media_asset:${request.mediaAcquisitionRequestId}`
      )
        throw fail(
          'MEDIA_ACQUISITION_SCOPE_MISMATCH',
          'mediaAssetId',
          'solicitação diverge do ativo',
        );
      if (asset.revision !== 1 || asset.supersedesMediaAssetId !== null)
        throw fail(
          'MEDIA_ACQUISITION_SCOPE_MISMATCH',
          'revision',
          'aquisição inicial inválida',
        );
      const created = await this.register(asset);
      await this.session.query(
        'media',
        'INSERT INTO media.media_acquisition_requests VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          request.mediaAcquisitionRequestId,
          request.schemaVersion,
          request.contentHash,
          request.scriptId,
          request.scriptContentHash,
          request.visualDirectionPosition,
          request.assetType,
          created.mediaAssetId,
          request.requestedAt,
        ],
      );
      return created;
    }, true);
  }
  async getMediaAcquisition(id: string): Promise<AcquisitionReceipt | null> {
    identifier(id, 'mediaAcquisitionRequestId', 180);
    return this.session.run(async () => {
      const row = (
        await this.session.query(
          'media',
          'SELECT * FROM media.media_acquisition_requests WHERE media_acquisition_request_id=$1',
          [id],
        )
      ).rows[0];
      if (!row) return null;
      try {
        const request = validateMediaAcquisitionRequest({
          schemaVersion: row.schema_version,
          mediaAcquisitionRequestId: id,
          scriptId: row.script_id,
          scriptContentHash: row.script_content_hash,
          visualDirectionPosition: row.visual_direction_position,
          assetType: row.asset_type,
          requestedAt: row.created_at,
          contentHash: row.request_hash,
        });
        const asset = await this.getMediaAsset(row.media_asset_id);
        if (
          !asset ||
          asset.mediaAssetId !== `media_asset:${id}` ||
          asset.createdAt !== request.requestedAt ||
          asset.scriptId !== request.scriptId ||
          asset.scriptContentHash !== request.scriptContentHash ||
          asset.visualDirectionPosition !== request.visualDirectionPosition ||
          asset.assetType !== request.assetType
        )
          throw new Error('INVALID_BINDING');
        return Object.freeze({
          requestHash: request.contentHash,
          mediaAsset: asset,
        });
      } catch (error) {
        if (error instanceof MediaAssetRepositoryError) throw error;
        throw fail(
          'INVALID_PERSISTED_MEDIA_ACQUISITION',
          'mediaAcquisitionRequestId',
          'aquisição persistida inválida',
        );
      }
    });
  }
  async registerMediaSelection(value: unknown): Promise<MediaAsset> {
    const input = value as {
      request: unknown;
      mediaAsset: unknown;
      fallbackCode?: string | null;
    };
    let request, asset;
    try {
      request = validateMediaSelectionRequest(input.request);
      asset = validateMediaAsset(input.mediaAsset);
    } catch (error) {
      throw mediaCatalogError(error);
    }
    const fallback = input.fallbackCode ?? null;
    return this.session.run(async () => {
      const prior = await this.getMediaSelection(
        request.mediaSelectionRequestId,
      );
      if (prior) {
        if (prior.requestHash !== request.contentHash)
          throw fail(
            'MEDIA_SELECTION_REQUEST_ID_REUSED',
            'mediaSelectionRequestId',
            'identidade divergente',
          );
        return prior.mediaAsset;
      }
      if (
        asset.scriptId !== request.scriptId ||
        asset.scriptContentHash !== request.scriptContentHash ||
        asset.visualDirectionPosition !== request.visualDirectionPosition
      )
        throw fail(
          'MEDIA_SELECTION_SCOPE_MISMATCH',
          'mediaAsset',
          'ativo fora do escopo',
        );
      const requested =
        request.productionProfile === 'MIXED_MEDIA_V2' ? 'VIDEO' : 'IMAGE';
      if (
        asset.assetType !== requested &&
        !(
          requested === 'VIDEO' &&
          asset.assetType === 'IMAGE' &&
          fallback === 'PROVIDER_NO_ELIGIBLE_VIDEO'
        )
      )
        throw fail(
          'MEDIA_SELECTION_FALLBACK_INVALID',
          'fallbackCode',
          'fallback inválido',
        );
      await this.session.query(
        'media',
        'INSERT INTO media.media_selection_requests VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          request.mediaSelectionRequestId,
          request.schemaVersion,
          request.contentHash,
          request.scriptId,
          request.scriptContentHash,
          request.visualDirectionPosition,
          request.productionProfile,
          requested,
          asset.assetType,
          asset.mediaAssetId,
          fallback,
          request.requestedAt,
        ],
      );
      return (await this.getMediaSelection(request.mediaSelectionRequestId))!
        .mediaAsset;
    }, true);
  }
  async getMediaSelection(id: string): Promise<SelectionReceipt | null> {
    identifier(id, 'mediaSelectionRequestId', 160);
    return this.session.run(async () => {
      const row = (
        await this.session.query(
          'media',
          'SELECT * FROM media.media_selection_requests WHERE media_selection_request_id=$1',
          [id],
        )
      ).rows[0];
      if (!row) return null;
      try {
        validateMediaSelectionRequest({
          schemaVersion: row.schema_version,
          mediaSelectionRequestId: id,
          scriptId: row.script_id,
          scriptContentHash: row.script_content_hash,
          visualDirectionPosition: row.visual_direction_position,
          productionProfile: row.production_profile,
          requestedAt: row.created_at,
          contentHash: row.request_hash,
        });
        const asset = await this.getMediaAsset(row.media_asset_id);
        if (
          !asset ||
          asset.scriptId !== row.script_id ||
          asset.scriptContentHash !== row.script_content_hash ||
          asset.visualDirectionPosition !== row.visual_direction_position ||
          row.selected_asset_type !== asset.assetType ||
          (row.production_profile === 'STATIC_IMAGE_V1' &&
            asset.assetType !== 'IMAGE')
        )
          throw new Error('INVALID_SELECTION');
        return Object.freeze({
          requestHash: row.request_hash,
          productionProfile: row.production_profile,
          requestedAssetType: row.requested_asset_type,
          selectedAssetType: row.selected_asset_type,
          fallbackCode: row.fallback_code,
          mediaAsset: asset,
        });
      } catch (error) {
        if (error instanceof MediaAssetRepositoryError) throw error;
        throw fail(
          'INVALID_PERSISTED_MEDIA_SELECTION',
          'mediaSelectionRequestId',
          'seleção persistida inválida',
        );
      }
    });
  }
}
export class PostgresMediaCatalogPersistence {
  constructor(private readonly database: PostgresDatabase) {}
  async open(readOnly = false): Promise<PostgresMediaCatalogRepository> {
    await PostgresMediaCatalogSession.verify(this.database);
    return new PostgresMediaCatalogRepository(
      new PostgresMediaCatalogSession(this.database, readOnly),
    );
  }
}
