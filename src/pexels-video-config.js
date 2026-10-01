import { resolve } from "node:path";
import { PexelsVideoAdapterError } from "./adapters/pexels-video-error.js";

export const PEXELS_VIDEO_ENDPOINT = "https://api.pexels.com/v1/videos/search";
export const PEXELS_VIDEO_POLICY_VERSION = "pexels-video-policy/1.0.0";

export function loadPexelsVideoConfig(env = process.env) {
  const apiKey = required(env.PEXELS_API_KEY, "PEXELS_API_KEY");
  const storageRoot = resolve(required(env.PEXELS_VIDEO_STORAGE_ROOT ?? env.OPENAI_IMAGE_STORAGE_ROOT, "PEXELS_VIDEO_STORAGE_ROOT"));
  const ffmpegPath = resolve(required(env.FFMPEG_PATH, "FFMPEG_PATH"));
  const ffprobePath = resolve(required(env.FFPROBE_PATH, "FFPROBE_PATH"));
  const endpoint = env.PEXELS_VIDEO_ENDPOINT ?? PEXELS_VIDEO_ENDPOINT;
  if (endpoint !== PEXELS_VIDEO_ENDPOINT) fail("PEXELS_VIDEO_CONFIGURATION_INVALID", "PEXELS_VIDEO_ENDPOINT", "endpoint fora da política");
  return Object.freeze({
    apiKey, endpoint, storageRoot, ffmpegPath, ffprobePath,
    timeoutMs: integer(env.PEXELS_VIDEO_TIMEOUT_MS ?? "120000", "PEXELS_VIDEO_TIMEOUT_MS", 1, 300000),
    maxResponseBytes: integer(env.PEXELS_VIDEO_MAX_RESPONSE_BYTES ?? "2097152", "PEXELS_VIDEO_MAX_RESPONSE_BYTES", 1024, 10485760),
    maxVideoBytes: integer(env.PEXELS_VIDEO_MAX_VIDEO_BYTES ?? "104857600", "PEXELS_VIDEO_MAX_VIDEO_BYTES", 1024, 524288000),
    perPage: 15, minimumWidthPixels: 720, minimumHeightPixels: 1280,
    policyVersion: PEXELS_VIDEO_POLICY_VERSION,
    rights: Object.freeze({ usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true }),
    licenseName: "Pexels License", licenseUrl: "https://www.pexels.com/license/",
  });
}

function required(value, field) { if (typeof value !== "string" || value.trim() === "") fail("PEXELS_VIDEO_CONFIGURATION_MISSING", field, "configuração obrigatória ausente"); return value.trim(); }
function integer(value, field, min, max) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail("PEXELS_VIDEO_CONFIGURATION_INVALID", field, "configuração inválida"); return parsed; }
function fail(code, field, message) { throw new PexelsVideoAdapterError(code, field, message); }
