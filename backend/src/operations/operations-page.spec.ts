import { Script, createContext } from 'node:vm';
import {
  operationsPage,
  operationsScript,
  operationsStyles,
} from './operations-page.js';

test('operational page has a self-contained script, explicit human decisions and no credential persistence', () => {
  expect(() => new Script(operationsScript)).not.toThrow();
  expect(operationsPage).toContain('Aprovar mídia');
  expect(operationsPage).toContain('Rejeitar versão final');
  expect(operationsPage).toContain('type="password"');
  expect(operationsScript).not.toMatch(
    /localStorage|sessionStorage|innerHTML|document\.cookie/,
  );
  expect(operationsStyles).toContain('@media');
});

function browserReviewHarness() {
  const nodes = new Map<string, any>();
  const node = (id: string): any => {
    if (!nodes.has(id))
      nodes.set(id, {
        hidden: false,
        textContent: '',
        addEventListener: vi.fn(),
        removeAttribute: vi.fn(),
      });
    return nodes.get(id);
  };
  const sandbox: any = {
    document: { getElementById: node },
    fetch: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: 'QC_SESSION_EXPIRED' }),
    }),
    clearTimeout: vi.fn(),
    setTimeout: vi.fn(),
  };
  const context = createContext(sandbox);
  new Script(
    operationsScript.replace(
      /\}\)\(\);\s*$/,
      'globalThis.reviewTest = { buildReviewCriteria, fail, reviewPresentation, renderInstagramConnection, renderTts, renderNextAction };})();',
    ),
  ).runInContext(context);
  return { api: sandbox.reviewTest, node };
}
test('current v2 narration shows TTS consent and hides unrelated script revision and recording actions', () => {
  const { api, node } = browserReviewHarness();
  const data = {
    nextAction: { code: 'TTS_AUTHORIZATION_REQUIRED' },
    tts: {
      requestHash: 'a'.repeat(64),
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      text: 'Veja os detalhes do produto.',
      estimatedUsd: '0.00306',
      reservationUsd: '0.01',
      policyVersion: 'tts-risk-reservation/2.0.0',
      state: 'NOT_SUBMITTED',
      liveEnabled: false,
    },
    execution: {
      status: 'WAITING_INPUT',
      finalization: { completedSteps: ['EDITORIAL', 'MEDIA_QC'] },
    },
  };
  api.renderNextAction(data);
  expect(node('script-revision-panel').hidden).toBe(true);
  expect(node('audio-panel').hidden).toBe(true);
  expect(node('tts-panel').hidden).toBe(false);
  expect(node('tts-model').textContent).toContain('marin');
  expect(node('tts-text').textContent).toBe(data.tts.text);
  expect(node('tts-price').textContent).toContain('0.00306');
  expect(node('tts-price').textContent).toContain('0.01');
  expect(node('tts-price').textContent).toContain('tts-risk-reservation/2.0.0');
  expect(node('tts-generate').disabled).toBe(true);
  api.renderNextAction({
    ...data,
    nextAction: { code: 'SCRIPT_REVISION_REQUIRED' },
  });
  expect(node('script-revision-panel').hidden).toBe(false);
  expect(node('tts-panel').hidden).toBe(true);
});
test('TTS risk consent uses the prepared narration and cannot resend an uncertain operation', () => {
  expect(operationsPage).toContain('id="tts-accept-risk"');
  const { api, node } = browserReviewHarness();
  const prepared = {
    requestHash: 'a'.repeat(64),
    model: 'gpt-4o-mini-tts',
    voice: 'marin',
    text: 'Confira pelo link.',
    estimatedUsd: '0.00306',
    reservationUsd: '0.01',
    state: 'NOT_SUBMITTED',
    liveEnabled: true,
    audioConfirmed: false,
  };
  api.renderTts(prepared);
  expect(node('tts-text').textContent).toContain(prepared.text);
  expect(node('tts-generate').disabled).toBe(true);
  node('tts-accept-risk').checked = true;
  api.renderTts(prepared);
  expect(node('tts-generate').disabled).toBe(false);
  api.renderTts({ ...prepared, state: 'UNKNOWN' });
  expect(node('tts-generate').disabled).toBe(true);
  api.renderTts({
    ...prepared,
    state: 'UNKNOWN',
    audioConfirmed: true,
    liveEnabled: false,
  });
  expect(node('tts-generate').textContent).toContain('Retomar');
  expect(node('tts-generate').disabled).toBe(false);
});

