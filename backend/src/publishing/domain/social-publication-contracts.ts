import {
  exact,
  publicText,
  hashValue,
} from './manual-distribution-contracts.js';
export function socialFail(code: any): never {
  throw Object.assign(new Error(code), { code });
}
export function accountId(value: any): any {
  if (typeof value !== 'string' || !/^\d{5,64}$/.test(value))
    socialFail('SOCIAL_DESTINATION_INVALID');
  return value;
}
export function validateSocialPrepare(value: any): any {
  exact(value, ['packageHash', 'accountId']);
  hashValue(value.packageHash, 'packageHash');
  accountId(value.accountId);
  return value;
}
export function instagramCaption(p: any): any {
  const caption: any = [p.caption, p.cta, p.disclosure, p.link]
    .map((v: any, i: any): any => publicText(v, `caption_${i}`, 5000))
    .join('\n\n');
  if (
    [...caption].length > 2200 ||
    (caption.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30 ||
    (caption.match(/@[\p{L}\p{N}_.]+/gu) || []).length > 20
  )
    socialFail('SOCIAL_CAPTION_INVALID');
  return caption;
}
// Signed URLs are transient capabilities: never include them in persisted state.
export function validateTransfer(value: any, hash: any, now: any): any {
  exact(value, ['url', 'expiresAt', 'contentHash']);
  let url: any;
  try {
    url = new URL(value.url);
  } catch {
    socialFail('SOCIAL_TRANSFER_INVALID');
  }
  const expires: any = Date.parse(value.expiresAt);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !url.hostname ||
    url.hash ||
    !Number.isFinite(expires) ||
    expires - Date.parse(now) < 3600000 ||
    value.contentHash !== hash
  )
    socialFail('SOCIAL_TRANSFER_INVALID');
  return value;
}
