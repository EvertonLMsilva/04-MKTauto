import { createHash } from 'node:crypto';
import { adaptationHash } from './media-hash.js';
export function localFail(code: string): never {
  throw Object.assign(new Error(code), { code, field: 'localMedia' });
}
export interface AlignmentInput {
  audioAssetId: string;
  audioSha256: string;
  scriptId: string;
  scriptVersion: number;
  scriptTextSha256: string;
  durationMs: number;
  canonicalText: string;
}
export interface AlignmentSegment {
  startMs: number;
  endMs: number;
  text: string;
  textStartOffset: number;
  textEndOffset: number;
}
export interface AlignmentEvidence {
  input: AlignmentInput;
  parameters: Record<string, string | number | boolean>;
  provenance: 'FORCED_ALIGNMENT' | 'NATIVE_TIMESTAMPS';
  output: {
    alignmentId: string;
    provider: string;
    modelVersion: string;
    audioSha256: string;
    scriptTextSha256: string;
    segments: AlignmentSegment[];
    evidenceHash: string;
    status: 'VERIFIED' | 'UNKNOWN';
  };
}
// Text hashes always cover the exact UTF-8 text; evidence uses canonical JSON.
export function alignmentHash(value: unknown): string {
  if (typeof value === 'string')
    return createHash('sha256').update(value).digest('hex');
  const v = structuredClone(value) as AlignmentEvidence;
  if (v?.output) {
    const { evidenceHash: _hash, ...output } = v.output;
    return adaptationHash({ ...v, output });
  }
  return adaptationHash(value);
}
export function validateAlignment(value: unknown): AlignmentEvidence {
  const v = value as AlignmentEvidence;
  exact(v, ['input', 'parameters', 'provenance', 'output']);
  exact(v.input, [
    'audioAssetId',
    'audioSha256',
    'scriptId',
    'scriptVersion',
    'scriptTextSha256',
    'durationMs',
    'canonicalText',
  ]);
  exact(v.output, [
    'alignmentId',
    'provider',
    'modelVersion',
    'audioSha256',
    'scriptTextSha256',
    'segments',
    'evidenceHash',
    'status',
  ]);
  for (const id of [
    v.input.audioAssetId,
    v.input.scriptId,
    v.output.alignmentId,
  ])
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_:-]{2,199}$/.test(id))
      localFail('ALIGNMENT_ID_INVALID');
  for (const token of [v.output.provider, v.output.modelVersion])
    if (
      typeof token !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(token)
    )
      localFail('ALIGNMENT_PROVIDER_INVALID');
  if (
    !v.parameters ||
    typeof v.parameters !== 'object' ||
    Array.isArray(v.parameters) ||
    Object.entries(v.parameters).some(
      ([k, x]) =>
        !/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(k) ||
        !['string', 'number', 'boolean'].includes(typeof x) ||
        (typeof x === 'number' && !Number.isFinite(x)),
    )
  )
    localFail('ALIGNMENT_PARAMETERS_INVALID');
  if (!['FORCED_ALIGNMENT', 'NATIVE_TIMESTAMPS'].includes(v.provenance))
    localFail('ALIGNMENT_PROVENANCE_REQUIRED');
  if (v.output.status !== 'VERIFIED') localFail('ALIGNMENT_UNVERIFIED');
  for (const hash of [
    v.input.audioSha256,
    v.input.scriptTextSha256,
    v.output.evidenceHash,
  ])
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
      localFail('ALIGNMENT_HASH_INVALID');
  if (
    v.output.audioSha256 !== v.input.audioSha256 ||
    v.output.scriptTextSha256 !== v.input.scriptTextSha256 ||
    typeof v.input.canonicalText !== 'string' ||
    alignmentHash(v.input.canonicalText) !== v.input.scriptTextSha256
  )
    localFail('ALIGNMENT_BINDING_MISMATCH');
  if (
    !Number.isSafeInteger(v.input.scriptVersion) ||
    v.input.scriptVersion < 1 ||
    !Number.isSafeInteger(v.input.durationMs) ||
    v.input.durationMs < 1
  )
    localFail('ALIGNMENT_INPUT_INVALID');
  if (
    !Array.isArray(v.output.segments) ||
    !v.output.segments.length ||
    v.output.segments.length > 10000
  )
    localFail('ALIGNMENT_SEGMENTS_REQUIRED');
  let end = 0,
    offset = 0;
  for (const s of v.output.segments) {
    exact(s, ['startMs', 'endMs', 'text', 'textStartOffset', 'textEndOffset']);
    if (
      ![s.startMs, s.endMs, s.textStartOffset, s.textEndOffset].every(
        Number.isSafeInteger,
      ) ||
      s.startMs < end ||
      s.endMs <= s.startMs ||
      s.endMs > v.input.durationMs ||
      s.textStartOffset < offset ||
      s.textEndOffset <= s.textStartOffset ||
      s.textEndOffset > v.input.canonicalText.length
    )
      localFail('ALIGNMENT_RANGE_INVALID');
    if (
      typeof s.text !== 'string' ||
      !s.text.trim() ||
      /[\r\n]/.test(s.text) ||
      s.text.includes(String.fromCharCode(0)) ||
      s.text !==
        v.input.canonicalText.slice(s.textStartOffset, s.textEndOffset) ||
      v.input.canonicalText.slice(offset, s.textStartOffset).trim()
    )
      localFail('ALIGNMENT_TEXT_MISMATCH');
    end = s.endMs;
    offset = s.textEndOffset;
  }
  if (v.input.canonicalText.slice(offset).trim())
    localFail('ALIGNMENT_TEXT_INCOMPLETE');
  if (alignmentHash(v) !== v.output.evidenceHash)
    localFail('ALIGNMENT_EVIDENCE_TAMPERED');
  return structuredClone(v);
}
function exact(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== keys.sort().join()
  )
    localFail('ALIGNMENT_CONTRACT_INVALID');
}
export function serializeSubtitles(segments: AlignmentSegment[]) {
  if (
    segments.some((s) => Math.floor(s.endMs / 10) <= Math.floor(s.startMs / 10))
  )
    localFail('SUBTITLE_ASS_PRECISION_UNSUPPORTED');
  const time = (ms: number, ass = false) => {
    const units = ass ? Math.floor(ms / 10) : ms;
    const scale = ass ? 100 : 1000;
    return `${String(Math.floor(units / (3600 * scale))).padStart(ass ? 1 : 2, '0')}:${String(Math.floor(units / (60 * scale)) % 60).padStart(2, '0')}:${String(Math.floor(units / scale) % 60).padStart(2, '0')}${ass ? '.' : ','}${String(units % scale).padStart(ass ? 2 : 3, '0')}`;
  };
  const srt = segments
    .map(
      (s, i) =>
        `${i + 1}\n${time(s.startMs)} --> ${time(s.endMs)}\n${s.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}\n`,
    )
    .join('\n');
  const header =
    '[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,60,60,100,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const ass =
    header +
    segments
      .map(
        (s) =>
          `Dialogue: 0,${time(s.startMs, true)},${time(s.endMs, true)},Default,,0,0,0,,${s.text.replaceAll('\\', '＼').replaceAll('{', '｛').replaceAll('}', '｝')}`,
      )
      .join('\n') +
    '\n';
  return { srt, ass };
}
