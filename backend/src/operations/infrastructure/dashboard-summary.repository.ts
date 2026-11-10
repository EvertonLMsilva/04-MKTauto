import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import {
  measuredKeys,
  type DashboardReadSnapshot,
  type DashboardSummaryReader,
  type Measurement,
  type UnavailableReason,
} from '../dashboard-summary.contract.js';

const unavailable = (reason: UnavailableReason): Measurement => ({
  value: null,
  reason,
});
const available = (value: number): Measurement => ({ value, reason: null });
class SourceError extends Error {
  constructor(readonly reason: UnavailableReason) {
    super(reason);
  }
}
function readMetric(action: () => Measurement): Measurement {
  try {
    return action();
  } catch (error) {
    return unavailable(
      error instanceof SourceError ? error.reason : 'SOURCE_READ_FAILED',
    );
  }
}
function missingSnapshot(
  reason: UnavailableReason,
  generatedAt: string,
): DashboardReadSnapshot {
  return {
    generatedAt,
    publicationMode: null,
    ...Object.fromEntries(
      measuredKeys.map((key) => [key, unavailable(reason)]),
    ),
  } as DashboardReadSnapshot;
}

/** No operational database is opened until an authorized request calls read(). */
export class SqliteDashboardSummaryRepository implements DashboardSummaryReader {
  constructor(
    private readonly path: string | null,
    private readonly now = () => new Date(),
  ) {}

