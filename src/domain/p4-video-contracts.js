import { immutable } from './affiliate-contracts.js';
import { OPENAI_TTS_VOICES, OPENAI_TTS_STYLES } from './voice-capabilities.js';
export function p4Fail(code, field = 'contract') { throw Object.assign(new Error(`${code}: ${field}`), { code, field }); }
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_:-]{2,199}$/.test(value);
const exact = (value, keys) => { if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) p4Fail('P4_INVALID_CONTRACT'); };
export const AUDIO_CAPABILITIES = Object.freeze({ openai: { languages: ['pt-BR'], voices: OPENAI_TTS_VOICES, styles: OPENAI_TTS_STYLES },
  fake_voice: { languages: ['pt-BR'], voices: ['fixture_ptbr', 'fixture_alternate'], styles: ['informative', 'calm'] } });
export function validateAudioConfig(value) {
  value={language:'pt-BR',...value};
  exact(value, ['schemaVersion', 'campaignId', 'revision', 'language', 'provider', 'voice', 'style', 'mode', 'originalGainDb', 'narrationGainDb']);
  const c = AUDIO_CAPABILITIES[value.provider];
  if (value.schemaVersion !== 'campaign-audio/1.0.0' || !id(value.campaignId) || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !c?.languages.includes(value.language) || !c.voices.includes(value.voice) || !c.styles.includes(value.style)
    || !['PRESERVE', 'REPLACE', 'MIX'].includes(value.mode) || ![value.originalGainDb, value.narrationGainDb].every(n => Number.isFinite(n) && n >= -60 && n <= 12)) p4Fail('P4_AUDIO_CONFIG_INVALID');
  return immutable(value);
}
