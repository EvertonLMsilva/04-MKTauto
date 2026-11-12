import { validateReconciliationInput } from './domain/manual-publication-reconciliation.contracts.js';
import { facebookPublicationFixture } from '../../../test/support/facebook-publication.fixture.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import {
  provisionQcReviewer,
  operationalQcIdentity,
} from './application/local-qc-identity.js';
import { ManualDistributionRepository } from './infrastructure/manual-distribution.repository.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import {
  MANUAL_RECONCILIATION_VERSION,
  reconciliationId,
} from './domain/manual-publication-reconciliation.contracts.js';
const input = {
  publicationId: 'manual_publication:' + 'a'.repeat(64),
  packageHash: 'a'.repeat(64),
  originalReceiptHash: 'b'.repeat(64),
  platform: 'instagram',
  account: '123456789',
  externalId: 'FICTITIOUS_TEST_ONLY',
  externalUrl: 'https://www.instagram.com/reel/FICTITIOUS_TEST_ONLY/',
  publishedAt: '2026-11-12T12:00:00Z',
  evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:operator-observation',
  confirmationOrigin: 'OPERATOR_ATTESTED',
};
test('manual reconciliation accepts only an explicit operator attestation', () => {
  expect(validateReconciliationInput(input)).toEqual(input);
});
test.each([
  'operatorId',
  'recordedAt',
  'state',
  'confirmationOrigin',
  'externalUrl',
  'evidenceReference',
])('rejects caller-controlled or insufficient %s', (key) => {
  const bad = {
    ...input,
    [key]:
      key === 'confirmationOrigin'
        ? 'PLATFORM_VERIFIED'
        : key === 'externalUrl'
          ? 'https://www.facebook.com/reel/FICTITIOUS_TEST_ONLY/'
          : '',
  };
  expect(() => validateReconciliationInput(bad)).toThrow();
});