test('connection readiness is visible without selecting a completed campaign and keeps LIVE blocked', () => {
  expect(operationsPage).toContain('id="instagram-connection-check"');
  const { api, node } = browserReviewHarness();
  api.renderInstagramConnection({
    connection: 'READY',
    missingConfiguration: [],
    requiredPermissions: ['instagram_basic'],
    missingPermissions: [],
    token: { status: 'VALID', expiresAt: null },
    blockers: [],
    livePublication: { eligible: false },
    checkedAt: '2026-10-18T12:00:00Z',
  });
  expect(node('instagram-connection-status').textContent).toContain(
    'Conexão pronta',
  );
  expect(node('instagram-connection-status').textContent).toContain(
    'LIVE bloqueada',
  );
  api.renderInstagramConnection({
    connection: 'BLOCKED',
    missingConfiguration: [],
    missingPermissions: ['instagram_content_publish'],
    token: { status: 'VALID' },
    blockers: ['META_PERMISSION_REQUIRED'],
    livePublication: { eligible: false },
  });
  expect(node('instagram-connection-status').textContent).toContain(
    'instagram_content_publish',
  );
  expect(node('instagram-connection-status').textContent).not.toContain(
    'Conexão pronta',
  );
  api.renderInstagramConnection({
    connection: 'UNAVAILABLE',
    missingConfiguration: [],
    missingPermissions: null,
    token: { status: 'NOT_CHECKED' },
    blockers: ['META_UNAVAILABLE'],
    livePublication: { eligible: false },
  });
  expect(node('instagram-connection-status').textContent).toContain(
    'Permissões ainda não verificadas',
  );
});
test('textarea whitespace is submitted as valid public text, preserving exact full-video intervals', () => {
  const { api } = browserReviewHarness();
  const fields = new Map(
    ['motion', 'continuity', 'fidelity'].map((key) => [
      key,
      '  Movimento observado.\nContinuidade verificada.\t  ',
    ]),
  );
  const criteria = api.buildReviewCriteria(
    {
      reviewInterval: { startSeconds: 0, endSeconds: 5.184 },
      asset: { durationMilliseconds: 5184 },
    },
    fields,
  );
  for (const item of Object.values(criteria) as any[]) {
    expect(item).toEqual({
      startSeconds: 0,
      endSeconds: 5.184,
      observation: 'Movimento observado. Continuidade verificada.',
    });
  }
});
test('review contract errors identify the invalid field without reflecting response details', () => {
  const { api, node } = browserReviewHarness();
  api.fail({
    code: 'HUMAN_APPROVAL_REQUEST_INVALID',
    field: 'observation',
    status: 400,
    message: 'private data',
  });
  expect(node('notice').textContent).toContain('observações');
  expect(node('notice').textContent).not.toContain('private data');
  api.fail({ code: 'HUMAN_APPROVAL_VIDEO_BINDING_MISMATCH', status: 400 });
  expect(node('notice').textContent).toContain('versão');
});

test('normalization does not accept empty observations or disclose arbitrary backend messages', () => {
  const { api, node } = browserReviewHarness();
  expect(() =>
    api.buildReviewCriteria(
      { asset: { durationMilliseconds: 5184 } },
      new Map([['motion', '  \n  ']]),
    ),
  ).toThrow();
  api.fail({ code: 'invalid private details', message: 'private details' });
  expect(node('notice').textContent).not.toContain('private details');
  api.fail({ code: 'MEDIA_UNAVAILABLE' });
  expect(node('notice').textContent).toContain('MEDIA_UNAVAILABLE');
});

test('criteria reflect the authoritative authenticated review, preserving the automatic assessment separately', () => {
  const { api } = browserReviewHarness();
  const automatic = {
    evidence: {
      motion: 'NOT_VALIDATED',
      continuity: 'NOT_VALIDATED',
      fidelity: 'NOT_VALIDATED',
    },
  };
  const audit = { actor: 'reviewer_fixture', decision: 'APPROVED' };
  const evidence = {
    motion: 'PASS',
    continuity: 'PASS',
    fidelity: 'PASS',
    provenance: {
      validator: 'authenticated-human-qc',
      parameters: { humanReview: audit },
    },
  };
  expect(api.reviewPresentation({ automatic, review: { evidence } })).toEqual({
    evidence,
    audit,
  });
  expect(api.reviewPresentation({ automatic, review: null })).toEqual({
    evidence: automatic.evidence,
    audit: null,
  });
  expect(automatic.evidence.motion).toBe('NOT_VALIDATED');
  const rejected = {
    ...evidence,
    motion: 'FAIL',
    continuity: 'FAIL',
    fidelity: 'FAIL',
    provenance: {
      validator: 'authenticated-human-qc',
      parameters: { humanReview: { ...audit, decision: 'REJECTED' } },
    },
  };
  expect(
    api.reviewPresentation({ automatic, review: { evidence: rejected } })
      .evidence.motion,
  ).toBe('FAIL');
});
