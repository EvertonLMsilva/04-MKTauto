import {
  subtitleTrackContentHash,
  subtitleTrackIdentityHash,
  validateSubtitleTrack,
} from './domain/subtitle-track-contracts.js';
const base = () => ({
  schemaVersion: 'subtitle-track/1.0.0',
  subtitleTrackId: 'subtitle_001',
  pipelineRunId: 'run_001',
  projectId: 'project_001',
  projectVersion: 1,
  scriptId: 'script_001',
  scriptContentHash: 'a'.repeat(64),
  voiceTrackId: 'voice_001',
  voiceTrackContentHash: 'b'.repeat(64),
  language: 'pt-BR',
  timeUnit: 'MILLISECONDS',
  durationMilliseconds: 1000,
  stylePolicyVersion: 'subtitle-style-policy/1.0.0',
  cues: [
    { position: 1, text: 'Olá.', startMilliseconds: 0, endMilliseconds: 400 },
    {
      position: 2,
      text: 'Mundo.',
      startMilliseconds: 500,
      endMilliseconds: 1000,
    },
  ],
  createdAt: '2026-11-12T00:00:00Z',
  revision: 1,
  supersedesSubtitleTrackId: null,
  contentHash: '',
});
it('validates the exact V1 contract with gaps, frozen output and stable canonical hashes', () => {
  const v = base();
  v.contentHash = subtitleTrackContentHash(v);
  const track = validateSubtitleTrack(v);
  // Frozen vectors computed by the historical implementation at 3d306c4f.
  expect(track.contentHash).toBe(
    '59e15c8b2d39cb6f331b9a24aaa0ad70c645e95c353181a646ba2bc59ded0563',
  );
  expect(subtitleTrackIdentityHash(track)).toBe(
    '99f40d935d31a68172fb3d573dc7aa960a6dce4d620a260b5496722deb4df9e4',
  );
  expect(Object.isFrozen(track.cues[0])).toBe(true);
  expect(subtitleTrackIdentityHash(track)).toBe(
    subtitleTrackIdentityHash(Object.fromEntries(Object.entries(v).reverse())),
  );
});
it.each([
  'extra',
  'empty',
  'position',
  'start',
  'overlap',
  'duration',
  'text',
  'hash',
  'style',
] as const)('rejects %s without repairing cues', (kind) => {
  const v: any = base();
  if (kind === 'extra') v.privateField = 'no';
  if (kind === 'empty') v.cues = [];
  if (kind === 'position') v.cues[0].position = 2;
  if (kind === 'start') v.cues[0].startMilliseconds = 1;
  if (kind === 'overlap') v.cues[1].startMilliseconds = 399;
  if (kind === 'duration') v.cues[1].endMilliseconds = 1001;
  if (kind === 'text') v.cues[0].text = ' Ola\u0301. ';
  if (kind === 'style') v.stylePolicyVersion = 'frame-coverage/1';
  v.contentHash =
    kind === 'hash' ? 'f'.repeat(64) : subtitleTrackContentHash(v);
  expect(() => validateSubtitleTrack(v)).toThrow();
});
it('enforces the historical cue/text bounds and forbids additional cue fields', () => {
  const v = base();
  v.cues = Array.from({ length: 1000 }, (_, i) => ({
    position: i + 1,
    text: 'Á',
    startMilliseconds: i,
    endMilliseconds: i + 1,
  }));
  v.contentHash = subtitleTrackContentHash(v);
  expect(validateSubtitleTrack(v).cues).toHaveLength(1000);
  v.cues.push({
    position: 1001,
    text: 'Á',
    startMilliseconds: 1000,
    endMilliseconds: 1001,
  });
  v.contentHash = subtitleTrackContentHash(v);
  expect(() => validateSubtitleTrack(v)).toThrow('INVALID_CUES');
  const other: any = base();
  other.cues[0].text = 'a'.repeat(1001);
  other.contentHash = subtitleTrackContentHash(other);
  expect(() => validateSubtitleTrack(other)).toThrow('INVALID_CUE_TEXT');
  other.cues[0] = {
    position: 1,
    text: 'Olá.',
    startMilliseconds: 0,
    endMilliseconds: 400,
    extra: true,
  };
  other.contentHash = subtitleTrackContentHash(other);
  expect(() => validateSubtitleTrack(other)).toThrow('UNKNOWN_FIELD');
});
