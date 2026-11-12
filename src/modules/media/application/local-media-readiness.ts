export type LocalReadinessStatus = 'READY' | 'NOT_READY' | 'UNKNOWN';
export type LocalReadinessCode =
  | 'LOCAL_READINESS_UNAVAILABLE'
  | 'LOCAL_READINESS_INSPECTION_LIMIT'
  | 'LOCAL_TTS_CONFIGURATION_REQUIRED'
  | 'LOCAL_TTS_LICENSE_REQUIRED'
  | 'LOCAL_TTS_PIPER_REQUIRED'
  | 'LOCAL_MEDIA_CONFIGURATION_REQUIRED'
  | 'LOCAL_DEPENDENCY_UNAVAILABLE'
  | 'LOCAL_STORAGE_UNAVAILABLE'
  | 'ALIGNMENT_CONFIGURATION_REQUIRED'
  | 'ALIGNMENT_PYTHON_UNAVAILABLE'
  | 'ALIGNMENT_MODEL_UNAVAILABLE'
  | 'ALIGNMENT_MODEL_TAMPERED'
  | 'ALIGNMENT_MODEL_INCOMPATIBLE'
  | 'ALIGNMENT_ENVIRONMENT_UNAVAILABLE'
  | 'ALIGNMENT_ENVIRONMENT_TAMPERED'
  | 'ALIGNMENT_ENVIRONMENT_INCOMPATIBLE';
export interface LocalReadinessCheck {
  status: LocalReadinessStatus;
  codes: LocalReadinessCode[];
}
export interface LocalMediaReadiness {
  schemaVersion: 'local-media-readiness/1.0.0';
  scope: 'STATIC_ONLY';
  /** READY means configuration/presence only, never physical validation. */
  status: LocalReadinessStatus;
  automaticGeneration: LocalReadinessStatus;
  components: Record<
    'piper' | 'ctc' | 'ffmpeg' | 'ffprobe' | 'storage',
    LocalReadinessCheck
  >;
  /** Conditions deliberately left UNKNOWN without execution or heavy reads. */
  unverified: (
    | 'PIPER_MODEL_INTEGRITY_UNVERIFIED'
    | 'PIPER_RUNTIME_UNVERIFIED'
    | 'CTC_MODEL_INTEGRITY_UNVERIFIED'
    | 'CTC_RUNTIME_UNVERIFIED'
    | 'FFMPEG_CAPABILITIES_UNVERIFIED'
    | 'STORAGE_WRITABILITY_UNVERIFIED'
    | 'PHYSICAL_INFERENCE_UNVERIFIED'
  )[];
  physicalValidation: 'NOT_PERFORMED';
}
export function readinessCheck(
  status: LocalReadinessStatus,
  ...codes: LocalReadinessCode[]
): LocalReadinessCheck {
  return { status, codes };
}
export function localMediaReadiness(
  components: LocalMediaReadiness['components'] = {
    piper: readinessCheck('UNKNOWN', 'LOCAL_READINESS_UNAVAILABLE'),
    ctc: readinessCheck('UNKNOWN', 'LOCAL_READINESS_UNAVAILABLE'),
    ffmpeg: readinessCheck('UNKNOWN', 'LOCAL_READINESS_UNAVAILABLE'),
    ffprobe: readinessCheck('UNKNOWN', 'LOCAL_READINESS_UNAVAILABLE'),
    storage: readinessCheck('UNKNOWN', 'LOCAL_READINESS_UNAVAILABLE'),
  },
): LocalMediaReadiness {
  const checks = Object.values(components);
  const status = checks.some((c) => c.status === 'NOT_READY')
    ? 'NOT_READY'
    : checks.every((c) => c.status === 'READY')
      ? 'READY'
      : 'UNKNOWN';
  return {
    schemaVersion: 'local-media-readiness/1.0.0',
    scope: 'STATIC_ONLY',
    status,
    automaticGeneration: status === 'NOT_READY' ? 'NOT_READY' : 'UNKNOWN',
    components,
    unverified: [
      'PIPER_MODEL_INTEGRITY_UNVERIFIED',
      'PIPER_RUNTIME_UNVERIFIED',
      'CTC_MODEL_INTEGRITY_UNVERIFIED',
      'CTC_RUNTIME_UNVERIFIED',
      'FFMPEG_CAPABILITIES_UNVERIFIED',
      'STORAGE_WRITABILITY_UNVERIFIED',
      'PHYSICAL_INFERENCE_UNVERIFIED',
    ],
    physicalValidation: 'NOT_PERFORMED',
  };
}
