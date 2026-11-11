import { ShopeeCatalogService } from './shopee-catalog.service.js';
import { AffiliateService } from './affiliate.service.js';
import { FakeShopeeAffiliate } from '../infrastructure/shopee-affiliate.provider.js';
import { validateAffiliateProduct } from '../domain/affiliate-contracts.js';

const product = () => ({
  schemaVersion: 'affiliate-product/2.0.0',
  productId: 'prod_001',
  revision: 1,
  name: 'Produto autorizado',
  brand: { status: 'KNOWN', name: 'Marca', evidenceRef: 'ev_spec' },
  attributes: [{ name: 'material', value: 'Madeira', evidenceRef: 'ev_spec' }],
  media: [{ mediaRef: 'authorized-image', evidenceRef: 'ev_rights' }],
  evidence: [
    {
      id: 'ev_spec',
      kind: 'PRODUCT_SPECIFICATION',
      sourceRef: 'manual',
      recordedAt: '2026-10-11T12:00:00Z',
    },
    {
      id: 'ev_rights',
      kind: 'MEDIA_USAGE_RIGHT',
      sourceRef: 'permission',
      recordedAt: '2026-10-11T12:00:00Z',
    },
  ],
});

describe('explicit offline Shopee selection', () => {
  const fake = new FakeShopeeAffiliate();
  const catalog = new ShopeeCatalogService(fake);
  const persistence = {
    open: vi.fn(() => {
      throw new Error('SQLite forbidden');
    }),
  };
  const projects = { get: vi.fn() };
  const affiliate = new AffiliateService(
    persistence as never,
    projects as never,
  );

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requires explicit selection and keeps discovery NOT_EVALUATED', async () => {
    const [candidate] = await catalog.listCandidates();
    expect(candidate.eligibility).toBe('NOT_EVALUATED');
    expect(
      affiliate.evaluateShopeeSelection(candidate as never, {}),
    ).toMatchObject({
      eligibility: 'BLOCKED',
      pending: [{ code: 'SHOPEE_SELECTION_REQUIRED', field: 'selection' }],
      validatedProduct: null,
    });
    const selection = catalog.selectCandidate(candidate, true);
    expect(selection).toMatchObject({
      state: 'SELECTED',
      eligibility: 'NOT_EVALUATED',
      candidate,
    });
    expect(() => catalog.selectCandidate(candidate, false as never)).toThrow();
    expect(candidate.eligibility).toBe('NOT_EVALUATED');
  });

  it('reports all missing fields deterministically without using Shopee data as evidence', async () => {
    const selection = catalog.selectCandidate(
      (await catalog.listCandidates())[0],
      true,
    );
    const result = affiliate.evaluateShopeeSelection(selection, {});
    expect(result.eligibility).toBe('BLOCKED');
    expect(result.validatedProduct).toBeNull();
    expect(result.pending.map((p) => p.field)).toEqual(
      expect.arrayContaining([
        'product.schemaVersion',
        'product.productId',
        'product.revision',
        'product.name',
        'product.brand',
        'product.attributes',
        'product.media',
        'product.evidence',
      ]),
    );
    expect(affiliate.evaluateShopeeSelection(selection, {})).toEqual(result);
  });

  it('validates explicit evidence and media verification; never registers or generates links', async () => {
    const selection = catalog.selectCandidate(
      (await catalog.listCandidates())[0],
      true,
    );
    const query = vi.spyOn(fake, 'queryOffers');
    const link = vi.spyOn(fake, 'generateLink');
    const register = vi.spyOn(affiliate, 'registerProduct');
    const campaign = vi.spyOn(affiliate, 'registerCampaign');
    const briefing = vi.spyOn(affiliate, 'createBriefing');
    const fetch = vi.fn(() => {
      throw new Error('network forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    const input = product();
    expect(
      affiliate.evaluateShopeeSelection(selection, input).pending,
    ).toContainEqual({
      code: 'SHOPEE_MEDIA_NOT_VERIFIED',
      field: 'media.0.mediaRef',
    });
    const result = affiliate.evaluateShopeeSelection(selection, input, [
      'authorized-image',
    ]);
    expect(result).toMatchObject({
      eligibility: 'ELIGIBLE',
      pending: [],
      validatedProduct: validateAffiliateProduct(input),
    });
    expect(Object.isFrozen(result.validatedProduct)).toBe(true);
    expect(
      affiliate.evaluateShopeeSelection(selection, input, ['authorized-image']),
    ).toEqual(result);
    expect(input).toEqual(product());
    for (const spy of [
      query,
      link,
      register,
      campaign,
      briefing,
      fetch,
      persistence.open,
      projects.get,
    ])
      expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    { name: '', revision: 0 },
    { evidence: [] },
    { attributes: [{ name: 'price', value: 'R$ 10', evidenceRef: 'ev_spec' }] },
    { attributes: [{ name: 'preço', value: 'dez', evidenceRef: 'ev_spec' }] },
    {
      attributes: [
        { name: 'valor monetário', value: 'dez', evidenceRef: 'ev_spec' },
      ],
    },
    { media: [{ mediaRef: 'image', evidenceRef: 'ev_spec' }] },
    { brand: { status: 'KNOWN', name: 'Marca', evidenceRef: 'missing' } },
  ])(
    'blocks invalid product data using the real product rules: %j',
    async (overrides) => {
      const selection = catalog.selectCandidate(
        (await catalog.listCandidates())[0],
        true,
      );
      const input = { ...product(), ...overrides };
      expect(() => validateAffiliateProduct(input)).toThrow();
      const result = affiliate.evaluateShopeeSelection(selection, input, [
        'image',
        'authorized-image',
      ]);
      expect(result.eligibility).toBe('BLOCKED');
      expect(result.pending.length).toBeGreaterThan(0);
      expect(result.validatedProduct).toBeNull();
    },
  );

  it('collects independent invalid fields, references and provenance in a stable order', async () => {
    const selection = catalog.selectCandidate(
      (await catalog.listCandidates())[0],
      true,
    );
    const input = {
      ...product(),
      name: '',
      revision: 0,
      evidence: [
        { id: 'bad', kind: 'UNKNOWN', sourceRef: '', recordedAt: 'invalid' },
      ],
      attributes: [{ name: '', value: '', evidenceRef: 'absent' }],
      media: [{ mediaRef: 'image', evidenceRef: 'absent' }],
    };
    const result = affiliate.evaluateShopeeSelection(selection, input);
    expect(result.pending).toEqual(
      expect.arrayContaining([
        { code: 'INVALID_AFFILIATE_REVISION', field: 'revision' },
        { code: 'INVALID_AFFILIATE_TEXT', field: 'name' },
        { code: 'INVALID_AFFILIATE_EVIDENCE_KIND', field: 'evidence.0.kind' },
        { code: 'INVALID_AFFILIATE_TEXT', field: 'evidence.0.sourceRef' },
        { code: 'INVALID_AFFILIATE_TIMESTAMP', field: 'evidence.0.recordedAt' },
        {
          code: 'AFFILIATE_EVIDENCE_MISSING',
          field: 'attributes.0.evidenceRef',
        },
        { code: 'AFFILIATE_EVIDENCE_MISSING', field: 'media.0.evidenceRef' },
        { code: 'SHOPEE_MEDIA_NOT_VERIFIED', field: 'media.0.mediaRef' },
      ]),
    );
    expect(affiliate.evaluateShopeeSelection(selection, input)).toEqual(result);
  });

  it('requires a separate confirmed registration and revalidates before delegating', async () => {
    const selection = catalog.selectCandidate(
      (await catalog.listCandidates())[0],
      true,
    );
    const register = vi
      .spyOn(affiliate, 'registerProduct')
      .mockResolvedValue(product() as never);
    await expect(
      affiliate.registerShopeeSelection(
        selection,
        product(),
        ['authorized-image'],
        'register_001',
        false as never,
      ),
    ).rejects.toThrow('SHOPEE_REGISTRATION_CONFIRMATION_REQUIRED');
    await expect(
      affiliate.registerShopeeSelection(
        selection,
        {},
        [],
        'register_001',
        true,
      ),
    ).rejects.toThrow('SHOPEE_SELECTION_BLOCKED');
    expect(register).not.toHaveBeenCalled();
    await affiliate.registerShopeeSelection(
      selection,
      product(),
      ['authorized-image'],
      'register_001',
      true,
    );
    expect(register).toHaveBeenCalledExactlyOnceWith({
      idempotencyKey: 'register_001',
      product: validateAffiliateProduct(product()),
    });
    expect(persistence.open).not.toHaveBeenCalled();
  });

  it.each([{ toString: 0 }, null, 123, []])(
    'collects all applicable issues for invalid attribute names without coercion: %j',
    async (name) => {
      const selection = catalog.selectCandidate(
        (await catalog.listCandidates())[0],
        true,
      );
      const input = {
        ...product(),
        attributes: [{ name, value: '', evidenceRef: 'absent' }],
        media: [{ mediaRef: 'unverified-image', evidenceRef: 'absent' }],
      };
      // The existing registration must retain its first contract error before persistence.
      await expect(
        affiliate.registerProduct({
          idempotencyKey: 'register_fix',
          product: input,
        }),
      ).rejects.toMatchObject({
        name: 'ContractValidationError',
        code: 'INVALID_AFFILIATE_TEXT',
        path: 'attribute.name',
      });
      expect(persistence.open).not.toHaveBeenCalled();
      const result = affiliate.evaluateShopeeSelection(selection, input);
      expect(result).toMatchObject({
        eligibility: 'BLOCKED',
        validatedProduct: null,
      });
      expect(result.pending).toEqual([
        { code: 'INVALID_AFFILIATE_TEXT', field: 'attributes.0.name' },
        { code: 'INVALID_AFFILIATE_TEXT', field: 'attributes.0.value' },
        {
          code: 'AFFILIATE_EVIDENCE_MISSING',
          field: 'attributes.0.evidenceRef',
        },
        { code: 'AFFILIATE_EVIDENCE_MISSING', field: 'media.0.evidenceRef' },
        { code: 'SHOPEE_MEDIA_NOT_VERIFIED', field: 'media.0.mediaRef' },
      ]);
      expect(affiliate.evaluateShopeeSelection(selection, input)).toEqual(
        result,
      );
      await expect(
        affiliate.registerShopeeSelection(
          selection,
          input,
          [],
          'register_fix',
          true,
        ),
      ).rejects.toThrow('SHOPEE_SELECTION_BLOCKED');
      expect(persistence.open).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: 'price', value: 'ten', fields: ['name'] },
    { name: 'material', value: 'R$ 10', fields: ['value'] },
    { name: 'preço', value: 'R$ 10', fields: ['name', 'value'] },
  ])(
    'identifies the actual price fields while preserving registration errors: %j',
    async ({ name, value, fields }) => {
      const selection = catalog.selectCandidate(
        (await catalog.listCandidates())[0],
        true,
      );
      const input = {
        ...product(),
        attributes: [{ name, value, evidenceRef: 'ev_spec' }],
      };
      await expect(
        affiliate.registerProduct({
          idempotencyKey: 'register_fix',
          product: input,
        }),
      ).rejects.toMatchObject({
        name: 'ContractValidationError',
        code: 'AFFILIATE_DYNAMIC_PRICE_UNSUPPORTED',
        path: 'attributes',
      });
      expect(persistence.open).not.toHaveBeenCalled();
      const result = affiliate.evaluateShopeeSelection(selection, input, [
        'authorized-image',
      ]);
      expect(result).toMatchObject({
        eligibility: 'BLOCKED',
        validatedProduct: null,
      });
      expect(result.pending).toEqual(
        fields.map((field) => ({
          code: 'AFFILIATE_DYNAMIC_PRICE_UNSUPPORTED',
          field: `attributes.0.${field}`,
        })),
      );
      expect(
        affiliate.evaluateShopeeSelection(selection, input, [
          'authorized-image',
        ]),
      ).toEqual(result);
    },
  );
});
