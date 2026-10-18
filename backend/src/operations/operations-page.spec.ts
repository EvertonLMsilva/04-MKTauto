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
      'globalThis.reviewTest = { buildReviewCriteria, fail, reviewPresentation };})();',
    ),
  ).runInContext(context);
  return { api: sandbox.reviewTest, node };
}
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
