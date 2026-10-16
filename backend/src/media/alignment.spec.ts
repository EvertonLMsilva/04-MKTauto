import {
  alignmentHash,
  validateAlignment,
  serializeSubtitles,
} from './domain/alignment-contracts.js';
import { PinnedAlignmentVerifier } from './application/alignment.port.js';
const hash = 'a'.repeat(64);
function fixture() {
  const input = {
    audioAssetId: 'voice_001',
    audioSha256: hash,
    scriptId: 'script_001',
    scriptVersion: 1,
    scriptTextSha256: '',
    durationMs: 2000,
    canonicalText: 'Olá mundo.',
  };
  input.scriptTextSha256 = alignmentHash(input.canonicalText);
  const value = {
    input,
    parameters: { language: 'pt' },
    provenance: 'FORCED_ALIGNMENT',
    output: {
      alignmentId: 'alignment_001',
      provider: 'fixture',
      modelVersion: 'fixture/1',
      audioSha256: hash,
      scriptTextSha256: input.scriptTextSha256,
      segments: [
        {
          startMs: 100,
          endMs: 1400,
          text: 'Olá mundo.',
          textStartOffset: 0,
          textEndOffset: 10,
        },
      ],
      status: 'VERIFIED',
      evidenceHash: '',
    },
  };
  value.output.evidenceHash = alignmentHash(value);
  return value;
}
test('validates complete binding and serializes exact observed times', () => {
  const value = fixture();
  expect(validateAlignment(value)).toEqual(value);
  const files = serializeSubtitles(value.output.segments);
  expect(files.srt).toContain('00:00:00,100 --> 00:00:01,400');
  expect(files.ass).toContain('0:00:00.10,0:00:01.40');
});
test('blocks ASS cues that collapse at centisecond resolution', () => {
  const v = fixture();
  v.output.segments[0].endMs = 101;
  expect(() => serializeSubtitles(v.output.segments)).toThrow(
    'SUBTITLE_ASS_PRECISION_UNSUPPORTED',
  );
});
test('trusts only separately pinned provenance, including native timestamps', async () => {
  const value = fixture();
  value.provenance = 'NATIVE_TIMESTAMPS';
  value.output.evidenceHash = alignmentHash(value);
  const verifier = new PinnedAlignmentVerifier(
    new Set([value.output.evidenceHash]),
  );
  expect(
    await verifier.verify(validateAlignment(value), Buffer.from('fixture')),
  ).toBe(true);
  value.parameters.language = 'en';
  value.output.evidenceHash = alignmentHash(value);
  expect(
    await verifier.verify(validateAlignment(value), Buffer.from('fixture')),
  ).toBe(false);
});
test.each([
  'audio',
  'text',
  'offset',
  'duration',
  'order',
  'gap',
  'hash',
  'unknown',
])('rejects %s', (mode) => {
  const v = fixture();
  if (mode === 'audio') v.output.audioSha256 = 'b'.repeat(64);
  if (mode === 'text') v.input.canonicalText = 'Outro texto';
  if (mode === 'offset') v.output.segments[0].textEndOffset = 9;
  if (mode === 'duration') v.output.segments[0].endMs = 2001;
  if (mode === 'order') v.output.segments.push({ ...v.output.segments[0] });
  if (mode === 'gap') {
    v.output.segments[0].text = 'mundo.';
    v.output.segments[0].textStartOffset = 4;
  }
  if (mode === 'unknown') v.output.status = 'UNKNOWN';
  if (mode !== 'hash') v.output.evidenceHash = alignmentHash(v);
  else v.output.evidenceHash = 'f'.repeat(64);
  expect(() => validateAlignment(v)).toThrow();
});
