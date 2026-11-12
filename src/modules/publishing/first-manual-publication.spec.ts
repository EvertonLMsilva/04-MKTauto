import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
const toolUrl = new URL(
  '../../../scripts/ops-local/first-manual-publication.mjs',
  import.meta.url,
);
const { firstManualPublication, browserCommand } = await import(toolUrl.href);

function fixture() {
  const packageHash = 'a'.repeat(64),
    videoHash = 'b'.repeat(64);
  const selection = {
    packageHash,
    platform: 'instagram',
    account: '123456789',
  };
  const readiness = {
    schemaVersion: 'manual-release-readiness/1.0.0',
    packageHash,
    status: 'READY_FOR_OPERATOR_HANDOFF',
    ready: true,
    identity: {
      videoRenderId: 'FICTITIOUS_TEST_ONLY_render',
      videoRenderRevision: 1,
      videoSha256: videoHash,
      qcReportId: 'FICTITIOUS_TEST_ONLY_qc',
    },
    destination: { platform: selection.platform, account: selection.account },
    checks: Object.fromEntries(
      [
        'integrity',
        'mediaIntegrity',
        'qc',
        'approval',
        'rights',
        'physicalEvidence',
        'eligibility',
      ].map((k) => [k, 'PASS']),
    ),
    blockerCodes: [],
    nextAction: 'OPEN_MANUAL_HANDOFF',
    publicationConfirmed: false,
  };
  const handoff = {
    schemaVersion: 'manual-release-handoff/1.0.0',
    packageHash,
    destination: readiness.destination,
    video: {
      videoRenderId: readiness.identity.videoRenderId,
      revision: 1,
      sha256: videoHash,
      mediaReference: 'render:sha256_' + videoHash,
    },
    caption: 'FICTITIOUS_TEST_ONLY: legenda exata.\nOutra linha.',
    cta: 'Confira os detalhes',
    disclosure: 'Publicidade: link afiliado',
    affiliateUrl:
      'https://example.com/item?sub_id1=camp%2B001&sub_id2=video_001',
    finalCaption: 'FICTITIOUS_TEST_ONLY: cópia exata recebida do servidor',
    qualityControl: {
      reportId: readiness.identity.qcReportId,
      contentHash: 'c'.repeat(64),
      result: 'PASS',
    },
    approval: {
      decision: 'APPROVED',
      reviewHash: 'd'.repeat(64),
      decisionId: 'FICTITIOUS_TEST_ONLY_review',
      revoked: false,
    },
    eligibility: { status: 'PASS', pending: [] },
    publicationStatus: 'NOT_CONFIRMED_BY_HANDOFF',
    token: 'PRIVATE_SENTINEL',
    rightsEvidence: 'PRIVATE_SENTINEL',
    uploadUri: 'PRIVATE_SENTINEL',
  };
  const fetch = vi.fn(
    async (url: string, _options: RequestInit) =>
      new Response(
        JSON.stringify(
          url.includes('/manual-publications?')
            ? []
            : url.endsWith('manual-handoff')
              ? handoff
              : readiness,
        ),
        { status: 200 },
      ),
  );
  return {
    selection,
    readiness,
    handoff,
    fetch,
    context: { origin: 'http://localhost:3000', fetch },
  };
}

test('read-only browser query preserves exact operator copy, uses existing session and never reads credentials or private payloads', async () => {
  const f = fixture();
  const result = await firstManualPublication(f.selection, f.context);
  expect(result.status).toBe('READY_FOR_OPERATOR_HANDOFF');
  expect(result.handoff.caption).toBe(f.handoff.caption);
  expect(result.handoff.finalCaption).toBe(f.handoff.finalCaption);
  expect(result.handoff.affiliateUrl).toBe(f.handoff.affiliateUrl);
  expect(result.publicationConfirmed).toBe(false);
  expect(result.publicationAuthorized).toBe(false);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
  expect(Object.isFrozen(result.handoff)).toBe(true);
  expect(await firstManualPublication(f.selection, f.context)).toEqual(result);
  for (const [url, options] of f.fetch.mock.calls) {
    expect(url).toMatch(
      /^http:\/\/localhost:3000\/publishing\/(packages\/[a-f0-9]{64}\/manual-(release-readiness|handoff)|manual-publications\?packageHash=[a-f0-9]{64})$/,
    );
    expect(options).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(options).not.toHaveProperty('headers');
    expect(options).not.toHaveProperty('body');
  }
});

test.each([
  'approval',
  'qc',
  'rights',
  'physicalEvidence',
  'integrity',
  'mediaIntegrity',
  'eligibility',
])(
  'no %s gate means BLOCKED_MANUAL_PUBLICATION and no handoff query',
  async (gate) => {
    const f = fixture();
    f.readiness.checks[gate] = 'UNKNOWN';
    const result = await firstManualPublication(f.selection, f.context);
    expect(result.status).toBe('BLOCKED_MANUAL_PUBLICATION');
    expect(result.handoff).toBeNull();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  },
);

