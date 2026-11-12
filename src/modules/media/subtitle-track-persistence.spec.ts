import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { Test } from '@nestjs/testing';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { OperationsModule } from '../operations/operations.module.js';
import { CAMPAIGN_DATABASE } from '../content-operations/application/campaign-administration.js';
import { CONTENT_DATABASE } from '../content/infrastructure/content.persistence.js';
import { AFFILIATE_DATABASE } from '../affiliate/infrastructure/affiliate-database.config.js';
import { PROJECT_DATABASE } from '../project/infrastructure/project-database.config.js';
import { RESEARCH_DATABASE } from '../research/infrastructure/research-database.config.js';
import {
  CONTENT_OPERATIONS,
  CONTENT_OPERATIONS_DATABASE,
} from '../content-operations/application/ports/operations.port.js';
import { FINANCE_DATABASE } from '../finance/finance.module.js';
import { MEDIA_DATABASE } from './infrastructure/media.persistence.js';
import {
  PUBLISHING_DATABASE,
  SOCIAL_HISTORY_DATABASE,
} from '../publishing/infrastructure/publishing.persistence.js';
import { EDITORIAL_PROVIDER } from '../content/application/editorial-provider.port.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';
import { AFFILIATE_RUN_CONTEXT } from '../affiliate/application/ports/affiliate-run-context.port.js';
import { EditorialFlowService } from '../content/application/editorial-flow.service.js';
import { ContentService } from '../content/application/content.service.js';
import { MediaService } from './application/media.service.js';
import { SubtitleTrackRepository } from './infrastructure/subtitle-track.repository.js';
import { SubtitleTrackCanonicalService } from './application/subtitle-track-canonical.service.js';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import { LocalEvidenceStorage } from './infrastructure/local-evidence-storage.js';
import { PinnedAlignmentVerifier } from './application/alignment.port.js';
import { alignmentHash } from './domain/alignment-contracts.js';
import {
  subtitleTrackContentHash,
  subtitleTrackIdentityHash,
} from './domain/subtitle-track-contracts.js';
const { wav } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);

