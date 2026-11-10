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

test('groups a word with no 30fps frame without changing acoustic evidence', () => {
  const segments = [
    {
      startMs: 3680,
      endMs: 3920,
      text: 'segue',
      textStartOffset: 0,
      textEndOffset: 5,
    },
    {
      startMs: 3980,
      endMs: 4000,
      text: 'o',
      textStartOffset: 6,
      textEndOffset: 7,
    },
    {
      startMs: 4100,
      endMs: 4360,
      text: 'texto',
      textStartOffset: 8,
      textEndOffset: 13,
    },
  ];
  const before = structuredClone(segments);
  expect((Math.ceil((3980 * 30) / 1000) / 30) * 1000).toBe(4000);
  const files = serializeSubtitles(segments, {
    frameRate: 30,
    durationMs: 12000,
  });
  expect(files.srt).toContain('segue o');
  expect(files.srt).toContain('00:00:03,680 --> 00:00:04,000');
  expect(files.srt).toContain('texto');
  expect(segments).toEqual(before);
});

test.each([24, 30, 60])(
  'covers boundary cues at %i fps without overlap or lost words',
  (frameRate) => {
    const segments = ['a', 'b', 'c'].map((text, i) => ({
      startMs: 3980 + i * 20,
      endMs: 4000 + i * 20,
      text,
      textStartOffset: i * 2,
      textEndOffset: i * 2 + 1,
    }));
    const files = serializeSubtitles(segments, {
      frameRate,
      durationMs: 12000,
    });
    const cues = [
      ...files.ass.matchAll(
        /Dialogue: 0,([^,]+),([^,]+),Default,,0,0,0,,([^\n]+)/g,
      ),
    ];
    const ms = (v: string) => {
      const [h, m, s] = v.split(':').map(Number);
      return (h * 3600 + m * 60 + s) * 1000;
    };
    let end = 0;
    for (const cue of cues) {
      const a = ms(cue[1]),
        b = ms(cue[2]);
      expect(a).toBeGreaterThanOrEqual(end);
      expect(
        (Math.ceil((a * frameRate) / 1000 - 1e-9) * 1000) / frameRate,
      ).toBeLessThan(b);
      end = b;
    }
    expect(cues.map((c) => c[3]).join(' ')).toBe('a b c');
  },
);

test('rejects unrepresentable display intervals and invalid presentation settings', () => {
  const s = [
    {
      startMs: 3980,
      endMs: 4000,
      text: 'o',
      textStartOffset: 0,
      textEndOffset: 1,
    },
  ];
  expect(() =>
    serializeSubtitles(s, { frameRate: 30, durationMs: 4000 }),
  ).toThrow('SUBTITLE_FRAME_COVERAGE_UNREPRESENTABLE');
  expect(() =>
    serializeSubtitles(s, { frameRate: 0, durationMs: 4000 }),
  ).toThrow();
});
