import * as ts from './affiliate-contracts.js';
import {
  product,
  campaign,
  legacyDomain as js,
} from '../../../../test/support/affiliate-fixture.js';

function outcome(run: () => unknown) {
  try {
    return { result: run() };
  } catch (error) {
    const e = error as {
      name: string;
      code: string;
      path: string;
      message: string;
    };
    return { name: e.name, code: e.code, path: e.path, message: e.message };
  }
}
describe('Affiliate domain JS × TS', () => {
  const products: unknown[] = [
    product(),
    null,
    [],
    {},
    product({ extra: true }),
    product({ schemaVersion: 'wrong' }),
    product({ revision: 0 }),
    product({ revision: 1.5 }),
    product({ productId: '../bad' }),
    product({ name: ' ' }),
    product({ brand: null }),
    product({ attributes: [] }),
    product({ media: [] }),
    product({ evidence: [] }),
    product({ name: 'bearer private' }),
  ];
  for (const status of ['KNOWN', 'DECLARED_UNBRANDED', 'NOT_PROVIDED'])
    products.push(
      product({
        schemaVersion: 'affiliate-product/2.0.0',
        brand: {
          status,
          name: status === 'KNOWN' ? 'Marca' : null,
          evidenceRef: 'ev_spec',
        },
      }),
    );
  for (const brand of [
    null,
    'brand',
    {},
    { status: 'UNKNOWN', name: null, evidenceRef: 'ev_spec' },
    { status: 'KNOWN', name: null, evidenceRef: 'ev_spec' },
    { status: 'NOT_PROVIDED', name: 'Loja', evidenceRef: 'ev_spec' },
    { status: 'NOT_PROVIDED', name: null, evidenceRef: 'ev_rights' },
    { status: 'NOT_PROVIDED', name: null, evidenceRef: 'missing' },
  ])
    products.push(product({ schemaVersion: 'affiliate-product/2.0.0', brand }));
  for (const attributes of [
    [{ name: 'price', value: '99', evidenceRef: 'ev_spec' }],
    [{ name: 'material', value: 'R$ 10', evidenceRef: 'ev_spec' }],
    [{ name: 'material', value: 'metal', evidenceRef: 'ev_rights' }],
  ])
    products.push(product({ attributes }));
  const p = product();
  const evidence = p.evidence as Record<string, unknown>[];
  for (const change of [
    { recordedAt: 'yesterday' },
    { kind: 'OTHER' },
    { sourceRef: '' },
    { extra: true },
  ])
    products.push(
      product({ evidence: [{ ...evidence[0], ...change }, evidence[1]] }),
    );
  products.push(
    product({ evidence: [...evidence, evidence[0]] }),
    product({
      attributes: [
        ...(p.attributes as unknown[]),
        ...(p.attributes as unknown[]),
      ],
    }),
    product({ media: [...(p.media as unknown[]), ...(p.media as unknown[])] }),
  );
  it.each(products.map((value) => [value]))(
    'preserves product result/first error %#',
    (value) => {
      expect(outcome(() => ts.validateAffiliateProduct(value))).toEqual(
        outcome(() => js.validateAffiliateProduct(value)),
      );
    },
  );
  it.each(
    [
      campaign(),
      null,
      {},
      campaign({ affiliateUrl: 'http://example.com' }),
      campaign({ affiliateUrl: 'https://user:pass@example.com' }),
      campaign({ affiliateUrl: 'HTTPS://example.com' }),
      campaign({ cta: 'R$ 20' }),
      campaign({ disclosure: ' ' }),
      campaign({ cta: 'x'.repeat(501) }),
      campaign({ productRevision: 0 }),
      campaign({ unknown: true }),
    ].map((value) => [value]),
  )('preserves campaign result/first error %#', (value) => {
    expect(outcome(() => ts.validateAffiliateCampaign(value))).toEqual(
      outcome(() => js.validateAffiliateCampaign(value)),
    );
  });
  it('preserves canonical hash, exact URL, briefing and deep immutability', () => {
    const a = ts.materializeAffiliateBriefing(
      'brief_001',
      campaign(),
      product(),
    );
    const b = js.materializeAffiliateBriefing(
      'brief_001',
      campaign(),
      product(),
    );
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.affiliateUrl).toBe(campaign().affiliateUrl);
    expect(Object.isFrozen(a.attributes[0])).toBe(true);
    expect(
      Object.isFrozen(ts.validateAffiliateProduct(product()).evidence[0]),
    ).toBe(true);
    for (const value of [
      a,
      { ...a, cta: 'changed' },
      { ...a, contentHash: 'f'.repeat(64) },
      { ...a, mediaRefs: [] },
      { ...a, unknown: true },
    ])
      expect(outcome(() => ts.validateAffiliateBriefing(value))).toEqual(
        outcome(() => js.validateAffiliateBriefing(value)),
      );
    expect(
      outcome(() =>
        ts.materializeAffiliateBriefing(
          'brief_001',
          campaign({ productRevision: 2 }),
          product(),
        ),
      ),
    ).toEqual(
      outcome(() =>
        js.materializeAffiliateBriefing(
          'brief_001',
          campaign({ productRevision: 2 }),
          product(),
        ),
      ),
    );
    for (const value of [
      { b: 2, a: 1 },
      { a: [2, 1], nested: { z: 1, a: null }, contentHash: 'ignored' },
    ])
      expect(ts.affiliateHash(value)).toBe(js.affiliateHash(value));
  });
});
