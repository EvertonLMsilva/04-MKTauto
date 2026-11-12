import { adaptationHash } from '../domain/media-hash.js';

export interface LocalQcContext {
  renderId: string;
  renderHash: string;
  renderRevision: number;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  scriptId: string;
  scriptHash: string;
  scriptRevision: number;
  planId: string;
  planHash: string;
  voiceId: string;
  voiceHash: string;
  assets: { position: number; id: string; contentHash: string }[];
  subtitle: {
    id: string;
    contentHash: string;
    srtHash: string;
    assHash: string;
  };
}
export interface LocalQcHandoffEvidence {
  schemaVersion: 'local-qc-handoff/1';
  reportId: string;
  report: {
    policyVersion: string;
    videoRenderId: string;
    videoRenderContentHash: string;
    result: 'PASS' | 'FAIL' | 'UNKNOWN';
    approvalBlocked: boolean;
    findings: { code: string; status: string }[];
    [key: string]: unknown;
  };
  checkedAt: string;
  context: LocalQcContext;
}
export function localQcFailure(code: string): never {
  throw Object.assign(new Error(code), { code });
}
/** This verifies local-qc/1 evidence, not equivalence to quality-control-policy/1 or /2. */
export function validateLocalQcHandoff(value: unknown): LocalQcHandoffEvidence {
  const v = value as LocalQcHandoffEvidence;
  if (!v || v.schemaVersion !== 'local-qc-handoff/1' || !v.report || !v.context)
    localQcFailure('QC_LINEAGE_MISMATCH');
  if (
    v.reportId !== `local_qc:${adaptationHash(v.report)}` ||
    v.report.policyVersion !== 'local-qc/1'
  )
    localQcFailure('QC_BINDING_MISMATCH');
  if (
    typeof v.checkedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(v.checkedAt) ||
    !Number.isFinite(Date.parse(v.checkedAt)) ||
    Date.parse(v.checkedAt) > Date.now()
  )
    localQcFailure('QC_TIMESTAMP_REQUIRED');
  const c = v.context;
  for (const key of [
    'renderHash',
    'scriptHash',
    'planHash',
    'voiceHash',
  ] as const)
    if (!/^[a-f0-9]{64}$/.test(c[key])) localQcFailure('QC_LINEAGE_MISMATCH');
  if (
    !Number.isSafeInteger(c.scriptRevision) ||
    c.scriptRevision < 1 ||
    !Number.isSafeInteger(c.renderRevision) ||
    c.renderRevision < 1 ||
    !Array.isArray(c.assets) ||
    !c.assets.length ||
    !c.subtitle
  )
    localQcFailure('QC_LINEAGE_MISMATCH');
  for (const asset of c.assets)
    if (
      !asset.id ||
      !Number.isSafeInteger(asset.position) ||
      asset.position < 1 ||
      !/^[a-f0-9]{64}$/.test(asset.contentHash)
    )
      localQcFailure('QC_LINEAGE_MISMATCH');
  for (const key of ['contentHash', 'srtHash', 'assHash'] as const)
    if (!/^[a-f0-9]{64}$/.test(c.subtitle[key]))
      localQcFailure('QC_LINEAGE_MISMATCH');
  if (
    v.report.videoRenderId !== c.renderId ||
    v.report.videoRenderContentHash !== c.renderHash
  )
    localQcFailure('QC_BINDING_MISMATCH');
  if (
    !['PASS', 'FAIL', 'UNKNOWN'].includes(v.report.result) ||
    v.report.approvalBlocked !== (v.report.result !== 'PASS') ||
    !Array.isArray(v.report.findings)
  )
    localQcFailure('QC_BINDING_MISMATCH');
  const findings = v.report.findings;
  if (
    v.report.result === 'PASS' &&
    (findings.some((f) => f.status !== 'PASS') ||
      [
        'PHYSICAL_HASH',
        'VERIFIED_SUBTITLES_LINEAGE',
        'STREAMS_FORMAT_DURATION',
        'FULL_DECODE',
      ].some(
        (code) =>
          findings.filter((f) => f.code === code && f.status === 'PASS')
            .length !== 1,
      ))
  )
    localQcFailure('QC_LINEAGE_MISMATCH');
  return structuredClone(v);
}