test.each([
  'package',
  'account',
  'destination',
  'hash',
  'revision',
  'qc',
  'revoked',
  'missing',
  'pending',
])('rejects inconsistent handoff: %s', async (kind) => {
  const f = fixture();
  if (kind === 'package') f.handoff.packageHash = 'f'.repeat(64);
  if (kind === 'account')
    f.handoff.destination = { ...f.handoff.destination, account: '999999999' };
  if (kind === 'destination')
    f.handoff.destination = { ...f.handoff.destination, platform: 'facebook' };
  if (kind === 'hash') f.handoff.video.sha256 = 'f'.repeat(64);
  if (kind === 'revision') f.handoff.video.revision++;
  if (kind === 'qc') f.handoff.qualityControl.result = 'FAIL';
  if (kind === 'revoked') f.handoff.approval.revoked = true;
  if (kind === 'missing') f.handoff.approval.reviewHash = '';
  if (kind === 'pending')
    f.handoff.eligibility.pending = ['RIGHTS_REQUIRED'] as never[];
  expect((await firstManualPublication(f.selection, f.context)).status).toBe(
    'BLOCKED_MANUAL_PUBLICATION',
  );
});

test('refuses non-local origins, invalid selections, failed authentication and raw error details', async () => {
  const f = fixture();
  expect(
    (
      await firstManualPublication(f.selection, {
        ...f.context,
        origin: 'https://www.instagram.com',
      })
    ).status,
  ).toBe('BLOCKED_MANUAL_PUBLICATION');
  expect(
    (
      await firstManualPublication(
        { ...f.selection, token: 'secret' },
        f.context,
      )
    ).status,
  ).toBe('BLOCKED_MANUAL_PUBLICATION');
  expect(f.fetch).not.toHaveBeenCalled();
  f.fetch.mockImplementation(
    async () =>
      new Response(JSON.stringify({ message: 'PRIVATE_SENTINEL' }), {
        status: 401,
      }),
  );
  const result = await firstManualPublication(f.selection, f.context);
  expect(result.nextAction).toBe('OPEN_EXISTING_LOCAL_QC_SESSION');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

test('CLI emits a self-contained GET-only browser command without environment, credential or database input', async () => {
  const f = fixture();
  const args = [
    '--package-hash',
    f.selection.packageHash,
    '--platform',
    f.selection.platform,
    '--account',
    f.selection.account,
  ];
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(toolUrl), ...args],
    { encoding: 'utf8' },
  );
  for (const command of [output.trim(), browserCommand(f.selection)]) {
    const log = vi.fn();
    await runInNewContext(`(async () => { ${command} })()`, {
      console: { log },
      location: { origin: f.context.origin },
      fetch: f.fetch,
      URL,
      AbortSignal,
    });
    expect(JSON.parse(log.mock.calls[0][0]).status).toBe(
      'READY_FOR_OPERATOR_HANDOFF',
    );
  }
  expect(output).not.toMatch(
    /readFile|document\.cookie|localStorage|sessionStorage|process\.env|Authorization|uploadUri/,
  );
  expect(() =>
    execFileSync(
      process.execPath,
      [fileURLToPath(toolUrl), ...args, '--token', 'private'],
      { stdio: 'pipe' },
    ),
  ).toThrow();
});

test.each(['PUBLISHED', 'UNCONFIRMED'])(
  'an existing %s record never encourages a second publication',
  async (state) => {
    const f = fixture();
    f.fetch.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('/manual-publications?')
              ? [
                  {
                    packageHash: f.selection.packageHash,
                    publicationId: 'FICTITIOUS_TEST_ONLY_publication',
                    state,
                  },
                ]
              : url.endsWith('/effective')
                ? {
                    originalReceipt: {
                      publicationId: 'FICTITIOUS_TEST_ONLY_publication',
                      packageHash: f.selection.packageHash,
                    },
                    effectiveState: state,
                    confirmationOrigin:
                      state === 'PUBLISHED'
                        ? 'OPERATOR_ATTESTED'
                        : 'UNCONFIRMED',
                  }
                : f.readiness,
          ),
        ),
    );
    const result = await firstManualPublication(f.selection, f.context);
    expect(result.status).toBe('BLOCKED_MANUAL_PUBLICATION');
    expect(result.publicationRecord.state).toBe(state);
    expect(result.handoff).toBeNull();
    expect(f.fetch).toHaveBeenCalledTimes(state === 'UNCONFIRMED' ? 3 : 2);
  },
);