it('materializes native verified fixture data with FKs/triggers, immutable V1 lineage, local binding, revision, replay and rollback', async () => {
  const native = p2EditorialFixture(),
    root = mkdtempSync(join(tmpdir(), 'subtitle-canonical-'));
  const schema = new DatabaseSync(native.database);
  provisionSchema(schema);
  schema.close();
  vi.stubEnv('INSTAGRAM_SCHEDULER_ENABLED', 'false');
  vi.stubEnv('CAMPAIGN_SCHEDULER_ENABLED', 'false');
  let builder = Test.createTestingModule({ imports: [OperationsModule] });
  for (const token of [
    CAMPAIGN_DATABASE,
    CONTENT_DATABASE,
    AFFILIATE_DATABASE,
    PROJECT_DATABASE,
    RESEARCH_DATABASE,
    CONTENT_OPERATIONS_DATABASE,
    FINANCE_DATABASE,
    MEDIA_DATABASE,
    PUBLISHING_DATABASE,
    SOCIAL_HISTORY_DATABASE,
  ])
    builder = builder.overrideProvider(token).useValue(native.database);
  const module = await builder
    .overrideProvider(EDITORIAL_PROVIDER)
    .useValue(new FakeEditorialProvider())
    .compile();
  let repository: SubtitleTrackRepository | undefined;
  try {
    module
      .get(AFFILIATE_RUN_CONTEXT)
      .bindRun(
        { pipelineRunId: 'run_001', briefingId: 'brief_001' },
        'bind_subtitle',
      );
    const result = await module.get(EditorialFlowService).generate({
      generationRequestId: 'canonical_editorial',
      pipelineRunId: 'run_001',
      briefingId: 'brief_001',
      researchShortlistId: native.shortlist.artifactId,
      referenceInsightId: null,
      requestedAt: '2026-11-12T00:00:00Z',
      supersedesScriptId: null,
    });
    const script = result.script,
      ops = module.get(CONTENT_OPERATIONS),
      content = module.get<ContentService<false>>(ContentService),
      files = new LocalEvidenceStorage(join(root, 'evidence'));
    const open = () =>
      new SubtitleTrackRepository(native.database, ops, content);
    repository = open();
    const repo = repository;
    const bytes = wav({ durationMilliseconds: 10000 });
    const physicalHash = (await import('node:crypto'))
      .createHash('sha256')
      .update(bytes)
      .digest('hex');
    const voice: any = {
      schemaVersion: 'voice-track/1.0.0',
      voiceTrackId: 'voice_canonical',
      pipelineRunId: script.pipelineRunId,
      projectId: script.projectId,
      projectVersion: script.projectVersion,
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      language: 'pt-BR',
      voiceStyle: 'informative',
      durationMilliseconds: 10000,
      audioFormat: 'wav',
      contentHash: physicalHash,
      storageReference: `object:voice/sha256/${physicalHash}`,
      origin: 'AUTHORIZED_RECORDING',
      provider: null,
      rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
      createdAt: '2026-11-12T00:00:00Z',
      revision: 1,
      supersedesVoiceTrackId: null,
    };
    // Explicit fixed alignment vector for contract/persistence tests, not a CTC inference claim.
    const words = Array.from(
      script.fullNarration.matchAll(/\S+/gu),
    ) as RegExpMatchArray[];
    const evidence: any = {
      input: {
        audioAssetId: voice.voiceTrackId,
        audioSha256: physicalHash,
        scriptId: script.scriptId,
        scriptVersion: script.revision,
        scriptTextSha256: alignmentHash(script.fullNarration),
        durationMs: 10000,
        canonicalText: script.fullNarration,
      },
      parameters: { fixture: true },
      provenance: 'FORCED_ALIGNMENT',
      output: {
        alignmentId: 'alignment_canonical',
        provider: 'pinned-test-vector',
        modelVersion: 'test/1',
        audioSha256: physicalHash,
        scriptTextSha256: alignmentHash(script.fullNarration),
        segments: words.map((m, i) => ({
          text: m[0],
          textStartOffset: m.index!,
          textEndOffset: m.index! + m[0].length,
          startMs: Math.floor((i * 10000) / words.length),
          endMs: Math.floor(((i + 1) * 10000) / words.length),
        })),
        evidenceHash: '',
        status: 'VERIFIED',
      },
    };
    evidence.output.evidenceHash = alignmentHash(evidence);
    const verifier = new PinnedAlignmentVerifier(
      new Set([evidence.output.evidenceHash]),
    );
    const flow = new LocalFlowRuntime(
      open,
      module.get(MediaService),
      {
        LOCAL_MEDIA_EVIDENCE_ROOT: files.root,
        FFMPEG_VOICE_ROOT: join(root, 'voice'),
      },
      verifier,
    );
    await flow.ingest({
      voiceTrack: voice,
      audioBase64: bytes.toString('base64'),
      authorization: {
        actorId: 'operator_test',
        statement: 'Own PCM contract fixture only; not human AV approval.',
      },
    });
    await flow.acceptAlignment(evidence);
    const service = new SubtitleTrackCanonicalService(repo, files, {
      readAuthorizedAudio: (...args) => flow.audioBytes(...args),
      provenance: verifier,
    });
    const input = {
      subtitleTrackId: 'canonical_001',
      alignmentId: evidence.output.alignmentId,
      createdAt: '2026-11-12T01:00:00Z',
      revision: 1,
      supersedesSubtitleTrackId: null,
    };
    const peer = open();
    let a: any, b: any;
    try {
      [a, b] = await Promise.all([
        service.materialize(input),
        new SubtitleTrackCanonicalService(peer, files, {
          readAuthorizedAudio: (...args) => flow.audioBytes(...args),
          provenance: verifier,
        }).materialize(input),
      ]);
    } finally {
      peer.close();
    }
    expect(a).toEqual(b);
    expect(a.cues[0].startMilliseconds).toBe(0);
    expect(repo.db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    expect(repo.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(repo.getArtifact(a.subtitleTrackId)?.inputs).toEqual([
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: script.scriptId,
        contentHash: script.contentHash,
      },
      {
        position: 2,
        kind: 'INTERNAL_ARTIFACT',
        inputId: voice.voiceTrackId,
        contentHash: physicalHash,
      },
    ]);
    const local = flow.subtitles(evidence.output.alignmentId);
    expect(
      (
        await service.bindLocal({
          subtitleTrackId: a.subtitleTrackId,
          localSubtitleId: local.subtitleId,
        })
      ).policyEquivalence,
    ).toBe('NOT_ASSUMED');
    const bindingRequest = {
      subtitleTrackId: a.subtitleTrackId,
      localSubtitleId: local.subtitleId,
    };
    const assPath = files.path(local.assHash, 'ass'),
      original = readFileSync(assPath);
    writeFileSync(assPath, 'tampered');
    await expect(service.bindLocal(bindingRequest)).rejects.toThrow();
    writeFileSync(assPath, original);
    const noTrust = new SubtitleTrackCanonicalService(repo, files, {
      readAuthorizedAudio: (...args) => flow.audioBytes(...args),
      provenance: new PinnedAlignmentVerifier(new Set()),
    });
    await expect(
      noTrust.materialize({ ...input, subtitleTrackId: 'untrusted_001' }),
    ).rejects.toThrow('ALIGNMENT_PROVENANCE_UNVERIFIED');
    const conflict = {
      ...a,
      cues: [{ ...a.cues[0], text: 'Changed.' }, ...a.cues.slice(1)],
    };
    conflict.contentHash = subtitleTrackContentHash(conflict);
    expect(() => repo.registerSubtitleTrack(conflict)).toThrow(
      'SUBTITLE_TRACK_ID_REUSED',
    );
    const logical = { ...a, subtitleTrackId: 'duplicate_revision' };
    logical.contentHash = subtitleTrackContentHash(logical);
    expect(() => repo.registerSubtitleTrack(logical)).toThrow(
      'SUBTITLE_TRACK_REVISION_CONFLICT',
    );
    const revised = await service.materialize({
      ...input,
      subtitleTrackId: 'canonical_002',
      revision: 2,
      supersedesSubtitleTrackId: a.subtitleTrackId,
    });
    expect(repo.getArtifact(revised.subtitleTrackId)?.inputs[2].inputId).toBe(
      a.subtitleTrackId,
    );
    expect(() =>
      repo.db
        .prepare(
          'UPDATE subtitle_tracks SET language=? WHERE subtitle_track_id=?',
        )
        .run('en-US', a.subtitleTrackId),
    ).toThrow('IMMUTABLE_SUBTITLE_TRACK');
    for (const change of [
      { scriptContentHash: 'f'.repeat(64) },
      { voiceTrackContentHash: 'f'.repeat(64) },
      { language: 'en-US' },
      { durationMilliseconds: 9999 },
    ]) {
      const wrong = {
        ...a,
        ...change,
        subtitleTrackId: 'wrong_scope',
        revision: 2,
        supersedesSubtitleTrackId: a.subtitleTrackId,
      };
      wrong.contentHash = subtitleTrackContentHash(wrong);
      expect(() => repo.registerSubtitleTrack(wrong)).toThrow();
    }
    await expect(
      service.bindLocal({ ...bindingRequest, renderId: 'missing_render' }),
    ).rejects.toThrow('SUBTITLE_RENDER_BINDING_MISMATCH');
    const source = repo.getSubtitleSource(a.subtitleTrackId, files);
    expect(source.alignmentId).toBe(evidence.output.alignmentId);
    // Fault injection adds a rejecting trigger; it never disables existing guards.
    repo.db.exec(
      "CREATE TRIGGER test_reject_canonical BEFORE INSERT ON subtitle_tracks WHEN NEW.subtitle_track_id='canonical_003' BEGIN SELECT RAISE(ABORT,'TEST_REJECT'); END",
    );
    await expect(
      service.materialize({
        ...input,
        subtitleTrackId: 'canonical_003',
        revision: 3,
        supersedesSubtitleTrackId: revised.subtitleTrackId,
      }),
    ).rejects.toThrow();
    expect(repo.getArtifact('canonical_003')).toBeNull();
    const fresh = open();
    try {
      expect(fresh.getSubtitleTrack(a.subtitleTrackId)).toEqual(a);
      expect(
        subtitleTrackIdentityHash(fresh.getSubtitleTrack(a.subtitleTrackId)),
      ).toBe(subtitleTrackIdentityHash(a));
    } finally {
      fresh.close();
    }
    if (process.env.MKTAUTO_SUBTITLE_EVIDENCE) {
      const out = process.env.MKTAUTO_SUBTITLE_EVIDENCE;
      const fs = await import('node:fs');
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        join(out, 'canonical-track.json'),
        JSON.stringify(a, null, 2),
      );
      fs.writeFileSync(
        join(out, 'binding.json'),
        JSON.stringify(await service.bindLocal(bindingRequest), null, 2),
      );
      fs.writeFileSync(
        join(out, 'source.json'),
        JSON.stringify(source, null, 2),
      );
      fs.writeFileSync(
        join(out, 'context.json'),
        JSON.stringify(
          { script, run: ops.get(script.pipelineRunId), input },
          null,
          2,
        ),
      );
      fs.cpSync(root, join(out, 'storage'), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      const db = new DatabaseSync(native.database, { readOnly: true });
      try {
        await backup(db, join(out, 'catalog.sqlite'));
      } finally {
        db.close();
      }
    }
  } finally {
    repository?.close();
    await module.close();
    vi.unstubAllEnvs();
    native.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
