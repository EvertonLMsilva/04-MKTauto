import { createHash } from "node:crypto";
import { SUBTITLE_STYLE_POLICY_VERSION, validateSubtitleTrack } from "./subtitle-track-contracts.js";

export const SUBTITLE_STYLE_POLICY = Object.freeze({
  version: SUBTITLE_STYLE_POLICY_VERSION,
  maximumWordsPerCue: 12,
  maximumLinesPerCue: 2,
  maximumCharactersPerLine: 34,
  minimumCueDurationMilliseconds: 600,
  gapMilliseconds: 80,
  tailMilliseconds: 120,
});

export class SubtitleGenerationError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "SubtitleGenerationError";
    this.code = code;
    this.field = field;
  }
}

export function normalizeSubtitleNarration(value) {
  if (typeof value !== "string") throw failure("INVALID_SUBTITLE_TEXT", "fullNarration", "narração deve ser texto");
  const normalized = value.normalize("NFC").trim().replace(/\p{White_Space}+/gu, " ");
  if (!normalized) throw failure("EMPTY_SUBTITLE_TEXT", "fullNarration", "narração vazia");
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) throw failure("INVALID_SUBTITLE_TEXT", "fullNarration", "narração contém controle inválido");
  return normalized;
}

export function generateSubtitleCues(fullNarration, durationMilliseconds) {
  if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds < 1) {
    throw failure("INVALID_SUBTITLE_DURATION", "durationMilliseconds", "duração deve ser inteira e positiva");
  }
  const text = normalizeSubtitleNarration(fullNarration);
  const words = text.split(" ");
  if (words.some((word) => codePoints(word) > 1000)) {
    throw failure("SUBTITLE_TOKEN_TOO_LONG", "fullNarration", "palavra indivisível excede o contrato");
  }
  const texts = segment(words);
  if (texts.length > 1000) throw failure("TOO_MANY_SUBTITLE_CUES", "fullNarration", "quantidade de cues excede o contrato");
  const required = texts.length * SUBTITLE_STYLE_POLICY.minimumCueDurationMilliseconds
    + (texts.length - 1) * SUBTITLE_STYLE_POLICY.gapMilliseconds
    + SUBTITLE_STYLE_POLICY.tailMilliseconds;
  if (durationMilliseconds < required) {
    throw failure("SUBTITLE_DURATION_INSUFFICIENT", "durationMilliseconds", "voz curta para a política de legendas");
  }
  const distributable = durationMilliseconds - required;
  const weights = texts.map(codePoints);
  const additions = apportion(distributable, weights);
  let start = 0;
  return deepFreeze(texts.map((cueText, index) => {
    const end = start + SUBTITLE_STYLE_POLICY.minimumCueDurationMilliseconds + additions[index];
    const cue = { position: index + 1, text: cueText, startMilliseconds: start, endMilliseconds: end };
    start = end + SUBTITLE_STYLE_POLICY.gapMilliseconds;
    return cue;
  }));
}

export function subtitleCueContentHash(cues) {
  return sha256(stableJson(cues));
}

export function serializeSubtitleSrt(value) {
  const track = validateSubtitleTrack(value);
  return `${track.cues.map((cue) => [
    String(cue.position),
    `${srtTime(cue.startMilliseconds)} --> ${srtTime(cue.endMilliseconds)}`,
    wrap(cue.text).map(escapeSrt).join("\r\n"),
  ].join("\r\n")).join("\r\n\r\n")}\r\n`;
}

export function serializeSubtitleAss(value) {
  const track = validateSubtitleTrack(value);
  const header = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    "Style: Default,Arial,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,140,140,160,1", "",
    "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  const events = track.cues.map((cue) => {
    const text = wrap(cue.text).map(escapeAss).join("\\N");
    return `Dialogue: 0,${assTime(cue.startMilliseconds, false)},${assTime(cue.endMilliseconds, true)},Default,,0,0,0,,${text}`;
  });
  return `${[...header, ...events].join("\r\n")}\r\n`;
}

function segment(words) {
  const cues = [];
  let start = 0;
  while (start < words.length) {
    let maximumEnd = start;
    while (maximumEnd < words.length && maximumEnd - start < SUBTITLE_STYLE_POLICY.maximumWordsPerCue
      && canWrap(words.slice(start, maximumEnd + 1))) maximumEnd += 1;
    if (maximumEnd === start) maximumEnd += 1;
    let end = boundary(words, start, maximumEnd, /[.!?…]["'”’)]*$/u);
    if (end === null) end = boundary(words, start, maximumEnd, /[,;:]["'”’)]*$/u);
    if (end === null) end = maximumEnd;
    cues.push(words.slice(start, end).join(" "));
    start = end;
  }
  return cues;
}

function boundary(words, start, end, pattern) {
  for (let index = end - 1; index >= start; index -= 1) if (pattern.test(words[index])) return index + 1;
  return null;
}

function canWrap(words) { return wrap(words.join(" ")).length <= SUBTITLE_STYLE_POLICY.maximumLinesPerCue; }
function wrap(text) {
  const lines = [];
  for (const word of text.split(" ")) {
    const current = lines.at(-1);
    if (current !== undefined && codePoints(`${current} ${word}`) <= SUBTITLE_STYLE_POLICY.maximumCharactersPerLine) lines[lines.length - 1] = `${current} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function apportion(total, weights) {
  const sum = weights.reduce((value, weight) => value + weight, 0);
  const base = weights.map((weight) => Number(BigInt(total) * BigInt(weight) / BigInt(sum)));
  let remaining = total - base.reduce((value, part) => value + part, 0);
  const order = weights.map((weight, index) => ({ index, remainder: (BigInt(total) * BigInt(weight)) % BigInt(sum) }))
    .sort((left, right) => left.remainder === right.remainder ? left.index - right.index : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index += 1) base[order[index].index] += 1;
  return base;
}

function srtTime(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds % 1000, 3)}`;
}
function assTime(milliseconds, roundUp) {
  const centiseconds = roundUp ? Math.ceil(milliseconds / 10) : Math.floor(milliseconds / 10);
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor(centiseconds / 6000) % 60;
  const seconds = Math.floor(centiseconds / 100) % 60;
  return `${hours}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(centiseconds % 100, 2)}`;
}
function escapeSrt(text) { return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function escapeAss(text) { return text.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}"); }
function pad(value, size) { return String(value).padStart(size, "0"); }
function codePoints(value) { return [...value].length; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { const clone = structuredClone(value); freeze(clone); return clone; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return Object.freeze(value); Object.values(value).forEach(freeze); return Object.freeze(value); }
function failure(code, field, message, options) { return new SubtitleGenerationError(code, field, message, options); }
