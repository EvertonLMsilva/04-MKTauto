import { LocalPythonAligner } from './infrastructure/local-python-aligner.js';
import { localFixture } from '../../test/support/local-flow-fixture.js';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';

it('fails closed when the offline model is not configured', async () => {
  const f = await localFixture();
  try {
    await expect(
      new LocalPythonAligner({}).align(f.evidence.input, Buffer.alloc(0)),
    ).rejects.toThrow('ALIGNMENT_CONFIGURATION_REQUIRED');
  } finally {
    f.close();
  }
});

it('coalesces concurrent alignment, persists immutable evidence and replays without inference', async () => {
  const f = await localFixture();
  let calls = 0;
  const aligner = {
    identity: 'test-v1',
    async align(input: typeof f.evidence.input) {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      const value = structuredClone(f.evidence);
      value.input = input;
      const { alignmentHash } = await import('./domain/alignment-contracts.js');
      value.output.alignmentId =
        'align_' + alignmentHash({ input, configuration: 'test-v1' });
      value.output.evidenceHash = alignmentHash(value);
      return value;
    },
  };
  const flow = new LocalFlowRuntime(
    f.open,
    f.media,
    { ...f.env, LOCAL_MEDIA_EVIDENCE_ROOT: f.root + '/generated' },
    { verify: async () => true },
    undefined,
    aligner,
  );
  try {
    const id = 'local_align_voice';
    await flow.ingest({
      voiceTrack: {
        ...f.voice,
        audioFormat: 'wav',
        voiceTrackId: id,
        contentHash: f.plan.voiceTrackContentHash,
        storageReference: `object:voice/sha256/${f.plan.voiceTrackContentHash}`,
        revision: 3,
        supersedesVoiceTrackId: 'voice_native_002',
        origin: 'AUTHORIZED_RECORDING',
        provider: null,
        rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
      },
      authorization: {
        actorId: 'operator_align',
        statement: 'Authorized fixture only.',
      },
    });
    const results = await Promise.all([
      flow.alignAudio(id),
      flow.alignAudio(id),
      new LocalFlowRuntime(
        f.open,
        f.media,
        { ...f.env, LOCAL_MEDIA_EVIDENCE_ROOT: f.root + '/generated' },
        { verify: async () => true },
        undefined,
        aligner,
      ).alignAudio(id),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(calls).toBe(1);
    await flow.alignAudio(id);
    expect(calls).toBe(1);
    await expect(flow.alignAudio('../private.wav')).rejects.toThrow(
      'ALIGNMENT_ID_INVALID',
    );
  } finally {
    f.close();
  }
});
