import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'pg';
import {
  PostgresDatabase,
  PostgresError,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import { PostgresContentPersistence } from '../../content/infrastructure/postgres-content.persistence.js';
import { PostgresOperationsPersistence } from '../../content-operations/infrastructure/postgres-campaign.persistence.js';
import { MediaAssetRepositoryError } from './media-asset.repository.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import { MEDIA_CATALOG_POSTGRES_MIGRATION_REGISTRY } from './postgres-media-catalog.migrations.js';

export const MEDIA_CATALOG_PARTICIPANTS = [
  'content',
  'affiliate',
  'campaign',
  'media',
] as const;
export const mediaCatalogFailure = (
  code: string,
  field: string,
  message: string,
) => new MediaAssetRepositoryError(code, field, message);
export function mediaCatalogError(error: unknown): unknown {
  if (error instanceof MediaAssetRepositoryError) return error;
  if (error instanceof ContractValidationError)
    return mediaCatalogFailure(
      error.code,
      error.path,
      'contrato de ativo de mídia inválido',
    );
  if (
    error instanceof PostgresError &&
    [
      'POSTGRES_PARTICIPATION_REQUIRED',
      'POSTGRES_PARTICIPANT_NOT_ENLISTED',
      'POSTGRES_UNIT_OF_WORK_REQUIRES_ROOT',
      'POSTGRES_DIFFERENT_DATABASE',
    ].includes(error.code)
  )
    return mediaCatalogFailure(
      'MEDIA_CROSS_DOMAIN_TRANSACTION_REQUIRED',
      'database',
      'participantes canônicos requeridos antes da transação',
    );
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  const mapped: Record<string, [string, string, string]> = {
    P7001: [
      'MEDIA_ASSET_SCOPE_MISMATCH',
      'scriptId',
      'artefatos fora do escopo',
    ],
    P7002: ['MEDIA_ASSET_REVISION_MISMATCH', 'revision', 'revisão inválida'],
    P7003: [
      'MEDIA_ACQUISITION_SCOPE_MISMATCH',
      'mediaAcquisitionRequestId',
      'solicitação fora do escopo',
    ],
    P7005: [
      'INVALID_PERSISTED_MEDIA_ASSET',
      'mediaAssetId',
      'proveniência divergente',
    ],
    P7006: ['IMMUTABLE_MEDIA_ASSET', 'mediaAssetId', 'ativo imutável'],
  };
  if (typeof code === 'string' && mapped[code])
    return mediaCatalogFailure(...mapped[code]);
  if (
    error instanceof PostgresError ||
    (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code))
  )
    return mediaCatalogFailure(
      'MEDIA_ASSET_PERSISTENCE_FAILED',
      'mediaAsset',
      'não foi possível persistir o ativo',
    );
  return error;
}
export class PostgresMediaCatalogSession {
  private readonly scope = new AsyncLocalStorage<{ active: boolean }>();
  private closed = false;
  constructor(
    private readonly database: PostgresDatabase,
    private readonly readOnly: boolean,
  ) {}
  static async verify(database: PostgresDatabase): Promise<void> {
    let rows;
    try {
      rows = (
        await database.query(
          'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
          [],
          'media',
        )
      ).rows;
    } catch (error) {
      if (error instanceof PostgresError && error.sqlState === '42P01')
        throw mediaCatalogFailure(
          'MEDIA_CATALOG_SCHEMA_VERSION_UNSUPPORTED',
          'schemaVersion',
          'migration v7 requerida',
        );
      throw mediaCatalogError(error);
    }
    if (
      MEDIA_CATALOG_POSTGRES_MIGRATION_REGISTRY.some(
        (m) =>
          !rows.some(
            (r) =>
              r.version === m.version &&
              r.name === m.name &&
              r.checksum === postgresMigrationChecksum(m.sql),
          ),
      )
    )
      throw mediaCatalogFailure(
        'MEDIA_CATALOG_SCHEMA_VERSION_UNSUPPORTED',
        'schemaVersion',
        'registro de migrations inválido',
      );
  }
  close(): void {
    this.closed = true;
  }
  async run<T>(work: () => Promise<T>, write = false): Promise<T> {
    if (this.closed)
      throw mediaCatalogFailure(
        'MEDIA_CATALOG_HANDLE_CLOSED',
        'storage',
        'sessão encerrada',
      );
    if (write && this.readOnly)
      throw mediaCatalogFailure(
        'MEDIA_CATALOG_READ_ONLY',
        'storage',
        'sessão somente leitura',
      );
    const current = this.scope.getStore();
    if (current && !current.active)
      throw mediaCatalogFailure(
        'MEDIA_CATALOG_TRANSACTION_ENDED',
        'storage',
        'transação encerrada',
      );
    try {
      if (current)
        return await this.database.transaction(
          async () => await work(),
          'media',
        );
      return await this.database.unitOfWork(MEDIA_CATALOG_PARTICIPANTS, () =>
        this.database.transaction(async () => {
          const scope = { active: true };
          try {
            return await this.scope.run(scope, work);
          } finally {
            scope.active = false;
          }
        }, 'media'),
      );
    } catch (error) {
      throw mediaCatalogError(error);
    }
  }
  async query(
    participant: 'content' | 'media',
    text: string,
    values: unknown[] = [],
  ) {
    if (this.closed || !this.scope.getStore()?.active)
      throw mediaCatalogFailure(
        'MEDIA_CATALOG_SESSION_INACTIVE',
        'storage',
        'sessão inativa',
      );
    try {
      return await this.database.transaction(async (client) => {
        const result = await client.query({
          text,
          values,
          types: {
            getTypeParser: (oid: number, format?: string) =>
              oid === 114
                ? (value: string) => value
                : types.getTypeParser(oid, format as 'text'),
          },
        });
        for (const row of result.rows)
          for (const field of result.fields)
            if (field.dataTypeID === 20 && row[field.name] !== null) {
              const value = Number(row[field.name]);
              if (!Number.isSafeInteger(value))
                throw new Error('MEDIA_UNSAFE_INTEGER');
              row[field.name] = value;
            }
        return result;
      }, participant);
    } catch (error) {
      throw mediaCatalogError(error);
    }
  }
  async getRun(id: string) {
    const handle = await new PostgresOperationsPersistence(this.database).open(
      true,
    );
    try {
      return await handle.getRun(id);
    } finally {
      await handle.close();
    }
  }
  async getScript(id: string) {
    const version = (
      await this.query(
        'content',
        'SELECT schema_version FROM content.scripts WHERE script_id=$1',
        [id],
      )
    ).rows[0];
    if (!version) return null;
    if (version.schema_version !== 'script/2.0.0')
      throw mediaCatalogFailure(
        'MEDIA_CONTENT_CONTEXT_REQUIRED',
        'scriptId',
        'leitura Research da composição Content ainda não coordenada',
      );
    const handle = await PostgresContentPersistence.coordinated(
      this.database,
    ).open(true);
    try {
      return await handle.getScript(id);
    } finally {
      await handle.close();
    }
  }
}
