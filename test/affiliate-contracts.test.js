import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAffiliateProduct, validateAffiliateCampaign, materializeAffiliateBriefing, validateAffiliateBriefing, affiliateHash } from '../src/domain/affiliate-contracts.js';
import { product, campaign } from './affiliate-fixtures.js';

test('contratos aprovados preservam URL integral e materializam evidências/hash imutáveis', () => {
  const p = validateAffiliateProduct(product());
  const c = validateAffiliateCampaign(campaign());
  assert.equal(c.affiliateUrl, campaign().affiliateUrl);
  const briefing = materializeAffiliateBriefing('brief_001', c, p);
  assert.deepEqual(validateAffiliateBriefing(briefing), briefing);
  assert.deepEqual(briefing.evidence, p.evidence);
  assert.equal(briefing.contentHash, affiliateHash(briefing));
  assert.ok(Object.isFrozen(briefing.attributes[0]));
  assert.equal(affiliateHash({ b: 2, a: 1 }), affiliateHash({ a: 1, b: 2 }));
});

test('produto rejeita campos obrigatórios, evidências vazias, duplicadas, ausentes e tipos incorretos', () => {
  for (const mutate of [
    p => { p.name = ' '; }, p => { p.revision = 0; }, p => { p.brand = ''; },
    p => { p.attributes = []; }, p => { p.media = []; }, p => { p.productId = '../bad'; },
    p => { p.evidence[0].sourceRef = ''; }, p => { p.evidence[0].recordedAt = 'yesterday'; },
    p => { p.attributes[0].evidenceRef = 'missing'; }, p => { p.media[0].evidenceRef = 'ev_spec'; },
    p => { p.attributes[0].evidenceRef = 'ev_rights'; }, p => { p.evidence.push(p.evidence[0]); },
    p => { p.attributes.push(p.attributes[0]); }, p => { p.media.push(p.media[0]); },
    p => { p.price = '99'; }, p => { p.evidence[0].kind = 'UNVERIFIED'; },
    p => { p.attributes[0].name = 'price'; },
  ]) {
    const p = product(); mutate(p);
    assert.throws(() => validateAffiliateProduct(p));
  }
});

test('campanha rejeita HTTPS inválido, revisão inválida e CTA/disclosure vazios', () => {
  for (const overrides of [ { affiliateUrl: 'http://example.com' }, { affiliateUrl: 'invalid' },
    { affiliateUrl: 'https://user:password@example.com' }, { cta: '' }, { disclosure: ' ' },
    { revision: 1.5 }, { productRevision: 0 }, { projectId: '' } ]) {
    assert.throws(() => validateAffiliateCampaign(campaign(overrides)));
  }
});

test('briefing rejeita adulteração, hash recalculado com referências inválidas e escopo divergente', () => {
  const briefing = materializeAffiliateBriefing('brief_001', campaign(), product());
  assert.throws(() => validateAffiliateBriefing({ ...briefing, cta: 'outro CTA' }));
  const invalid = { ...briefing, attributes: [{ name: 'x', value: 'y', evidenceRef: 'missing' }] };
  invalid.contentHash = affiliateHash(invalid);
  assert.throws(() => validateAffiliateBriefing(invalid));
  assert.throws(() => materializeAffiliateBriefing('brief_001', campaign({ productRevision: 2 }), product()));
});
