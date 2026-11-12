import { pathToFileURL } from 'node:url';

// This function is self-contained so the CLI can emit it for an existing local
// QC browser session. Cookies are managed by the browser, never read by the tool.
// Injected fetch/origin are test ports; CLI accepts no transport or secret input.
export async function firstManualPublication(selection, context = {}) {
  const freeze = (v) => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  const fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const text = (v, max = 6000) =>
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.length <= max &&
    !/(?:bearer\s+\S+|sk-[a-z0-9_-]{3,}|[?&](?:token|signature|credential|key)=)/i.test(
      v,
    ) &&
    v.split('').every((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    });
  const codes = (values) =>
    Array.isArray(values)
      ? values
          .filter(
            (v) => typeof v === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(v),
          )
          .slice(0, 20)
      : [];
  let readiness = null;
  const base = { publicationAuthorized: false, publicationConfirmed: false };
  try {
    if (
      !selection ||
      Object.keys(selection).sort().join(',') !==
        'account,packageHash,platform' ||
      !hash(selection.packageHash) ||
      !['instagram', 'facebook'].includes(selection.platform) ||
      typeof selection.account !== 'string' ||
      !/^[1-9]\d{4,63}$/.test(selection.account)
    )
      fail('INVALID_MANUAL_SELECTION');
    let origin;
    try {
      origin = new URL(context.origin ?? globalThis.location?.origin);
    } catch {
      fail('LOCAL_QC_BROWSER_REQUIRED');
    }
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
      origin.username ||
      origin.password ||
      origin.href !== origin.origin + '/'
    )
      fail('LOCAL_QC_BROWSER_REQUIRED');
    const fetcher = context.fetch ?? globalThis.fetch.bind(globalThis);
    const get = async (path) => {
      const response = await fetcher(origin.origin + path, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401 || response.status === 403)
        fail('LOCAL_QC_SESSION_REQUIRED');
      if (!response.ok) fail('MANUAL_QUERY_FAILED');
      return response.json();
    };
    const path = '/publishing/packages/' + selection.packageHash;
    const r = await get(path + '/manual-release-readiness');
    if (
      !r ||
      r.schemaVersion !== 'manual-release-readiness/1.0.0' ||
      r.packageHash !== selection.packageHash ||
      r.destination?.platform !== selection.platform ||
      r.destination?.account !== selection.account
    )
      fail('MANUAL_SCOPE_MISMATCH');
    readiness = {
      status: codes([r.status])[0] ?? 'UNKNOWN',
      blockerCodes: codes(r.blockerCodes),
    };
    if (
      r.status !== 'READY_FOR_OPERATOR_HANDOFF' ||
      r.ready !== true ||
      r.publicationConfirmed !== false ||
      !Array.isArray(r.blockerCodes) ||
      r.blockerCodes.length !== 0 ||
      [
        'integrity',
        'mediaIntegrity',
        'qc',
        'approval',
        'rights',
        'physicalEvidence',
        'eligibility',
      ].some((k) => r.checks?.[k] !== 'PASS')
    )
      fail('MANUAL_GATES_REQUIRED');
    const records = await get(
      '/publishing/manual-publications?packageHash=' + selection.packageHash,
    );
    if (!Array.isArray(records)) fail('MANUAL_RECORD_QUERY_INVALID');
    if (records.length) {
      const existing = records[0];
      if (
        existing.packageHash !== selection.packageHash ||
        !text(existing.publicationId, 250) ||
        !['PUBLISHED', 'UNCONFIRMED'].includes(existing.state)
      )
        fail('MANUAL_RECORD_QUERY_INVALID');
      let effectiveState = existing.state;
      let confirmationOrigin =
        existing.state === 'PUBLISHED' ? 'OPERATOR_ATTESTED' : 'UNCONFIRMED';
      if (existing.state === 'UNCONFIRMED') {
        const effective = await get(
          '/publishing/manual-publications/' +
            encodeURIComponent(existing.publicationId) +
            '/effective',
        );
        if (
          effective?.originalReceipt?.publicationId !==
            existing.publicationId ||
          effective.originalReceipt.packageHash !== selection.packageHash ||
          !['PUBLISHED', 'UNCONFIRMED'].includes(effective.effectiveState) ||
          !['OPERATOR_ATTESTED', 'UNCONFIRMED'].includes(
            effective.confirmationOrigin,
          ) ||
          (effective.effectiveState === 'PUBLISHED' &&
            effective.confirmationOrigin !== 'OPERATOR_ATTESTED')
        )
          fail('MANUAL_RECORD_QUERY_INVALID');
        effectiveState = effective.effectiveState;
        confirmationOrigin = effective.confirmationOrigin;
      }
      return freeze({
        ...base,
        status: 'BLOCKED_MANUAL_PUBLICATION',
        readiness,
        handoff: null,
        blockers: ['MANUAL_PUBLICATION_ALREADY_RECORDED'],
        publicationRecord: {
          publicationId: existing.publicationId,
          state: existing.state,
          effectiveState,
          confirmationOrigin,
        },
        nextAction:
          effectiveState === 'UNCONFIRMED'
            ? 'OBSERVE_EXISTING_PUBLICATION_DO_NOT_REPOST'
            : 'CONSULT_EXISTING_PUBLICATION_AND_RESULTS',
      });
    }
    const h = await get(path + '/manual-handoff');
    if (
      !h ||
      h.schemaVersion !== 'manual-release-handoff/1.0.0' ||
      h.packageHash !== selection.packageHash ||
      h.destination?.platform !== selection.platform ||
      h.destination?.account !== selection.account ||
      !text(h.video?.videoRenderId, 250) ||
      !hash(h.video.sha256) ||
      h.video.mediaReference !== 'render:sha256_' + h.video.sha256 ||
      !Number.isSafeInteger(h.video.revision) ||
      h.video.revision < 1 ||
      h.video.videoRenderId !== r.identity?.videoRenderId ||
      h.video.sha256 !== r.identity?.videoSha256 ||
      h.video.revision !== r.identity?.videoRenderRevision ||
      h.qualityControl?.result !== 'PASS' ||
      h.qualityControl.reportId !== r.identity?.qcReportId ||
      !hash(h.qualityControl.contentHash) ||
      h.approval?.decision !== 'APPROVED' ||
      h.approval.revoked !== false ||
      !hash(h.approval.reviewHash) ||
      !text(h.approval.decisionId, 250) ||
      h.eligibility?.status !== 'PASS' ||
      !Array.isArray(h.eligibility.pending) ||
      h.eligibility.pending.length ||
      h.publicationStatus !== 'NOT_CONFIRMED_BY_HANDOFF'
    )
      fail('MANUAL_HANDOFF_MISMATCH');
    for (const k of [
      'caption',
      'cta',
      'disclosure',
      'affiliateUrl',
      'finalCaption',
    ])
      if (!text(h[k])) fail('MANUAL_COPY_INVALID');
    let link;
    try {
      link = new URL(h.affiliateUrl);
    } catch {
      fail('MANUAL_COPY_INVALID');
    }
    if (link.protocol !== 'https:' || link.username || link.password)
      fail('MANUAL_COPY_INVALID');
    return freeze({
      ...base,
      status: 'READY_FOR_OPERATOR_HANDOFF',
      readiness,
      blockers: [],
      publicationRecord: null,
      handoff: {
        packageHash: h.packageHash,
        destination: {
          platform: h.destination.platform,
          account: h.destination.account,
        },
        video: {
          videoRenderId: h.video.videoRenderId,
          revision: h.video.revision,
          sha256: h.video.sha256,
          mediaReference: h.video.mediaReference,
        },
        caption: h.caption,
        cta: h.cta,
        disclosure: h.disclosure,
        affiliateUrl: h.affiliateUrl,
        finalCaption: h.finalCaption,
        qualityControl: {
          reportId: h.qualityControl.reportId,
          contentHash: h.qualityControl.contentHash,
          result: 'PASS',
        },
        approval: {
          decision: 'APPROVED',
          reviewHash: h.approval.reviewHash,
          decisionId: h.approval.decisionId,
          revoked: false,
        },
      },
      nextAction:
        'OPERATOR_VERIFY_EXACT_FILE_AND_AUTHORIZATION_BEFORE_MANUAL_PUBLICATION',
    });
  } catch (error) {
    const allowed = [
      'INVALID_MANUAL_SELECTION',
      'LOCAL_QC_BROWSER_REQUIRED',
      'LOCAL_QC_SESSION_REQUIRED',
      'MANUAL_QUERY_FAILED',
      'MANUAL_SCOPE_MISMATCH',
      'MANUAL_GATES_REQUIRED',
      'MANUAL_RECORD_QUERY_INVALID',
      'MANUAL_HANDOFF_MISMATCH',
      'MANUAL_COPY_INVALID',
    ];
    const code = allowed.includes(error?.code)
      ? error.code
      : 'MANUAL_QUERY_UNAVAILABLE';
    return freeze({
      ...base,
      status: 'BLOCKED_MANUAL_PUBLICATION',
      readiness,
      handoff: null,
      publicationRecord: null,
      blockers: readiness?.blockerCodes.length
        ? readiness.blockerCodes
        : [code],
      nextAction:
        code === 'LOCAL_QC_SESSION_REQUIRED' ||
        code === 'LOCAL_QC_BROWSER_REQUIRED'
          ? 'OPEN_EXISTING_LOCAL_QC_SESSION'
          : 'REVIEW_EXACT_PACKAGE_AND_BLOCKERS',
    });
  }
}

