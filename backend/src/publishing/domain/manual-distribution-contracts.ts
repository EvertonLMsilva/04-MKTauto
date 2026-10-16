import {
  affiliateHash,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
export function distributionFail(code: any, field: any = 'input'): any {
  throw Object.assign(new Error(`${code}: ${field}`), { code, field });
}
export function exact(value: any, fields: any): any {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((k: any): any => !Object.hasOwn(value, k))
  )
    distributionFail('DISTRIBUTION_INVALID_CONTRACT');
}
export function publicText(value: any, field: any, max: any = 2000): any {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /(?:bearer\s+\S+|sk-[a-z0-9_-]{3,}|[?&](?:token|signature|credential|key)=|(?:^|\s)[a-z]:[\\/]|(?:^|[\\/])users[\\/])/i.test(
      value,
    )
  )
    distributionFail('DISTRIBUTION_INVALID_TEXT', field);
  return value;
}
export function hashValue(v: any, field: any): any {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
    distributionFail('DISTRIBUTION_INVALID_HASH', field);
  return v;
}
export function timestamp(v: any, field: any): any {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      v,
    ) ||
    !Number.isFinite(Date.parse(v))
  )
    distributionFail('DISTRIBUTION_INVALID_TIMESTAMP', field);
  return v;
}
export function https(v: any, field: any): any {
  publicText(v, field);
  let u: any;
  try {
    u = new URL(v);
  } catch {
    distributionFail('DISTRIBUTION_INVALID_URL', field);
  }
  if (u.protocol !== 'https:' || u.username || u.password)
    distributionFail('DISTRIBUTION_INVALID_URL', field);
  return v;
}
export function seal(value: any): any {
  return immutable({ ...value, contentHash: affiliateHash(value) });
}
export function validatePrepare(v: any): any {
  exact(v, [
    'campaignId',
    'campaignRevision',
    'videoRenderId',
    'qualityControlReportId',
    'platform',
    'account',
    'caption',
  ]);
  if (
    !['instagram', 'facebook', 'threads', 'tiktok', 'youtube'].includes(
      v.platform,
    )
  )
    distributionFail('DISTRIBUTION_PLATFORM_INVALID');
  publicText(v.account, 'account', 200);
  publicText(v.caption, 'caption', 5000);
  return v;
}
export function validatePublication(v: any): any {
  exact(v, [
    'packageHash',
    'actor',
    'publishedAt',
    'externalId',
    'externalUrl',
    'evidenceReference',
    'state',
  ]);
  hashValue(v.packageHash, 'packageHash');
  publicText(v.actor, 'actor', 100);
  timestamp(v.publishedAt, 'publishedAt');
  publicText(v.evidenceReference, 'evidenceReference');
  if (v.externalId !== null) publicText(v.externalId, 'externalId', 200);
  if (v.externalUrl !== null) https(v.externalUrl, 'externalUrl');
  if (!['PUBLISHED', 'UNCONFIRMED'].includes(v.state))
    distributionFail('DISTRIBUTION_STATE_INVALID');
  return v;
}
export function validateResults(v: any): any {
  exact(v, [
    'publicationId',
    'periodStart',
    'periodEnd',
    'sourceReference',
    'attribution',
    'clicks',
    'sales',
    'revenue',
    'commissions',
  ]);
  publicText(v.publicationId, 'publicationId');
  timestamp(v.periodStart, 'periodStart');
  timestamp(v.periodEnd, 'periodEnd');
  if (Date.parse(v.periodStart) >= Date.parse(v.periodEnd))
    distributionFail('DISTRIBUTION_PERIOD_INVALID');
  publicText(v.sourceReference, 'sourceReference');
  if (
    !['DIRECT_PUBLICATION', 'CAMPAIGN_REPORTED', 'UNATTRIBUTED'].includes(
      v.attribution,
    )
  )
    distributionFail('DISTRIBUTION_ATTRIBUTION_INVALID');
  for (const field of ['clicks', 'sales', 'revenue', 'commissions']) {
    const item: any = v[field];
    if (item?.status === 'UNKNOWN') {
      exact(item, ['status', 'reason']);
      publicText(item.reason, `${field}.reason`);
      continue;
    }
    if (item?.status !== 'KNOWN')
      distributionFail('DISTRIBUTION_METRIC_INVALID', field);
    if (['clicks', 'sales'].includes(field)) {
      exact(item, ['status', 'value']);
      if (!Number.isSafeInteger(item.value) || item.value < 0)
        distributionFail('DISTRIBUTION_METRIC_INVALID', field);
    } else {
      exact(item, ['status', 'amount', 'currency']);
      if (
        typeof item.amount !== 'string' ||
        !/^(?:0|[1-9]\d{0,39})(?:\.\d{1,18})?$/.test(item.amount) ||
        typeof item.currency !== 'string' ||
        !/^[A-Z]{3}$/.test(item.currency)
      )
        distributionFail('DISTRIBUTION_MONEY_INVALID', field);
    }
  }
  return v;
}