async function fixture() {
  const f = await facebookPublicationFixture();
  const root = mkdtempSync(
    join(tmpdir(), 'reconcile-FICTITIOUS_TEST_ONLY-unit-'),
  );
  const config = join(root, 'identities.json'),
    secret = join(root, 'fixture-secret');
  await provisionQcReviewer(config, 'fixture_operator', secret);
  vi.stubEnv('QC_IDENTITIES_FILE', config);
  const principal = await operationalQcIdentity.authenticate(
    'Bearer ' + readFileSync(secret, 'utf8').trim(),
    '127.0.0.1',
  );
  const pkg = f.instagramPackage;
  const original = f.publishing.recordPublication(
    {
      packageHash: pkg.contentHash,
      actor: 'FICTITIOUS_TEST_ONLY',
      publishedAt: f.at,
      externalId: null,
      externalUrl: null,
      evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:uncertain',
      state: 'UNCONFIRMED',
    },
    'reconciliation_original',
  );
  const value = {
    ...input,
    publicationId: original.publicationId,
    packageHash: pkg.contentHash,
    originalReceiptHash: original.contentHash,
    publishedAt: f.at,
    account: pkg.account,
  };
  const reconcile = (v = value, key = 'reconciliation_attest') =>
    f.publishing.reconcilePublication(v, key, principal);
  return {
    f,
    pkg,
    original,
    value,
    principal,
    reconcile,
    cleanup() {
      f.cleanup();
      rmSync(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    },
  };
}

test.each([
  'account',
  'packageHash',
  'originalReceiptHash',
  'externalUrl',
  'evidenceReference',
  'confirmationOrigin',
  'publishedAt',
])('rejects wrong %s with no event or receipt mutation', async (field) => {
  const t = await fixture();
  try {
    const changed =
      field === 'account'
        ? '999999999'
        : field === 'packageHash' || field === 'originalReceiptHash'
          ? 'f'.repeat(64)
          : field === 'externalUrl'
            ? 'https://www.facebook.com/reel/FICTITIOUS_TEST_ONLY/'
            : field === 'confirmationOrigin'
              ? 'PLATFORM_VERIFIED'
              : field === 'publishedAt'
                ? '2099-01-01T00:00:00Z'
                : '';
    expect(() => t.reconcile({ ...t.value, [field]: changed })).toThrow();
    expect(t.f.publishing.reconciliations(t.original.publicationId)).toEqual(
      [],
    );
    expect(t.f.publishing.publication(t.original.publicationId)).toEqual(
      t.original,
    );
  } finally {
    t.cleanup();
  }
});

test('event replay is immutable; conflicting confirmation, forged operator and revoked approval cannot append', async () => {
  const t = await fixture();
  try {
    expect(() =>
      t.f.publishing.reconcilePublication(t.value, 'reconciliation_attest', {
        id: 'fixture_operator',
      }),
    ).toThrow(/QC_AUTHENTICATION_REQUIRED/);
    const event = t.reconcile();
    expect(t.reconcile()).toEqual(event);
    expect(Object.isFrozen(event)).toBe(true);
    expect(() =>
      t.reconcile({ ...t.value, externalId: 'OTHER_FIXTURE' }),
    ).toThrow(/RECONCILIATION_CONFLICT/);
    expect(() => t.reconcile(t.value, 'another_key')).toThrow(
      /RECONCILIATION_CONFLICT/,
    );
    expect(() =>
      t.f.f.base.db
        .prepare(
          'UPDATE manual_publication_reconciliations_v1 SET external_id=?',
        )
        .run('changed'),
    ).toThrow(/IMMUTABLE/);
    expect(() =>
      t.f.f.base.db.exec('DELETE FROM manual_publication_reconciliations_v1'),
    ).toThrow(/IMMUTABLE/);
    t.f.publishing.revokeApproval({
      packageHash: t.pkg.contentHash,
      reviewHash: t.original.reviewHash,
      actor: 'FICTITIOUS_TEST_ONLY',
      reason: 'FICTITIOUS_TEST_ONLY:revoked',
    });
    expect(() => t.reconcile()).toThrow(/APPROVAL_REVOKED/);
    expect(
      t.f.publishing.effectivePublication(t.original.publicationId)
        .reconciliationHistory,
    ).toEqual([event]);
  } finally {
    t.cleanup();
  }
});

test('FAKE_ONLY cannot be reconciled', async () => {
  const t = await fixture();
  try {
    const report = t.f.media.report();
    report.evidence = {
      publicationAuthorization: { grant: { scope: { mode: 'fake' } } },
    };
    const fakePkg = t.f.prepare(
      'instagram',
      t.pkg.account,
      'FICTITIOUS_TEST_ONLY:fake-only',
    );
    t.f.approve(fakePkg);
    // Original uncertain record predates a fake-only QC envelope. Gate still
    // refuses reconciliation against either the stale original or fake package.
    expect(() => t.reconcile()).toThrow();
    const s = t.f.store.open();
    try {
      expect(() =>
        s.manual.reconcilePublication(
          { ...t.value, packageHash: fakePkg.contentHash },
          'fake_reconciliation',
          t.principal,
        ),
      ).toThrow(/FAKE_ONLY/);
    } finally {
      s.close();
    }
    expect(t.f.publishing.reconciliations(t.original.publicationId)).toEqual(
      [],
    );
  } finally {
    t.cleanup();
  }
});

test.each(['id', 'url', 'legacy'])(
  'external %s identity cannot be reused by incompatible packages, including legacy receipts',
  async (kind) => {
    const t = await fixture();
    try {
      t.reconcile();
      const other = t.f.prepare(
        'instagram',
        '999999999',
        'FICTITIOUS_TEST_ONLY:other-package',
      );
      t.f.approve(other);
      const pubInput = {
        packageHash: other.contentHash,
        actor: 'FICTITIOUS_TEST_ONLY',
        publishedAt: t.f.at,
        externalId: null,
        externalUrl: null,
        evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:other',
        state: 'UNCONFIRMED',
      };
      if (kind === 'legacy') {
        expect(() =>
          t.f.publishing.recordPublication(
            {
              ...pubInput,
              externalId: t.value.externalId,
              externalUrl: t.value.externalUrl,
              state: 'PUBLISHED',
            },
            'duplicate_legacy',
          ),
        ).toThrow(/EVIDENCE_CONFLICT/);
      } else {
        const original = t.f.publishing.recordPublication(
          pubInput,
          'another_original',
        );
        expect(() =>
          t.reconcile(
            {
              ...t.value,
              account: other.account,
              publicationId: original.publicationId,
              packageHash: other.contentHash,
              originalReceiptHash: original.contentHash,
              externalId: kind === 'id' ? t.value.externalId : 'OTHER_FIXTURE',
              externalUrl:
                kind === 'url'
                  ? 'https://instagram.com/p/FICTITIOUS_TEST_ONLY?utm_source=test'
                  : 'https://instagram.com/reel/OTHER_FIXTURE/',
            },
            'another_attest',
          ),
        ).toThrow(/EVIDENCE_CONFLICT/);
      }
    } finally {
      t.cleanup();
    }
  },
);

test('rollback is atomic, and corrupt event reads fail closed without disabling immutability triggers', async () => {
  const t = await fixture();
  const session = t.f.store.open();
  try {
    const repository = session.manual
      .repository as ManualDistributionRepository;
    const query = repository.db.prepare.bind(repository.db);
    let inserted = false;
    vi.spyOn(repository.db, 'prepare').mockImplementation((sql: string) => {
      if (
        sql.startsWith('SELECT * FROM manual_publication_reconciliations_v1') &&
        Number(
          query(
            'SELECT COUNT(*) AS n FROM manual_publication_reconciliations_v1',
          ).get()?.n,
        ) > 0
      ) {
        inserted = true;
        throw Error('FICTITIOUS_TEST_ONLY:write-failed');
      }
      return query(sql);
    });
    expect(() =>
      session.manual.reconcilePublication(
        t.value,
        'reconciliation_attest',
        t.principal,
      ),
    ).toThrow(/write-failed/);
    expect(inserted).toBe(true);
    expect(repository.db.isTransaction).toBe(false);
    expect(t.f.publishing.reconciliations(t.original.publicationId)).toEqual(
      [],
    );
    vi.restoreAllMocks();
    const event = t.reconcile();
    vi.spyOn(repository.db, 'prepare').mockImplementation((sql: string) => {
      const statement = query(sql);
      if (
        sql.startsWith('SELECT * FROM manual_publication_reconciliations_v1')
      ) {
        const all = statement.all.bind(statement);
        vi.spyOn(statement, 'all').mockImplementation((...args: any[]) =>
          all(...args).map((row) => ({
            ...row,
            payload_json: JSON.stringify({ ...event, account: '999999999' }),
          })),
        );
      }
      return statement;
    });
    expect(() =>
      repository.effectivePublication(t.original.publicationId),
    ).toThrow(/RECONCILIATION_INTEGRITY/);
    expect(t.f.publishing.publication(t.original.publicationId)).toEqual(
      t.original,
    );
  } finally {
    session.close();
    t.cleanup();
  }
});

test('missing extension blocks writes without runtime provisioning', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const r = new ManualDistributionRepository({ db }, {} as any);
    expect(() =>
      r.reconcile(
        input as any,
        'fixture_operator',
        'fixture_key',
        () => '2026-11-12T13:00:00Z',
        () => {},
      ),
    ).toThrow(/SCHEMA_REQUIRED/);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        )
        .all(),
    ).toEqual([]);
  } finally {
    db.close();
  }
});

