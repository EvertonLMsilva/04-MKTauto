import {
  affiliateHash,
  rejectAffiliateDynamicPrice,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  instagramCaption,
  socialFail,
} from './social-publication-contracts.js';
export const CAPTION_POLICY = 'instagram-grounded-extraction/1.0.0';
const risky =
  /(cur[ae]|doen[cç]|dor(?:es)?|terap|circula[cç]|sa[uú]de|emagre|garant|resultado|milagr|melhor|reduz|alivia|previne|elimina|ins[oô]nia|s[oó] hoje|[uú]ltimas|esgot|promo[cç]|desconto|gr[aá]tis|100%)/iu;
const normalize = (s: string) =>
  s.normalize('NFKC').replace(/\s+/g, ' ').trim();
export function buildCaption(context: any, variant = 1) {
  if (
    context.qc?.result !== 'PASS' ||
    !context.render?.contentHash ||
    !context.script?.contentHash
  )
    socialFail('SOCIAL_CAPTION_CONTEXT_REQUIRED');
  const b = context.briefing;
  if (!b?.productName || !b.affiliateUrl || !b.cta || !b.disclosure)
    socialFail('SOCIAL_CAPTION_CONTEXT_REQUIRED');
  const safe = (s: string) => {
    try {
      rejectAffiliateDynamicPrice(s, 'caption');
      return !risky.test(s);
    } catch {
      return false;
    }
  };
  if (!safe(b.productName) || !safe(b.cta))
    socialFail('SOCIAL_CAPTION_UNGROUNDED');
  const evidence = new Set(
    b.evidence
      .filter((e: any) => e.kind === 'PRODUCT_SPECIFICATION')
      .map((e: any) => e.id),
  );
  const facts = b.attributes
    .filter(
      (a: any) => evidence.has(a.evidenceRef) && safe(a.name + ': ' + a.value),
    )
    .slice(0, 3);
  const hooks = [
    `Conheça ${b.productName}.`,
    `Veja os detalhes de ${b.productName}.`,
  ];
  const tags = b.productName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((x: string) => x.length > 3)
    .slice(0, 3)
    .map((x: string) => '#' + x.toLowerCase());
  const allowedLines = [
    'Publicidade • Link de afiliado.',
    ...hooks,
    ...facts.map((a: any) => `${a.name}: ${a.value}`),
    'Confira o produto no vídeo e consulte os detalhes no link.',
    ...tags,
  ];
  const text = [
    allowedLines[0],
    hooks[(variant - 1) % hooks.length],
    ...facts.map((a: any) => `${a.name}: ${a.value}`),
    allowedLines.at(-tags.length - 1),
    tags.join(' '),
  ]
    .filter(Boolean)
    .join('\n\n');
  const envelope = instagramCaption({
    caption: text,
    cta: b.cta,
    disclosure: b.disclosure,
    link: b.affiliateUrl,
  });
  return {
    text,
    envelope,
    allowedLines,
    policyVersion: CAPTION_POLICY,
    provider: 'local-extractive',
    model: null,
    inferencePerformed: false,
    source: 'EXISTING_SCRIPT_AND_VERIFIED_PRODUCT',
    evidenceRefs: facts.map((a: any) => a.evidenceRef),
    excludedAttributes: b.attributes
      .filter((a: any) => !facts.includes(a))
      .map((a: any) => a.name),
    contextHash: affiliateHash(context),
    cost: { status: 'UNKNOWN', amount: null, paidCalls: 0 },
  };
}
export function validateCaptionEdit(
  text: string,
  base: ReturnType<typeof buildCaption>,
) {
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    !text.startsWith('Publicidade')
  )
    socialFail('SOCIAL_CAPTION_UNGROUNDED');
  const lines = text.split(/\n+/).map(normalize).filter(Boolean);
  const allowed = new Set(base.allowedLines.map(normalize));
  if (
    lines.some(
      (l) => !allowed.has(l) && !l.split(' ').every((w) => allowed.has(w)),
    )
  )
    socialFail('SOCIAL_CAPTION_UNGROUNDED');
  return text.trim();
}
export function publicationScope(
  render: any,
  plan: any,
  audio: any,
  assets: any[],
) {
  const scope = {
    schemaVersion: 'instagram-publication-rights/1.0.0',
    mode: 'fake',
    platform: 'instagram',
    pipelineRunId: render.pipelineRunId,
    videoRenderId: render.videoRenderId,
    renderHash: render.contentHash,
    planHash: plan.contentHash,
    audioHash: audio.contentHash,
    assets: assets.map((a) => ({
      id: a.mediaAssetId,
      contentHash: a.contentHash,
      rightsHash: affiliateHash(a.rights),
    })),
  };
  return { ...scope, scopeHash: affiliateHash(scope) };
}
export function publicationGrant(scope: any, input: any, actorId: string) {
  if (
    Object.keys(input ?? {})
      .sort()
      .join(',') !==
      'acceptsCommercialPublication,scopeHash,sourceRef,statement' ||
    scope.mode !== 'fake' ||
    input.scopeHash !== scope.scopeHash ||
    input.acceptsCommercialPublication !== true ||
    typeof input.sourceRef !== 'string' ||
    input.sourceRef.trim().length < 3 ||
    input.sourceRef.length > 1000 ||
    typeof input.statement !== 'string' ||
    input.statement.trim().length < 15 ||
    input.statement.length > 2000 ||
    !/^[a-z0-9][a-z0-9_:-]{2,99}$/.test(actorId)
  )
    socialFail('SOCIAL_PUBLICATION_CONSENT_REQUIRED');
  const body = {
    scope,
    actorId,
    sourceRef: input.sourceRef.trim(),
    statement: input.statement.trim(),
    acceptsCommercialPublication: true,
    createdAt: new Date().toISOString(),
  };
  return { ...body, contentHash: affiliateHash(body) };
}
export function validPublicationGrant(value: any, scope: any) {
  if (!value) return false;
  const { contentHash, ...body } = value;
  return (
    affiliateHash(body) === contentHash &&
    body.scope?.scopeHash === scope.scopeHash &&
    affiliateHash(body.scope) === affiliateHash(scope) &&
    body.acceptsCommercialPublication === true &&
    typeof body.actorId === 'string' &&
    !!body.sourceRef &&
    !!body.statement
  );
}