export function browserCommand(selection) {
  if (
    !selection ||
    Object.keys(selection).sort().join(',') !==
      'account,packageHash,platform' ||
    !/^[a-f0-9]{64}$/.test(selection.packageHash) ||
    !['instagram', 'facebook'].includes(selection.platform) ||
    !/^[1-9]\d{4,63}$/.test(selection.account)
  )
    throw Error('INVALID_MANUAL_SELECTION');
  return `console.log(JSON.stringify(await (${firstManualPublication.toString()})(${JSON.stringify(selection)}), null, 2));`;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
      console.log(
        'node scripts/ops-local/first-manual-publication.mjs --package-hash <sha256> --platform <instagram|facebook> --account <id>\nExecute a consulta emitida na sessão local de QC já autenticada. Somente GET; sem credenciais, upload ou publicação.',
      );
    } else {
      if (args.length !== 6) throw Error('INVALID_MANUAL_SELECTION');
      const values = {};
      for (let i = 0; i < args.length; i += 2) {
        const key = {
          '--package-hash': 'packageHash',
          '--platform': 'platform',
          '--account': 'account',
        }[args[i]];
        if (!key || Object.hasOwn(values, key))
          throw Error('INVALID_MANUAL_SELECTION');
        values[key] = args[i + 1];
      }
      console.log(browserCommand(values));
    }
  } catch {
    console.error(
      'BLOCKED_MANUAL_PUBLICATION: use --help; somente pacote, rede e conta são aceitos.',
    );
    process.exitCode = 1;
  }
}
