import {
  compositionScope,
  compositionGrant,
  assertCompositionGrant,
} from './domain/composition-authorization.js';
import { completedContext } from './application/campaign-orchestrator.js';
const e = {
  execution_id: 'execution_001',
  campaign_id: 'campaign_001',
  run_id: 'run_001',
};
const done = () =>
  ({
    EDITORIAL: {
      script: { scriptId: 'script:v2', contentHash: 'a'.repeat(64) },
    },
    MEDIA_QC: {
      reports: [
        {
          result: 'PASS',
          identity: { mediaAssetId: 'media_001', contentHash: 'b'.repeat(64) },
          evidence: {
            provenance: {
              parameters: { humanReview: { decision: 'APPROVED' } },
            },
          },
        },
      ],
    },
    AUDIO: { voiceTrackId: 'voice_001', voiceTrackContentHash: 'c'.repeat(64) },
    ALIGNMENT: { verified: true },
    SUBTITLES: { subtitleId: 'subtitle_001' },
  }) as Record<string, any>;
test('composition rights require explicit scoped evidence and intelligibility assertion', () => {
  const d = done(),
    p = compositionScope(e, d),
    input = {
      scopeHash: p.scopeHash,
      acceptsCompositionRights: true,
      audioIntelligible: true,
      sourceRef: 'license/reference',
      statement:
        'I confirm local composition commercial rights for this exact media.',
    };
  expect(() => assertCompositionGrant(e, d)).toThrow(
    'COMPOSITION_RIGHTS_REQUIRED',
  );
  for (const field of ['acceptsCompositionRights', 'audioIntelligible'])
    expect(() =>
      compositionGrant(
        e,
        d,
        { ...input, [field]: false },
        'operator_001',
        new Date().toISOString(),
      ),
    ).toThrow('COMPOSITION_AUTHORIZATION_INVALID');
  d.COMPOSITION_AUTHORIZATION = compositionGrant(
    e,
    d,
    input,
    'operator_001',
    new Date().toISOString(),
  );
  expect(() => assertCompositionGrant(e, d)).not.toThrow();
  const original = d.COMPOSITION_AUTHORIZATION;
  d.COMPOSITION_AUTHORIZATION = { ...original, audioIntelligible: 'true' };
  expect(() => assertCompositionGrant(e, d)).toThrow();
  d.COMPOSITION_AUTHORIZATION = original;
  for (const key of ['campaign_id', 'run_id', 'execution_id'])
    expect(() =>
      assertCompositionGrant({ ...e, [key]: 'other_001' }, d),
    ).toThrow();
  d.AUDIO = { ...d.AUDIO, voiceTrackContentHash: 'd'.repeat(64) };
  expect(() => assertCompositionGrant(e, d)).toThrow();
});
test('script revision invalidates composition authorization while preserving visual QC', () => {
  const qc = done().MEDIA_QC;
  const events = [
    { event_type: 'STEP_DONE', evidence: { step: 'MEDIA_QC', result: qc } },
    {
      event_type: 'COMPOSITION_AUTHORIZED',
      evidence: { scopeHash: 'a'.repeat(64) },
    },
    {
      event_type: 'SCRIPT_REVISED',
      evidence: { script: { scriptId: 'next_revision' } },
    },
  ] as any;
  expect(completedContext(events)).toEqual({
    MEDIA_QC: qc,
    EDITORIAL: { script: { scriptId: 'next_revision' } },
  });
});
