import { affiliateHash } from './affiliate-contracts.js';
export interface RawQualificationRow {
  feedId: string;
  rowNumber: number;
  value: Record<string, string>;
  error?: string;
}

export const FEED_QUALIFICATION_POLICY =
  'affiliate-feed-prequalification/1.0.0';
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// These are source facts and missing gates, not Discovery VERIFIED evidence,
// a commercial ranking or authorization to register a product/offer.
export function qualifyFeedRows(rows: RawQualificationRow[]) {
  const groups = new Map<string, RawQualificationRow[]>();
  for (const row of rows) {
    const id = row.value.externalId?.trim();
    if (id && /^[1-9]\d{0,39}$/.test(id)) {
      const group = groups.get(id) ?? [];
      group.push(row);
      groups.set(id, group);
    }
  }
  const signature = (r: RawQualificationRow) =>
    affiliateHash(
      Object.fromEntries(
        [
          'name',
          'productUrl',
          'historicalPrice',
          'salePrice',
          'reportedAffiliateUrl',
        ].map((k) => [k, r.value[k]?.trim() ?? '']),
      ),
    );
  const conflicts = new Set(
    [...groups]
      .filter(([, g]) => new Set(g.map(signature)).size > 1)
      .map(([id]) => id),
  );
  const canonical = new Map(
    [...groups].map(([id, g]) => [
      id,
      [...g].sort(
        (a, b) => compare(a.feedId, b.feedId) || a.rowNumber - b.rowNumber,
      )[0],
    ]),
  );
  return rows
    .map((row) => {
      const v = row.value;
      const id = v.externalId?.trim() ?? '';
      const name = v.name?.trim() ?? '';
      const reasons = [
        'LOCAL_IMAGE_REQUIRED',
        'MEDIA_RIGHTS_REQUIRED',
        'AFFILIATE_ASSOCIATION_UNPROVEN',
        'CURRENCY_UNPROVEN',
        'CURRENT_PRICE_UNPROVEN',
        'AVAILABILITY_UNPROVEN',
        'COMMISSION_UNPROVEN',
        'FEED_PROVENANCE_UNCONFIRMED',
      ];
      let incomplete = false;
      const invalid = (code: string) => {
        reasons.push(code);
        incomplete = true;
      };
      if (row.error) invalid(row.error);
      if (!/^[1-9]\d{0,39}$/.test(id)) invalid('PRODUCT_ID_INVALID');
      if (!name) invalid('NAME_REQUIRED');
      if (name.includes('\uFFFD')) invalid('TEXT_CORRUPTED');
      try {
        const url = new URL(v.productUrl);
        const m = /^\/product\/([1-9]\d*)\/([1-9]\d*)$/.exec(url.pathname);
        if (
          url.protocol !== 'https:' ||
          !['shopee.com.br', 'www.shopee.com.br'].includes(url.hostname) ||
          url.username ||
          url.password ||
          url.port ||
          !m ||
          m[2] !== id
        )
          invalid('PRODUCT_LINK_INVALID');
      } catch {
        invalid('PRODUCT_LINK_INVALID');
      }
      const price = v.historicalPrice?.trim() ?? '';
      const validPrice = (value: string) =>
        /^(?:0|[1-9]\d{0,39})(?:\.\d{1,18})?$/.test(value) &&
        !/^0(?:\.0+)?$/.test(value);
      if (!price) reasons.push('HISTORICAL_PRICE_NOT_REPORTED');
      else if (!validPrice(price)) invalid('HISTORICAL_PRICE_INVALID');
      const sale = v.salePrice?.trim() ?? '';
      if (sale && !validPrice(sale)) invalid('HISTORICAL_SALE_PRICE_INVALID');
      if (v.attributes?.trim()) {
        try {
          const attributes = JSON.parse(v.attributes);
          if (
            !Array.isArray(attributes) ||
            attributes.length > 200 ||
            attributes.some(
              (a) =>
                !a ||
                typeof a !== 'object' ||
                !/^\d+$/.test(String(a.attr_id)) ||
                typeof a.formatted_value !== 'string' ||
                !a.formatted_value.trim() ||
                a.formatted_value.includes('\uFFFD'),
            )
          )
            invalid('ATTRIBUTES_INVALID');
        } catch {
          invalid('ATTRIBUTES_INVALID');
        }
      } else reasons.push('ATTRIBUTES_NOT_REPORTED');
      if (conflicts.has(id)) invalid('DUPLICATE_DATA_CONFLICT');
      const first = canonical.get(id);
      const duplicate = !!first && first !== row;
      if (duplicate) reasons.push('DUPLICATE_PRODUCT');
      return {
        externalProductId: id || null,
        name: name || null,
        classification: incomplete
          ? 'INCOMPLETE_DATA'
          : duplicate
            ? 'DUPLICATE'
            : 'PRE_CANDIDATE',
        dataSufficientForAnalysis: !incomplete,
        source: { feedId: row.feedId, rowNumber: row.rowNumber },
        duplicateOf: duplicate
          ? { feedId: first!.feedId, rowNumber: first!.rowNumber }
          : null,
        productUrl: v.productUrl || null,
        reportedAffiliateUrl: v.reportedAffiliateUrl || null,
        category: v.category || null,
        subcategory: v.subcategory || null,
        historicalPrice: {
          amount: validPrice(price) ? price : null,
          saleAmount: validPrice(sale) ? sale : null,
          currency: null,
          current: false,
        },
        reportedImageUrl: v.imageUrl || null,
        catalogEligible: false,
        nextGate: 'COMPLETE_AND_VALIDATE_ONBOARDING_EVIDENCE',
        reasons,
      };
    })
    .sort(
      (a, b) =>
        compare(a.externalProductId ?? '', b.externalProductId ?? '') ||
        compare(a.source.feedId, b.source.feedId) ||
        a.source.rowNumber - b.source.rowNumber,
    );
}