test('legacy confirmed receipts cannot be reconciled or have their external evidence reassigned', async () => {
  const t = await fixture();
  try {
    const pkg = t.f.prepare(
      'instagram',
      '999999999',
      'FICTITIOUS_TEST_ONLY:confirmed-original',
    );
    t.f.approve(pkg);
    const legacy = t.f.publishing.recordPublication(
      {
        packageHash: pkg.contentHash,
        actor: 'FICTITIOUS_TEST_ONLY',
        publishedAt: t.f.at,
        externalId: t.value.externalId,
        externalUrl: t.value.externalUrl,
        evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:legacy-attestation',
        state: 'PUBLISHED',
      },
      'legacy_confirmed',
    );
    expect(() => t.reconcile()).toThrow(/EVIDENCE_CONFLICT/);
    expect(() =>
      t.reconcile(
        {
          ...t.value,
          publicationId: legacy.publicationId,
          packageHash: pkg.contentHash,
          originalReceiptHash: legacy.contentHash,
          account: pkg.account,
        },
        'legacy_reconcile',
      ),
    ).toThrow(/SCOPE_MISMATCH/);
    expect(t.f.publishing.publication(legacy.publicationId)).toEqual(legacy);
  } finally {
    t.cleanup();
  }
});

test('two independent SQLite workers serialize the same confirmation and preserve one immutable event', async () => {
  const t = await fixture();
  try {
    // Exercise the actual repository transaction in separate threads;
    // authority/gate validation is covered by the HTTP/service tests above.
    const body = {
      ...t.value,
      schemaVersion: MANUAL_RECONCILIATION_VERSION,
      reconciliationId: reconciliationId(
        t.value as any,
        t.principal.id,
        'worker_reconcile',
      ),
      originalReviewHash: t.original.reviewHash,
      operatorId: t.principal.id,
      recordedAt: new Date().toISOString(),
      idempotencyKey: 'worker_reconcile',
    };
    const event = { ...body, contentHash: affiliateHash(body) };
    const worker = () =>
      new Promise<string>((resolve, reject) => {
        const w = new Worker(
          `const {parentPort,workerData}=require('node:worker_threads');
        const {registerHooks,stripTypeScriptTypes}=require('node:module');
        const {readFileSync,existsSync}=require('node:fs');
        registerHooks({resolve(specifier,context,next){
          if(specifier.startsWith('.')&&specifier.endsWith('.js')&&context.parentURL){
            const ts=new URL(specifier.slice(0,-3)+'.ts',context.parentURL);
            if(existsSync(ts))return {url:ts.href,shortCircuit:true};
          } return next(specifier,context);
        },load(url,context,next){
          if(url.endsWith('.ts'))return {format:'module',source:stripTypeScriptTypes(readFileSync(new URL(url),'utf8'),{mode:'transform'}),shortCircuit:true};
          return next(url,context);
        }});
        (async()=>{ const {DatabaseSync}=require('node:sqlite'); const {ManualDistributionRepository}=await import(workerData.module); const db=new DatabaseSync(workerData.path); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000'); try { const repo=new ManualDistributionRepository({db},{}); const result=repo.reconcile(workerData.input,workerData.operator,'worker_reconcile',()=>workerData.at,()=>{}); parentPort.postMessage(result.contentHash); } finally {db.close();} })().catch(e=>{throw e;});`,
          {
            eval: true,
            workerData: {
              module: new URL(
                './infrastructure/manual-distribution.repository.ts',
                import.meta.url,
              ).href,
              path: t.f.f.database,
              input: t.value,
              operator: t.principal.id,
              at: body.recordedAt,
            },
          },
        );
        w.once('message', resolve);
        w.once('error', reject);
        w.once('exit', (code) => {
          if (code) reject(Error('WORKER_EXIT_' + code));
        });
      });
    expect(await Promise.all([worker(), worker()])).toEqual([
      event.contentHash,
      event.contentHash,
    ]);
    expect(t.f.publishing.reconciliations(t.original.publicationId)).toEqual([
      event,
    ]);
    expect(t.f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    t.cleanup();
  }
}, 15000);
