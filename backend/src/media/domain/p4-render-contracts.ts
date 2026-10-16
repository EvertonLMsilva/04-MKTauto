import { validateVideoOrigin } from './p4-qc-contracts.js';
import { immutable } from '../../affiliate/domain/affiliate-contracts.js';
import { OPENAI_TTS_VOICES, OPENAI_TTS_STYLES } from './voice-capabilities.js';
export function p4Fail(code: any, field: any = 'contract'): any {
  throw Object.assign(new Error(`${code}: ${field}`), { code, field });
}
const hash: any = (value: any): any =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id: any = (value: any): any =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9_:-]{2,199}$/.test(value);
const exact: any = (value: any, keys: any): any => {
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .join(',') !==
      [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(',')
  )
    p4Fail('P4_INVALID_CONTRACT');
};
export const AUDIO_CAPABILITIES: any = Object.freeze({
  openai: {
    languages: ['pt-BR'],
    voices: OPENAI_TTS_VOICES,
    styles: OPENAI_TTS_STYLES,
  },
  fake_voice: {
    languages: ['pt-BR'],
    voices: ['fixture_ptbr', 'fixture_alternate'],
    styles: ['informative', 'calm'],
  },
});
export function validateAudioConfig(value: any): any {
  value = { language: 'pt-BR', ...value };
  exact(value, [
    'schemaVersion',
    'campaignId',
    'revision',
    'language',
    'provider',
    'voice',
    'style',
    'mode',
    'originalGainDb',
    'narrationGainDb',
  ]);
  const c: any = AUDIO_CAPABILITIES[value.provider];
  if (
    value.schemaVersion !== 'campaign-audio/1.0.0' ||
    !id(value.campaignId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !c?.languages.includes(value.language) ||
    !c.voices.includes(value.voice) ||
    !c.styles.includes(value.style) ||
    !['PRESERVE', 'REPLACE', 'MIX'].includes(value.mode) ||
    ![value.originalGainDb, value.narrationGainDb].every(
      (n: any): any => Number.isFinite(n) && n >= -60 && n <= 12,
    )
  )
    p4Fail('P4_AUDIO_CONFIG_INVALID');
  return immutable(value);
}
export function validateP4Render(value: any): any {
  exact(value, [
    'schemaVersion',
    'videoRenderId',
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'origin',
    'audioConfigId',
    'audioConfigHash',
    'narrationId',
    'narrationHash',
    'outputAspectRatio',
    'widthPixels',
    'heightPixels',
    'durationMilliseconds',
    'frameCount',
    'frameRate',
    'videoCodec',
    'videoProfile',
    'audioCodec',
    'audioProfile',
    'audioSampleRate',
    'audioChannels',
    'contentHash',
    'logicalReference',
    'revision',
    'supersedesVideoRenderId',
    'createdAt',
  ]);
  validateVideoOrigin(value.origin);
  const ratios: any = { '9:16': [9, 16], '4:5': [4, 5], '1:1': [1, 1] },
    r: any = ratios[value.outputAspectRatio];
  if (
    value.schemaVersion !== 'video-render/2.0.0' ||
    !['videoRenderId', 'pipelineRunId', 'projectId', 'audioConfigId'].every(
      (k: any): any => id(value[k]),
    ) ||
    !['contentHash', 'audioConfigHash'].every((k: any): any =>
      hash(value[k]),
    ) ||
    !Number.isSafeInteger(value.projectVersion) ||
    value.projectVersion < 1 ||
    !r ||
    ![
      value.widthPixels,
      value.heightPixels,
      value.frameCount,
      value.durationMilliseconds,
    ].every((n: any): any => Number.isSafeInteger(n) && n > 0) ||
    value.widthPixels % 2 ||
    value.heightPixels % 2 ||
    value.widthPixels > 1080 ||
    value.heightPixels > 1920 ||
    value.widthPixels * r[1] !== value.heightPixels * r[0] ||
    ![24, 30].includes(value.frameRate) ||
    Math.abs(
      (value.frameCount / value.frameRate) * 1000 - value.durationMilliseconds,
    ) >
      1000 / value.frameRate + 1 ||
    value.videoCodec !== 'h264' ||
    value.videoProfile !== 'High' ||
    value.audioCodec !== 'aac' ||
    value.audioProfile !== 'LC' ||
    value.audioSampleRate !== 48000 ||
    ![1, 2].includes(value.audioChannels) ||
    value.logicalReference !== `render:sha256_${value.contentHash}` ||
    value.revision !== 1 ||
    value.supersedesVideoRenderId !== null ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    (value.narrationId === null
      ? value.narrationHash !== null
      : !id(value.narrationId) || !hash(value.narrationHash))
  )
    p4Fail('P4_RENDER_INVALID');
  return immutable(value);
}
