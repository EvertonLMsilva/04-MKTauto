import { localFixture } from '../../test/support/local-flow-fixture.js';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import { alignmentHash } from './domain/alignment-contracts.js';
import { digest } from './infrastructure/local-evidence-storage.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { wav } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
test('ingests authorized WAV, verifies hashes and preserves replay', async () => {
  const f = await localFixture();
  try {
    const bytes = wav({ durationMilliseconds: 10000 });
    const voice = {
      ...f.voice,
      audioFormat: 'wav',
      voiceTrackId: 'local_voice_003',
      contentHash: f.plan.voiceTrackContentHash,
      storageReference: `object:voice/sha256/${f.plan.voiceTrackContentHash}`,
      revision: 3,
      supersedesVoiceTrackId: 'voice_native_002',
      origin: 'AUTHORIZED_RECORDING',
      provider: null,
      rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
    };
    const request = {
      voiceTrack: voice,
      audioBase64: bytes.toString('base64'),
      authorization: {
        actorId: 'operator_001',
        statement: 'Gravação própria autorizada para uso comercial.',
      },
    };
    expect(await f.flow.ingest(request)).toMatchObject({
      voiceTrackId: voice.voiceTrackId,
    });
    expect(
      await f.flow.ingest({
        ...request,
        voiceTrack: Object.fromEntries(Object.entries(voice).reverse()),
      }),
    ).toMatchObject({ voiceTrackId: voice.voiceTrackId });
    await expect(
      f.flow.ingest({
        ...request,
        authorization: { ...request.authorization, actorId: 'operator_other' },
      }),
    ).rejects.toThrow('LOCAL_ID_REUSED');
    expect(await f.flow.ingest(request)).toMatchObject({
      voiceTrackId: voice.voiceTrackId,
    });
    await expect(
      f.flow.ingest({
        ...request,
        voiceTrack: { ...voice, contentHash: '0'.repeat(64) },
      }),
    ).rejects.toThrow();
    await expect(
      f.flow.ingest({
        ...request,
        voiceTrack: {
          ...voice,
          rights: { usageBasis: 'OWNED', commercialUseAllowed: false },
        },
      }),
    ).rejects.toThrow();
    const invalid = Buffer.from('not a WAV');
    const invalidHash = digest(invalid);
    await expect(
      f.flow.ingest({
        ...request,
        audioBase64: invalid.toString('base64'),
        voiceTrack: {
          ...voice,
          contentHash: invalidHash,
          storageReference: `object:voice/sha256/${invalidHash}`,
        },
      }),
    ).rejects.toThrow('PROVIDER_INVALID_AUDIO');
    await expect(
      f.flow.ingest({
        ...request,
        voiceTrack: { ...voice, audioFormat: 'mp3' },
      }),
    ).rejects.toThrow('LOCAL_AUDIO_FORMAT_MISMATCH');
  } finally {
    f.close();
  }
});
test('failed transaction leaves no lineage and recovers with reusable files', async () => {
  const f = await localFixture();
  try {
    f.repository.db.exec(
      "CREATE TRIGGER local_test_fail BEFORE INSERT ON artifact_lineage_inputs WHEN NEW.artifact_id='alignment_local_001' BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END;",
    );
    await expect(f.flow.acceptAlignment(f.evidence)).rejects.toThrow(
      'TEST_FAILURE',
    );
    expect(
      f.repository.db
        .prepare('SELECT 1 FROM artifact_lineage WHERE artifact_id=?')
        .get('alignment_local_001'),
    ).toBeUndefined();
    f.repository.db.exec('DROP TRIGGER local_test_fail');
    await f.flow.acceptAlignment(f.evidence);
    const before = f.repository.db
      .prepare('SELECT COUNT(*) AS n FROM artifact_lineage')
      .get();
    await Promise.all([
      f.flow.acceptAlignment(f.evidence),
      f.flow.acceptAlignment(f.evidence),
    ]);
    expect(
      f.repository.db
        .prepare('SELECT COUNT(*) AS n FROM artifact_lineage')
        .get(),
    ).toEqual(before);
    expect(() =>
      f.repository.db
        .prepare('DELETE FROM artifact_lineage WHERE artifact_id=?')
        .run('alignment_local_001'),
    ).toThrow('IMMUTABLE');
  } finally {
    f.close();
  }
});
test('QC rejects original/unsubtitled and physically tampered videos', async () => {
  const f = await localFixture();
  try {
    const source = await f.media.compose(f.request());
    expect((await f.flow.qc(source.videoRenderId)).result).toBe('FAIL');
    await f.flow.acceptAlignment(f.evidence);
    const sub = f.flow.subtitles(f.evidence.output.alignmentId);
    const final = await f.flow.burn(source.videoRenderId, sub.subtitleId);
    const path = join(
      f.renderRoot,
      'sha256',
      final.contentHash.slice(0, 2),
      `${final.contentHash}.mp4`,
    );
    writeFileSync(path, 'tampered');
    expect((await f.flow.qc(final.videoRenderId)).result).toBe('FAIL');
    expect((await f.flow.preview(final.videoRenderId)).ready).toBe(false);
    await expect(f.flow.previewBytes(final.videoRenderId)).rejects.toThrow(
      'LOCAL_PREVIEW_BLOCKED',
    );
  } finally {
    f.close();
  }
});
test('burn failure can be retried without a false success receipt', async () => {
  const f = await localFixture();
  try {
    await f.flow.acceptAlignment(f.evidence);
    const sub = f.flow.subtitles(f.evidence.output.alignmentId),
      source = await f.media.compose(f.request());
    const unavailable = new LocalFlowRuntime(
      f.open,
      f.media,
      { ...f.env, LOCAL_MEDIA_EVIDENCE_ROOT: f.root + '/evidence' },
      undefined,
      async () => {
        throw Object.assign(new Error('timeout'), { code: 'COMPOSER_TIMEOUT' });
      },
    );
    await expect(
      unavailable.burn(source.videoRenderId, sub.subtitleId),
    ).rejects.toThrow('timeout');
    const final = await f.flow.burn(source.videoRenderId, sub.subtitleId);
    expect((await f.flow.preview(final.videoRenderId)).ready).toBe(true);
    const unknown = await unavailable.qc(final.videoRenderId);
    expect(unknown.result).toBe('UNKNOWN');
    expect(unknown.approvalBlocked).toBe(true);
  } finally {
    f.close();
  }
});
test('alignment → subtitles → burn-in → QC → preview, replay and concurrent recovery', async () => {
  const f = await localFixture();
  try {
    const report = await f.flow.acceptAlignment(f.evidence);
    expect(await f.flow.acceptAlignment(f.evidence)).toEqual(report);
    const subtitles = f.flow.subtitles(f.evidence.output.alignmentId);
    const video = await f.media.compose(f.request());
    const results = await Promise.all([
      f.flow.burn(video.videoRenderId, subtitles.subtitleId),
      f.flow.burn(video.videoRenderId, subtitles.subtitleId),
    ]);
    expect(results[0]).toEqual(results[1]);
    const qc = await f.flow.qc(results[0].videoRenderId);
    expect(qc.result).toBe('PASS');
    expect(await f.flow.preview(results[0].videoRenderId)).toMatchObject({
      ready: true,
    });
    const r = f.open();
    try {
      expect(r.db.prepare('PRAGMA user_version').get()?.user_version).toBe(40);
    } finally {
      r.close();
    }
  } finally {
    f.close();
  }
});
test('absent or untrusted alignment blocks synchronized subtitles', async () => {
  const f = await localFixture();
  try {
    expect(() => f.flow.subtitles('alignment_missing')).toThrow();
    const flow = new LocalFlowRuntime(f.open, f.media, {
      ...f.env,
      LOCAL_MEDIA_EVIDENCE_ROOT: f.root + '/evidence',
    });
    await expect(flow.acceptAlignment(f.evidence)).rejects.toThrow(
      'ALIGNMENT_PROVENANCE_UNVERIFIED',
    );
    const changed = structuredClone(f.evidence);
    changed.input.scriptVersion++;
    changed.output.evidenceHash = alignmentHash(changed);
    await expect(f.flow.acceptAlignment(changed)).rejects.toThrow();
  } finally {
    f.close();
  }
});
