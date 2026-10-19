import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  ttsHash,
  ttsFail,
} from '../../finance/domain/tts-financial-contracts.js';
import { SqliteTtsFinancialSourcesReader } from '../../finance/infrastructure/financial-readers.sqlite.js';
import { validateScript } from '../../content/domain/script-contracts.js';
import type {
  NarrationPlanStore,
  NarrationScope,
} from '../application/narration-plan.port.js';
import { adaptLocalNarration } from './local-piper-tts.js';

export function provisionNarrationAudio(db: DatabaseSync, campaignId: string) {
  const rows = db
    .prepare(
      "SELECT artifact_id,identity_hash,payload_json FROM p4_artifacts WHERE kind='audio_config' AND json_extract(payload_json,'$.campaignId')=?",
    )
    .all(campaignId);
  const base = {
    schemaVersion: 'campaign-audio/1.0.0',
    campaignId,
    language: 'pt-BR',
    provider: 'openai',
    voice: 'marin',
    style: 'informative',
    mode: 'REPLACE',
    originalGainDb: 0,
    narrationGainDb: 0,
  };
  let revision = 1;
  for (const row of rows) {
    const config = JSON.parse(String(row.payload_json));
    if (
      ttsHash(config) !== row.identity_hash ||
      row.artifact_id !== `audio_config:${ttsHash(config)}`
    )
      ttsFail('TTS_AUDIO_CONFIGURATION_INVALID');
    revision = Math.max(revision, config.revision + 1);
    if (Object.entries(base).every(([k, v]) => config[k] === v))
      return {
        id: row.artifact_id as string,
        config,
        contentHash: row.identity_hash as string,
      };
  }
  const config = { ...base, revision },
    contentHash = ttsHash(config),
    id = `audio_config:${contentHash}`;
  db.prepare('INSERT INTO p4_artifacts VALUES(?,?,?,?,?)').run(
    'audio_config',
    id,
    contentHash,
    null,
    JSON.stringify(config),
  );
  return { id, config, contentHash };
}
export class NarrationPlanRepository implements NarrationPlanStore {
  constructor(private readonly path: string | null) {}
  private open(readOnly = true) {
    if (!this.path || !isAbsolute(this.path) || !existsSync(this.path))
      ttsFail('TTS_DATABASE_REQUIRED');
    return new DatabaseSync(this.path, { readOnly });
  }
  authorization(id: string) {
    const db = this.open();
    try {
      const r = db
        .prepare(
          'SELECT request_hash,approval_json FROM tts_financial_approvals WHERE operation_id=?',
        )
        .get(id);
      return r
        ? {
            requestHash: r.request_hash,
            ...JSON.parse(String(r.approval_json)),
          }
        : null;
    } finally {
      db.close();
    }
  }
  prepare(scope: NarrationScope, provision = false) {
    const db = this.open(!provision);
    try {
      if (provision) {
        db.exec(
          'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE',
        );
      }
      if (
        !db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='tts_risk_dispatches_v2'",
          )
          .get()
      )
        ttsFail('TTS_RISK_SCHEMA_REQUIRED');
      const row = db
        .prepare(
          'SELECT payload_json,content_hash FROM scripts WHERE script_id=?',
        )
        .get(scope.scriptId);
      if (!row) ttsFail('TTS_SCRIPT_NOT_FOUND');
      const script = validateScript(JSON.parse(String(row.payload_json)));
      const binding = db
        .prepare(
          'SELECT campaign_id FROM affiliate_run_bindings WHERE pipeline_run_id=?',
        )
        .get(scope.pipelineRunId);
      const media = db
        .prepare(
          'SELECT content_hash,pipeline_run_id,duration_milliseconds,commercial_use_allowed FROM media_assets WHERE media_asset_id=?',
        )
        .get(scope.mediaAssetId);
      if (
        script.contentHash !== scope.scriptContentHash ||
        row.content_hash !== script.contentHash ||
        script.pipelineRunId !== scope.pipelineRunId ||
        binding?.campaign_id !== scope.campaignId ||
        media?.content_hash !== scope.mediaContentHash ||
        media.pipeline_run_id !== scope.pipelineRunId ||
        media.duration_milliseconds !== scope.targetDurationMs ||
        media.commercial_use_allowed !== 1
      )
        ttsFail('TTS_SCOPE_INVALID');
      let audioConfiguration;
      if (provision)
        audioConfiguration = provisionNarrationAudio(db, scope.campaignId);
      else {
        const configs = db
          .prepare(
            "SELECT artifact_id,identity_hash,payload_json FROM p4_artifacts WHERE kind='audio_config' AND json_extract(payload_json,'$.campaignId')=? ORDER BY json_extract(payload_json,'$.revision') DESC",
          )
          .all(scope.campaignId);
        const config = configs.find((r) => {
          const v = JSON.parse(String(r.payload_json));
          return (
            v.provider === 'openai' &&
            v.voice === 'marin' &&
            v.mode === 'REPLACE'
          );
        });
        if (!config) ttsFail('TTS_AUDIO_CONFIGURATION_REQUIRED');
        audioConfiguration = {
          id: config.artifact_id,
          contentHash: config.identity_hash,
          config: JSON.parse(String(config.payload_json)),
        };
      }
      // Read the original fal record. Never create a second video operation or ledger entry.
      const candidates = db
        .prepare(
          "SELECT generation_key FROM fal_generations WHERE pipeline_run_id=? AND state='COMPLETED' AND json_extract(output_json,'$.contentHash')=?",
        )
        .all(scope.pipelineRunId, scope.mediaContentHash);
      let sourceId: string;
      if (candidates.length === 1)
        sourceId = String(candidates[0].generation_key);
      else if (candidates.length > 1) ttsFail('TTS_SOURCE_SELECTION_REQUIRED');
      else {
        const legacy = db
          .prepare(
            "SELECT generation_request_id FROM video_generation_operations WHERE pipeline_run_id=? AND state='COMPLETED' AND json_extract(result_json,'$.videoReference')=?",
          )
          .all(scope.pipelineRunId, `media:sha256_${scope.mediaContentHash}`);
        if (legacy.length !== 1) ttsFail('TTS_SOURCE_REQUIRED');
        sourceId = String(legacy[0].generation_request_id);
      }
      const source = new SqliteTtsFinancialSourcesReader(db).videoSource(
        sourceId,
      );
      if (!source || source.state !== 'COMPLETED')
        ttsFail('TTS_SOURCE_REQUIRED');
      const operation = {
        sourceId,
        pipelineRunId: scope.pipelineRunId,
        audioConfigId: audioConfiguration.id,
        narration: adaptLocalNarration(
          script.fullNarration,
          scope.targetDurationMs,
        ),
        maxDurationMilliseconds: scope.targetDurationMs,
      };
      const providerConfiguration = {
        model: 'gpt-4o-mini-tts',
        voice: 'marin',
        policyVersion: 'openai-voice-policy/2.0.0',
        audioFormat: 'wav',
      };
      const financialPolicy = {
        schemaVersion: 'tts-risk-reservation/2.0.0',
        scriptId: script.scriptId,
        scriptContentHash: script.contentHash,
      };
      const plan = {
        operationId: `tts_${ttsHash({ operation, providerConfiguration, financialPolicy })}`,
        operation,
        operationHash: ttsHash(operation),
        audioConfiguration,
        providerConfiguration,
        providerConfigurationHash: ttsHash({
          provider: 'openai',
          ...providerConfiguration,
        }),
        source: {
          generationRequestId: sourceId,
          requestHash: source.requestHash,
          sourceContentHash: scope.mediaContentHash,
          ...(source.result?.providerRequestId
            ? { providerRequestId: source.result.providerRequestId }
            : {}),
        },
        estimatedCost: {
          currency: 'USD',
          amount: 0.00306,
          proposedInternalAllowanceUsd: 0.01,
          guaranteedMaximum: false,
        },
        financialPolicy,
      };
      if (provision) db.exec('COMMIT');
      return plan;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    } finally {
      db.close();
    }
  }
}
