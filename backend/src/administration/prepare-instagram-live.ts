import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from './schema-provisioner.js';

type Row = Record<string, string | number | bigint | null>;
const allowed = new Set([
  'projects',
  'project_snapshots',
  'affiliate_product_revisions',
  'affiliate_campaign_revisions',
  'affiliate_briefings',
  'pipeline_runs',
  'pipeline_run_transitions',
  'pipeline_run_recoveries',
  'affiliate_run_bindings',
  'affiliate_editorial_selections',
  'idea_candidates',
  'idea_selections',
  'scripts',
  'media_assets',
  'voice_tracks',
  'composition_plans',
  'composition_plan_v2_details',
  'composition_plan_v2_segments',
  'video_renders',
  'video_composition_requests',
  'artifact_lineage',
  'artifact_lineage_inputs',
  'manual_distribution_records',
  'campaign_executions',
  'campaign_execution_events',
]);

export interface InstagramLivePreparation {
  source: string;
  target: string;
  executionId: string;
  packageHash: string;
  accountId: string;
  renderHash: string;
}

/** Copies only the approved local artifact closure. Remote and fake social state never crosses databases. */
export function prepareInstagramLive(input: InstagramLivePreparation) {
  const sourcePath = resolve(input.source);
  const targetPath = resolve(input.target);
  if (sourcePath === targetPath) throw new Error('LIVE_SOURCE_EQUALS_TARGET');
  if (!existsSync(sourcePath)) throw new Error('LIVE_SOURCE_NOT_FOUND');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let target: DatabaseSync | undefined;
  try {
    source.exec('PRAGMA query_only=ON');
    mkdirSync(dirname(targetPath), { recursive: true });
    const fresh = !existsSync(targetPath);
    target = new DatabaseSync(targetPath);
    if (
      fresh ||
      Number(target.prepare('PRAGMA user_version').get()?.user_version) === 0
    ) {
      if (
        !fresh &&
        target
          .prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
          .get()
      )
        throw new Error('LIVE_DESTINATION_NOT_EMPTY');
      provisionSchema(target, 41);
      target.exec(
        "CREATE TABLE social_publication_context (singleton INTEGER PRIMARY KEY CHECK(singleton=1), execution_mode TEXT NOT NULL CHECK(execution_mode IN ('fake','live')), database_id TEXT NOT NULL)",
      );
      target
        .prepare('INSERT INTO social_publication_context VALUES(1,?,?)')
        .run('live', randomUUID());
    }
    provisionSchema(target);
    if (
      target
        .prepare(
          'SELECT execution_mode FROM social_publication_context WHERE singleton=1',
        )
        .get()?.execution_mode !== 'live'
    )
      throw new Error('LIVE_CONTEXT_MISMATCH');

    const execution = source
      .prepare('SELECT * FROM campaign_executions WHERE execution_id=?')
      .get(input.executionId) as Row | undefined;
    const packageRow = source
      .prepare(
        "SELECT * FROM manual_distribution_records WHERE kind='PACKAGE' AND record_id=?",
      )
      .get(input.packageHash) as Row | undefined;
    const reviewRow = source
      .prepare(
        "SELECT * FROM manual_distribution_records WHERE kind='REVIEW' AND record_id=?",
      )
      .get(input.packageHash) as Row | undefined;
    if (!execution || !packageRow || !reviewRow)
      throw new Error('LIVE_APPROVED_SOURCE_REQUIRED');
    const pkg = JSON.parse(String(packageRow.payload_json));
    const review = JSON.parse(String(reviewRow.payload_json));
    if (
      pkg.contentHash !== input.packageHash ||
      review.packageHash !== input.packageHash ||
      review.mediaDecision?.decision !== 'APPROVED' ||
      pkg.account !== input.accountId ||
      pkg.identity?.videoRenderContentHash !== input.renderHash ||
      pkg.identity?.pipelineRunId !== execution.run_id ||
      pkg.campaignId !== execution.campaign_id ||
      review.mediaDecision?.videoRenderContentHash !==
        pkg.identity?.videoRenderContentHash
    )
      throw new Error('LIVE_PACKAGE_APPROVAL_MISMATCH');
    if (
      source
        .prepare(
          'SELECT 1 FROM instagram_approval_revocations WHERE review_hash=?',
        )
        .get(review.contentHash)
    )
      throw new Error('LIVE_APPROVAL_REVOKED');
    if (
      source
        .prepare(
          "SELECT 1 FROM social_publication_operations WHERE json_extract(payload_json,'$.mediaHash')=? AND json_extract(payload_json,'$.executionMode')='live' LIMIT 1",
        )
        .get(pkg.identity.videoRenderContentHash)
    )
      throw new Error('LIVE_SOURCE_OPERATION_PRESENT');
    if (
      source
        .prepare(
          "SELECT 1 FROM manual_distribution_records WHERE kind='PUBLICATION' AND package_hash=?",
        )
        .get(input.packageHash)
    )
      throw new Error('LIVE_SOURCE_PUBLICATION_PRESENT');
    if (
      target
        .prepare('SELECT 1 FROM social_publication_operations LIMIT 1')
        .get() ||
      target
        .prepare('SELECT 1 FROM instagram_publication_reservations LIMIT 1')
        .get()
    )
      throw new Error('LIVE_DESTINATION_OPERATION_PRESENT');

    target.exec('BEGIN IMMEDIATE');
    try {
      const destination = target;
      const visited = new Set<string>();
      const columns = (table: string) => {
        if (!allowed.has(table))
          throw new Error(`LIVE_TABLE_OUT_OF_SCOPE:${table}`);
        return source.prepare(`PRAGMA table_info(${table})`).all() as {
          name: string;
          pk: number;
        }[];
      };
      const copy = (table: string, row: Row | undefined): void => {
        if (!row) throw new Error(`LIVE_DEPENDENCY_MISSING:${table}`);
        const cols = columns(table);
        const keys = cols
          .filter((c) => c.pk)
          .sort((a, b) => a.pk - b.pk)
          .map((c) => c.name);
        const values = keys.map((k) => row[k]);
        const key = `${table}:${JSON.stringify(values)}`;
        if (visited.has(key)) return;
        visited.add(key);
        const fks = source
          .prepare(`PRAGMA foreign_key_list(${table})`)
          .all() as {
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string;
        }[];
        for (const id of new Set(fks.map((fk) => fk.id))) {
          const group = fks
            .filter((fk) => fk.id === id)
            .sort((a, b) => a.seq - b.seq);
          if (group.some((fk) => row[fk.from] === null)) continue;
          const parent = group[0]!.table;
          if (!allowed.has(parent))
            throw new Error(`LIVE_TABLE_OUT_OF_SCOPE:${parent}`);
          const condition = group.map((fk) => `${fk.to}=?`).join(' AND ');
          copy(
            parent,
            source
              .prepare(`SELECT * FROM ${parent} WHERE ${condition}`)
              .get(...group.map((fk) => row[fk.from])) as Row | undefined,
          );
        }
        const names = cols.map((c) => c.name);
        const existing = destination
          .prepare(
            `SELECT * FROM ${table} WHERE ${keys.map((k) => `${k}=?`).join(' AND ')}`,
          )
          .get(...values) as Row | undefined;
        if (existing) {
          if (names.some((name) => existing[name] !== row[name]))
            throw new Error(`LIVE_REPLAY_CONFLICT:${table}`);
          return;
        }
        const inserted =
          table === 'pipeline_runs'
            ? { ...row, state: 'RUNNING', completed_at: null, error_json: null }
            : row;
        destination
          .prepare(
            `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
          )
          .run(...names.map((name) => inserted[name]));
      };
      const byId = (table: string, column: string, value: string) =>
        source
          .prepare(`SELECT * FROM ${table} WHERE ${column}=?`)
          .get(value) as Row | undefined;
      const lineageSeen = new Set<string>();
      const lineage = (id: string): void => {
        if (lineageSeen.has(id)) return;
        lineageSeen.add(id);
        const row = byId('artifact_lineage', 'artifact_id', id);
        if (!row || row.pipeline_run_id !== execution.run_id)
          throw new Error('LIVE_LINEAGE_MISMATCH');
        const inputs = source
          .prepare(
            'SELECT * FROM artifact_lineage_inputs WHERE artifact_id=? ORDER BY position',
          )
          .all(id) as Row[];
        for (const dependency of inputs)
          if (dependency.kind === 'INTERNAL_ARTIFACT')
            lineage(String(dependency.input_id));
        copy('artifact_lineage', row);
        for (const dependency of inputs)
          copy('artifact_lineage_inputs', dependency);
      };
      copy(
        'affiliate_run_bindings',
        byId(
          'affiliate_run_bindings',
          'pipeline_run_id',
          String(execution.run_id),
        ),
      );
      lineage(String(pkg.identity.qualityControlReportId));
      lineage(String(pkg.identity.videoRenderId));
      copy(
        'video_renders',
        byId(
          'video_renders',
          'video_render_id',
          String(pkg.identity.videoRenderId),
        ),
      );
      for (const row of source
        .prepare(
          'SELECT * FROM video_composition_requests WHERE video_render_id=?',
        )
        .all(pkg.identity.videoRenderId) as Row[])
        copy('video_composition_requests', row);
      const planIds = destination
        .prepare('SELECT composition_plan_id FROM composition_plans')
        .all() as { composition_plan_id: string }[];
      for (const plan of planIds) {
        const detail = byId(
          'composition_plan_v2_details',
          'composition_plan_id',
          plan.composition_plan_id,
        );
        if (detail) copy('composition_plan_v2_details', detail);
        for (const segment of source
          .prepare(
            'SELECT * FROM composition_plan_v2_segments WHERE composition_plan_id=?',
          )
          .all(plan.composition_plan_id) as Row[])
          copy('composition_plan_v2_segments', segment);
      }
      copy('manual_distribution_records', packageRow);
      copy('manual_distribution_records', reviewRow);
      for (const table of [
        'pipeline_run_transitions',
        'pipeline_run_recoveries',
      ])
        for (const row of source
          .prepare(`SELECT * FROM ${table} WHERE pipeline_run_id=? ORDER BY id`)
          .all(execution.run_id) as Row[])
          copy(table, row);
      const run = byId(
        'pipeline_runs',
        'pipeline_run_id',
        String(execution.run_id),
      )!;
      destination
        .prepare(
          'UPDATE pipeline_runs SET state=?,completed_at=?,error_json=? WHERE pipeline_run_id=?',
        )
        .run(run.state, run.completed_at, run.error_json, execution.run_id);
      const prior = destination
        .prepare('SELECT * FROM campaign_executions WHERE execution_id=?')
        .get(input.executionId) as Row | undefined;
      if (!prior) {
        copy('campaign_executions', {
          ...execution,
          status: 'SCHEDULED',
          version: 1,
          claim_token: null,
          claim_expires_at: null,
        });
        const schedule = source
          .prepare(
            "SELECT * FROM campaign_execution_events WHERE execution_id=? AND event_type='SCHEDULED' ORDER BY sequence LIMIT 1",
          )
          .get(input.executionId) as Row | undefined;
        const approval = source
          .prepare(
            "SELECT * FROM campaign_execution_events WHERE execution_id=? AND event_type='HUMAN_APPROVAL' ORDER BY sequence DESC LIMIT 1",
          )
          .get(input.executionId) as Row | undefined;
        const approvalEvidence =
          approval && JSON.parse(String(approval.evidence_json));
        if (
          !schedule ||
          !approval ||
          approvalEvidence.decision !== 'APPROVED' ||
          approvalEvidence.videoRenderContentHash !==
            pkg.identity.videoRenderContentHash ||
          approvalEvidence.actor !== review.mediaDecision.actor
        )
          throw new Error('LIVE_APPROVAL_EVENT_MISMATCH');
        copy('campaign_execution_events', schedule);
        copy('campaign_execution_events', { ...approval, sequence: 2 });
      } else if (
        prior.campaign_id !== execution.campaign_id ||
        prior.run_id !== execution.run_id
      )
        throw new Error('LIVE_EXECUTION_CONFLICT');
      if (destination.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('LIVE_REFERENTIAL_INTEGRITY');
      destination.exec('COMMIT');
    } catch (error) {
      if (target.isTransaction) target.exec('ROLLBACK');
      throw error;
    }
    return {
      target: targetPath,
      executionId: input.executionId,
      packageHash: input.packageHash,
    };
  } finally {
    target?.close();
    source.close();
  }
}
