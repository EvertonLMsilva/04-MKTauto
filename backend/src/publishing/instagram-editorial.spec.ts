import {
  buildCaption,
  validateCaptionEdit,
  publicationGrant,
} from './domain/instagram-editorial.js';
import { InstagramEditorialService } from './application/instagram-editorial.service.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captionText } from './domain/manual-distribution-contracts.js';
const context: any = {
  briefing: {
    productName: 'Travesseiro anatômico',
    attributes: [
      { name: 'Material', value: 'Espuma', evidenceRef: 'spec_1' },
      {
        name: 'Resultado',
        value: 'Cura dores em 7 dias',
        evidenceRef: 'spec_1',
      },
    ],
    evidence: [
      { id: 'spec_1', kind: 'PRODUCT_SPECIFICATION', sourceRef: 'owned:spec' },
    ],
    cta: 'Veja os detalhes do produto.',
    disclosure: 'Publicidade. Link de afiliado.',
    affiliateUrl: 'https://example.test/produto',
  },
  script: {
    contentHash: 'a'.repeat(64),
    fullNarration: 'Conheça este travesseiro.',
  },
  render: { contentHash: 'b'.repeat(64) },
  qc: { result: 'PASS' },
};
it('grounds conversion copy in safe documented facts and validates the complete Instagram envelope', () => {
  const c = buildCaption(context);
  expect(c.text).toContain('Publicidade');
  expect(c.text).toContain('Material: Espuma');
  expect(c.text).not.toContain('Cura');
  expect(c.envelope).toContain(context.briefing.affiliateUrl);
  expect(c.model).toBeNull();
  expect(c.inferencePerformed).toBe(false);
  expect(c.evidenceRefs).toContain('spec_1');
});
it('accepts the authorized organizers product and preserves its illustrative-scene disclosure', () => {
  const caption = buildCaption({
    ...context,
    briefing: {
      ...context.briefing,
      productName: 'Kit 7 e Kit 14 Organizadores Multiuso',
      disclosure: 'Publicidade · Cena ilustrativa · Link de afiliado',
    },
  });
  expect(caption.text).toContain('Organizadores Multiuso');
  expect(caption.text).toContain('Cena ilustrativa');
});
it.each([
  'Cura todas as dores!',
  'Só hoje! Últimas unidades!',
  'Compre por R$ 9,90',
  'Resultado garantido',
  '#CuraDor',
])('rejects unsupported edits %s', (text) =>
  expect(() => validateCaptionEdit(text, buildCaption(context))).toThrow(
    'SOCIAL_CAPTION_UNGROUNDED',
  ),
);
it('rejects incomplete scope, missing consent and stale publication grants', () => {
  const scope = { scopeHash: 'a'.repeat(64), mode: 'fake' };
  expect(() =>
    publicationGrant(
      scope,
      {
        scopeHash: 'b'.repeat(64),
        acceptsCommercialPublication: true,
        sourceRef: 'owned:license',
        statement: 'I own the commercial publication rights.',
      },
      'operator',
    ),
  ).toThrow();
  expect(() =>
    publicationGrant(
      scope,
      {
        scopeHash: scope.scopeHash,
        acceptsCommercialPublication: false,
        sourceRef: 'owned:license',
        statement: 'I own the commercial publication rights.',
      },
      'operator',
    ),
  ).toThrow();
});
it('allows caption paragraphs while retaining control-character and secret protections', () => {
  expect(captionText('Publicidade\n\nProduto')).toContain('\n');
  for (const text of [
    'Produto\tsegredo',
    'Produto\rsegredo',
    'Produto\nBearer private-token',
    'Produto\nhttps://example.test/?token=private',
  ])
    expect(() => captionText(text)).toThrow();
});
it('persists versions, preserves immutable history, rejects stale changes and resumes idempotently', () => {
  const root = mkdtempSync(join(tmpdir(), 'ig-editorial-')),
    file = join(root, 'offline.sqlite');
  try {
    const db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE campaign_executions(execution_id TEXT PRIMARY KEY);INSERT INTO campaign_executions VALUES('fixture')",
    );
    db.exec(
      readFileSync(
        new URL(
          '../../../src/db/migrations/instagram_editorial_v1.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    db.close();
    const service = new InstagramEditorialService(file),
      first = service.ensure('fixture', context);
    expect(service.ensure('fixture', context)).toEqual(first);
    const second = service.ensure('fixture', context, {
      previousHash: first.contentHash,
      actorId: 'operator_fixture',
    });
    expect(second.revision).toBe(2);
    expect(second.text).not.toBe(first.text);
    expect(() =>
      service.ensure('fixture', context, {
        previousHash: first.contentHash,
        actorId: 'operator_fixture',
      }),
    ).toThrow('SOCIAL_CAPTION_VERSION_STALE');
    const restarted = new InstagramEditorialService(file);
    expect(restarted.history('fixture')).toHaveLength(2);
    expect(restarted.ensure('fixture', context)).toEqual(second);
    const scope = { scopeHash: 'a'.repeat(64), mode: 'fake' },
      input = {
        scopeHash: scope.scopeHash,
        acceptsCommercialPublication: true,
        sourceRef: 'owned:fixture',
        statement: 'Fixture owns commercial publication rights.',
      };
    const grant = service.grant(scope, input, 'operator_fixture');
    expect(service.grant(scope, input, 'operator_fixture')).toEqual(grant);
    const audit = new DatabaseSync(file);
    try {
      expect(() =>
        audit.exec('DELETE FROM instagram_publication_rights'),
      ).toThrow('IMMUTABLE');
      expect(() =>
        audit.exec('DELETE FROM instagram_caption_versions'),
      ).toThrow('IMMUTABLE');
    } finally {
      audit.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