  read(): DashboardReadSnapshot {
    const generatedAt = this.now().toISOString();
    if (!this.path || !isAbsolute(this.path))
      return missingSnapshot('DATABASE_NOT_CONFIGURED', generatedAt);
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(this.path, { readOnly: true });
    } catch {
      return missingSnapshot('DATABASE_UNAVAILABLE', generatedAt);
    }
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN');
      const version = this.schemaVersion(db);
      const result = missingSnapshot('SOURCE_READ_FAILED', generatedAt);
      result.runningExecutions = readMetric(() =>
        available(
          Number(
            db
              .prepare(
                "SELECT COUNT(*) n FROM campaign_executions WHERE status='RUNNING'",
              )
              .get()!.n,
          ),
        ),
      );
      result.generatedMedia = readMetric(() => {
        db.prepare(
          'SELECT origin,content_hash,media_reference,revision FROM media_assets LIMIT 0',
        ).all();
        // A persisted reference (including CAS) is not proof that bytes exist.
        // Do not count jobs, claimed origins or hashes as materialized content.
        return unavailable('MEDIA_MATERIALIZATION_NOT_PROVEN');
      });
      try {
        const publications = this.publications(db, version);
        result.publicationMode = publications.mode;
        result.socialPublicationsFake =
          publications.mode === 'fake'
            ? available(publications.count)
            : unavailable('PUBLICATION_MODE_NOT_IN_SOURCE');
        result.socialPublicationsLive =
          publications.mode === 'live'
            ? available(publications.count)
            : unavailable('PUBLICATION_MODE_NOT_IN_SOURCE');
      } catch (error) {
        const reason =
          error instanceof SourceError ? error.reason : 'SOURCE_READ_FAILED';
        result.socialPublicationsFake = result.socialPublicationsLive =
          unavailable(reason);
      }
      try {
        const quality = this.quality(db);
        result.qcApproved = available(quality.approved);
        result.qcEvaluated = available(quality.evaluated);
      } catch (error) {
        const reason =
          error instanceof SourceError ? error.reason : 'SOURCE_READ_FAILED';
        result.qcApproved = result.qcEvaluated = unavailable(reason);
      }
      db.exec('COMMIT');
      return result;
    } catch (error) {
      return missingSnapshot(
        error instanceof SourceError ? error.reason : 'SOURCE_READ_FAILED',
        generatedAt,
      );
    } finally {
      if (db.isTransaction) db.exec('ROLLBACK');
      db.close();
    }
  }

  private schemaVersion(db: DatabaseSync): number {
    try {
      const version = Number(
        db.prepare('PRAGMA user_version').get()!.user_version,
      );
      if (![41, 42, 43, 44].includes(version)) throw new Error();
      const names = [
        '041_campaign_orchestration',
        '042_instagram_publication',
        '043_multi_network_publication_reservations',
        '044_facebook_publication_supersession',
      ];
      for (let current = 41; current <= version; current++) {
        if (
          db
            .prepare('SELECT name FROM schema_migrations WHERE version=?')
            .get(current)?.name !== names[current - 41]
        )
          throw new Error();
      }
      return version;
    } catch {
      throw new SourceError('SCHEMA_INCOMPATIBLE');
    }
  }

  private publications(
    db: DatabaseSync,
    version: number,
  ): { mode: 'fake' | 'live'; count: number } {
    let context: Record<string, unknown> | undefined;
    try {
      context = db
        .prepare(
          'SELECT execution_mode,database_id FROM social_publication_context WHERE singleton=1',
        )
        .get();
    } catch {
      throw new SourceError('PUBLICATION_SCOPE_UNAVAILABLE');
    }
    if (
      !context ||
      !['fake', 'live'].includes(String(context.execution_mode)) ||
      typeof context.database_id !== 'string' ||
      !context.database_id.trim()
    )
      throw new SourceError('PUBLICATION_SCOPE_UNAVAILABLE');
    const root =
      version === 44
        ? 'COALESCE(root_operation_id,operation_id)'
        : 'operation_id';
    const row = db
      .prepare(
        `WITH source AS (
      SELECT operation_id,account_id,package_hash,${root} root_id,
        json_valid(payload_json) valid_json,
        CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END payload
      FROM social_publication_operations
    ), operations AS (
      SELECT *,json_extract(payload,'$.state') state,
        COALESCE(json_extract(payload,'$.network'),'INSTAGRAM') network,
        json_extract(payload,'$.mediaId') media_id FROM source
    ), invalid AS (
      SELECT COUNT(*) n FROM operations WHERE NOT (valid_json AND
        CASE WHEN json_extract(payload,'$.executionMode')=? AND json_extract(payload,'$.databaseId')=?
          AND json_type(payload,'$.operationId')='text' AND json_extract(payload,'$.operationId')=operation_id
          AND json_type(payload,'$.accountId')='text' AND json_extract(payload,'$.accountId')=account_id
          AND json_type(payload,'$.packageHash')='text' AND json_extract(payload,'$.packageHash')=package_hash
          AND state IN ('PREPARED','CREATING_CONTAINER','PROCESSING','READY','PUBLISHING','PUBLISHED','UNCERTAIN','FAILED','EXPIRED','BLOCKED')
          AND network IN ('INSTAGRAM','FACEBOOK_REELS') AND length(trim(account_id))>0
          AND length(package_hash)=64 AND package_hash NOT GLOB '*[^0-9a-f]*'
          AND length(trim(root_id))>0
          AND (state<>'PUBLISHED' OR (json_type(payload,'$.mediaId')='text' AND length(trim(media_id))>0))
        THEN 1 ELSE 0 END)
    ), posts AS (
      SELECT network,account_id,media_id,COUNT(DISTINCT root_id) roots,COUNT(DISTINCT package_hash) packages
      FROM operations WHERE state='PUBLISHED' GROUP BY network,account_id,media_id
    ) SELECT (SELECT n FROM invalid) invalid,
      (SELECT COUNT(*) FROM posts WHERE roots>1 OR packages>1) conflicts,
      (SELECT COUNT(*) FROM posts) total`,
      )
      .get(context.execution_mode as string, context.database_id)!;
    if (Number(row.invalid))
      throw new SourceError('INVALID_PUBLICATION_SOURCE');
    if (Number(row.conflicts))
      throw new SourceError('PUBLICATION_IDENTITY_CONFLICT');
    return {
      mode: context.execution_mode as 'fake' | 'live',
      count: Number(row.total),
    };
  }

  private quality(db: DatabaseSync): { approved: number; evaluated: number } {
    const row = db
      .prepare(
        `/* dashboard_qc */ WITH reports AS (
      SELECT *,CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END payload,
        json_valid(payload_json) valid_json FROM quality_control_reports
    ), invalid AS (
      SELECT COUNT(*) n FROM reports WHERE NOT (valid_json AND CASE WHEN
        schema_version='quality-control-report/1.0.0' AND policy_version='quality-control-policy/1.0.0'
        AND result IN ('PASS','WARN','FAIL') AND approval_blocked=CASE WHEN result='FAIL' THEN 1 ELSE 0 END
        AND length(trim(video_render_id))>0 AND julianday(checked_at) IS NOT NULL
        AND length(video_render_content_hash)=64 AND video_render_content_hash NOT GLOB '*[^0-9a-f]*'
        AND length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*'
        AND json_extract(payload,'$.schemaVersion')=schema_version
        AND json_extract(payload,'$.policyVersion')=policy_version
        AND json_extract(payload,'$.qualityControlReportId')=quality_control_report_id
        AND json_extract(payload,'$.videoRenderId')=video_render_id
        AND json_extract(payload,'$.videoRenderContentHash')=video_render_content_hash
        AND json_extract(payload,'$.result')=result
        AND json_type(payload,'$.approvalBlocked') IN ('true','false')
        AND json_extract(payload,'$.approvalBlocked')=approval_blocked
        AND json_extract(payload,'$.checkedAt')=checked_at
        AND json_extract(payload,'$.contentHash')=content_hash
      THEN 1 ELSE 0 END)
    ), evaluations AS (
      SELECT policy_version,video_render_id,video_render_content_hash,COUNT(*) copies,MIN(result) result
      FROM reports GROUP BY policy_version,video_render_id,video_render_content_hash
    ) SELECT (SELECT n FROM invalid) invalid,
      (SELECT COUNT(*) FROM evaluations WHERE copies>1) conflicts,
      (SELECT COUNT(*) FROM evaluations) evaluated,
      (SELECT COUNT(*) FROM evaluations WHERE result='PASS') approved`,
      )
      .get()!;
    if (Number(row.invalid)) throw new SourceError('INVALID_QC_SOURCE');
    if (Number(row.conflicts)) throw new SourceError('QC_IDENTITY_CONFLICT');
    return { approved: Number(row.approved), evaluated: Number(row.evaluated) };
  }
}
