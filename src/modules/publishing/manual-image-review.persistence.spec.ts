import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fork } from 'node:child_process';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { ManualImageQcService } from './application/manual-image-qc.service.js';
import {
  manualImagePackageHash,
  type ManualImagePackage,
} from './domain/manual-image-package-contracts.js';
import {
  validateImageReviewSnapshot,
  type ImageReviewRecord,
  type ImageReviewSnapshot,
} from './domain/manual-image-review-contracts.js';
import { ManualImageReviewRepository } from './infrastructure/manual-image-review.repository.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const migration = readFileSync(
  new URL(
    '../../infrastructure/database/migrations/manual_image_review_v1.sql',
    import.meta.url,
  ),
  'utf8',
);

async function snapshotFixture(): Promise<ImageReviewSnapshot> {
  const { createHash } = await import('node:crypto');
  const bytes = png() as Buffer,
    hash = createHash('sha256').update(bytes).digest('hex');
  const identity = {
    imageArtifactId: 'fixture_image',
    imageContentHash: hash,
    productId: 'fixture_product',
    productRevision: 1,
    mediaReference: 'media:fixture',
    format: 'png' as const,
    widthPixels: 90,
    heightPixels: 160,
  };
  const provenance = {
    ...identity,
    schemaVersion: 'manual-image-provenance/1.0.0',
    sourceId: 'fixture_owned',
    contentHash: '',
  };
  provenance.contentHash = affiliateHash(provenance);
  const qc = new ManualImageQcService(
    {
      getArtifact: () => ({
        ...identity,
        provenanceReference:
          'image-provenance:sha256:' + provenance.contentHash,
      }),
      getProvenance: () => provenance,
      readBytes: () => bytes,
    },
    {
      trustedSourceIds: ['fixture_owned'],
      decoder: {
        id: 'fixture_decoder',
        version: 'test/1',
        decode: () => ({
          ...identity,
          fullyDecoded: true,
          frameCount: 1,
          rgba: new Uint8Array(90 * 160 * 4),
        }),
      },
    },
  );
  const result = await qc.inspect({
    imageArtifactId: identity.imageArtifactId,
    imageContentHash: hash,
    productId: identity.productId,
    productRevision: 1,
  });
  expect(result.status).toBe('PASS');
  const p: ManualImagePackage = {
    ...identity,
    schemaVersion: 'manual-image-package/1.0.0',
    packageHash: '',
    campaignId: 'fixture_campaign',
    campaignRevision: 1,
    campaignHash: 'a'.repeat(64),
    productHash: 'b'.repeat(64),
    projectId: 'fixture_project',
    projectVersion: 1,
    pipelineRunId: null,
    destination: 'instagram',
    account: '123456789',
    caption: 'Synthetic repository fixture',
    externalProvider: null,
    sizeBytes: bytes.length,
    cta: 'Confira',
    disclosure: 'Publicidade',
    affiliateUrl: 'https://example.com/fixture',
    rightsReferences: [
      {
        id: 'fixture_rights',
        sourceRef: 'fixture:owned',
        evidenceHash: 'c'.repeat(64),
      },
    ],
    qualityControl: {
      status: 'PASS',
      reportId: result.bundle!.report.reportId,
      contentHash: result.bundle!.report.contentHash,
    },
    review: { status: 'HUMAN_APPROVAL_REQUIRED', contentHash: null },
  };
  p.packageHash = manualImagePackageHash(p);
  return validateImageReviewSnapshot({ package: p, qc: result.bundle! });
}
function record(
  snapshot: ImageReviewSnapshot,
  id = 'fixture_decision',
): ImageReviewRecord {
  const body = {
    schemaVersion: 'manual-image-review/1.0.0' as const,
    decisionId: id,
    actor: 'fixture_reviewer',
    packageHash: snapshot.package.packageHash,
    imageArtifactId: snapshot.package.imageArtifactId,
    imageContentHash: snapshot.package.imageContentHash,
    qualityControlHash: snapshot.qc.report.contentHash,
    decision: 'APPROVED' as const,
    reviewedAt: '2026-11-12T12:00:00Z',
    revoked: false,
  };
  return {
    review: { ...body, contentHash: affiliateHash(body) },
    revision: 1,
    reason: null,
    snapshot,
  };
}
test('schema absent never provisions itself', () => {
  const db = new DatabaseSync(':memory:');
  try {
    expect(() => new ManualImageReviewRepository(db)).toThrow(
      'IMAGE_REVIEW_SCHEMA_REQUIRED',
    );
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
    ).toEqual([]);
  } finally {
    db.close();
  }
});
test('immutable rows, FK, rollback, revision CAS and replay conflict', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  try {
    const repository = new ManualImageReviewRepository(db),
      snapshot = await snapshotFixture(),
      r = record(snapshot);
    db.exec(
      "CREATE TRIGGER fixture_fail_receipt BEFORE INSERT ON manual_image_review_commands_v1 WHEN NEW.command_key='rollback' BEGIN SELECT RAISE(ABORT,'FIXTURE_ROLLBACK'); END;",
    );
    expect(() =>
      repository.decide('rollback', 'd'.repeat(64), snapshot, 0, () => r),
    ).toThrow('FIXTURE_ROLLBACK');
    for (const table of ['packages', 'decisions', 'commands'])
      expect(
        db
          .prepare(`SELECT count(*) AS n FROM manual_image_review_${table}_v1`)
          .get()?.n,
      ).toBe(0);
    expect(
      repository.decide('key', 'd'.repeat(64), snapshot, 0, () => r),
    ).toEqual(r);
    expect(
      repository.decide('key', 'd'.repeat(64), snapshot, 0, () => {
        throw Error('REPLAY_FACTORY_CALLED');
      }),
    ).toEqual(r);
    expect(() =>
      repository.decide('key', 'e'.repeat(64), snapshot, 0, () => r),
    ).toThrow('IMAGE_REVIEW_IDEMPOTENCY_CONFLICT');
    expect(() =>
      repository.decide('other', 'f'.repeat(64), snapshot, 0, () => r),
    ).toThrow('IMAGE_REVIEW_REVISION_CONFLICT');
    for (const table of ['packages', 'decisions', 'commands']) {
      expect(() =>
        db.exec(`DELETE FROM manual_image_review_${table}_v1`),
      ).toThrow('IMAGE_REVIEW_IMMUTABLE');
      const field =
        table === 'packages'
          ? 'snapshot_hash'
          : table === 'decisions'
            ? 'reason'
            : 'payload_hash';
      expect(() =>
        db.exec(`UPDATE manual_image_review_${table}_v1 SET ${field}=${field}`),
      ).toThrow('IMAGE_REVIEW_IMMUTABLE');
    }
    expect(() =>
      db
        .prepare(
          'INSERT INTO manual_image_review_commands_v1 VALUES(?,?,?,NULL)',
        )
        .run('orphan', 'f'.repeat(64), 'missing'),
    ).toThrow('FOREIGN KEY');
    expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  } finally {
    db.close();
  }
});
test('two OS processes serialize replay, conflict and restart against actual SQLite repository', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mktauto-image-review-'));
  try {
    const database = join(directory, 'fixture.sqlite'),
      db = new DatabaseSync(database);
    db.exec(migration);
    db.close();
    const snapshot = await snapshotFixture(),
      r = record(snapshot);
    // Transpile the actual implementation into this disposable fixture only.
    const sources = [
      ['../affiliate/domain/affiliate-contracts.ts', 'affiliate-contracts'],
      ['../affiliate/domain/affiliate.errors.ts', 'affiliate.errors'],
      [
        './domain/manual-distribution-contracts.ts',
        'manual-distribution-contracts',
      ],
      [
        './domain/manual-image-package-contracts.ts',
        'manual-image-package-contracts',
      ],
      ['./domain/manual-image-qc-contracts.ts', 'manual-image-qc-contracts'],
      [
        './domain/manual-image-review-contracts.ts',
        'manual-image-review-contracts',
      ],
      [
        './infrastructure/manual-image-review.repository.ts',
        'manual-image-review.repository',
      ],
    ];
    for (const [source, name] of sources) {
      const text = readFileSync(
        new URL(source!, import.meta.url),
        'utf8',
      ).replace(
        /from ['"](?:\.\.\/|\.\/)[^'"]*\/([^/'"]+)['"]/g,
        "from './$1'",
      );
      writeFileSync(
        join(directory, name + '.js'),
        transpileModule(text, {
          compilerOptions: {
            module: ModuleKind.ESNext,
            target: ScriptTarget.ES2023,
          },
        }).outputText,
      );
    }
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    const runner = join(directory, 'race.mjs');
    writeFileSync(
      runner,
      `import {DatabaseSync} from 'node:sqlite'; import {ManualImageReviewRepository} from './manual-image-review.repository.js'; process.send('ready'); process.on('message',m=> { const db=new DatabaseSync(m.database); try {const repo=new ManualImageReviewRepository(db); const result=repo.decide(m.key,m.hash,m.snapshot,0,()=>m.record); process.send({ok:true,id:result.review.decisionId});} catch(e){process.send({ok:false,message:e.message});} finally {db.close();process.disconnect();}});`,
    );
    async function race(
      keys: string[],
      hashes: string[],
      raceSnapshot = snapshot,
      raceRecord = r,
    ) {
      const children = keys.map(() =>
        fork(runner, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }),
      );
      try {
        await Promise.all(
          children.map(
            (child) =>
              new Promise<void>((resolve, reject) => {
                child.once('message', () => resolve());
                child.once('error', reject);
                child.once('exit', (code) => {
                  if (code) reject(Error('Child exit ' + code));
                });
              }),
          ),
        );
        return await Promise.all(
          children.map(
            (child, i) =>
              new Promise<{ ok: boolean; id?: string; message?: string }>(
                (resolve, reject) => {
                  child.once('message', resolve);
                  child.once('error', reject);
                  child.send({
                    database,
                    key: keys[i],
                    hash: hashes[i],
                    snapshot: raceSnapshot,
                    record: raceRecord,
                  });
                },
              ),
          ),
        );
      } finally {
        for (const child of children) if (child.connected) child.kill();
      }
    }
    const same = await race(['same', 'same'], ['d'.repeat(64), 'd'.repeat(64)]);
    expect(same.every((v) => v.ok)).toBe(true);
    expect(new Set(same.map((v) => v.id)).size).toBe(1);
    const conflict = await race(
      ['same', 'same'],
      ['e'.repeat(64), 'f'.repeat(64)],
    );
    expect(
      conflict.every(
        (v) => !v.ok && v.message === 'IMAGE_REVIEW_IDEMPOTENCY_CONFLICT',
      ),
    ).toBe(true);
    const otherSnapshot = structuredClone(snapshot);
    otherSnapshot.package.caption = 'Another exact package';
    otherSnapshot.package.packageHash = manualImagePackageHash(
      otherSnapshot.package,
    );
    const competing = await race(
      ['competing_a', 'competing_b'],
      ['a'.repeat(64), 'b'.repeat(64)],
      otherSnapshot,
      record(otherSnapshot, 'other_decision'),
    );
    expect(competing.filter((v) => v.ok)).toHaveLength(1);
    expect(competing.find((v) => !v.ok)?.message).toBe(
      'IMAGE_REVIEW_REVISION_CONFLICT',
    );
    const restarted = new DatabaseSync(database);
    try {
      const repo = new ManualImageReviewRepository(restarted);
      expect(repo.getRecord(r.review.decisionId)).toEqual(r);
      expect(
        restarted
          .prepare('SELECT count(*) AS n FROM manual_image_review_decisions_v1')
          .get()?.n,
      ).toBe(2);
      const body = {
        schemaVersion: 'manual-image-review-revocation/1.0.0' as const,
        revocationId: 'fixture_revocation',
        decisionId: r.review.decisionId,
        decisionHash: r.review.contentHash,
        actor: 'fixture_reviewer',
        revokedAt: '2026-11-12T13:00:00Z',
        reason: 'Fixture: withdraw approval',
      };
      restarted.exec(
        "CREATE TRIGGER fixture_fail_revoke_receipt BEFORE INSERT ON manual_image_review_commands_v1 WHEN NEW.command_key='revoke_rollback' BEGIN SELECT RAISE(ABORT,'FIXTURE_REVOKE_ROLLBACK'); END;",
      );
      const make = () => ({ ...body, contentHash: affiliateHash(body) });
      expect(() =>
        repo.revoke(
          'revoke_rollback',
          'c'.repeat(64),
          r.review.decisionId,
          r.review.contentHash,
          make,
        ),
      ).toThrow('FIXTURE_REVOKE_ROLLBACK');
      expect(repo.getImageApproval(r.review.packageHash)?.revoked).toBe(false);
      expect(
        restarted
          .prepare(
            'SELECT count(*) AS n FROM manual_image_review_revocations_v1',
          )
          .get()?.n,
      ).toBe(0);
      repo.revoke(
        'revoke',
        'c'.repeat(64),
        r.review.decisionId,
        r.review.contentHash,
        make,
      );
    } finally {
      restarted.close();
    }
    const afterRevocation = new DatabaseSync(database);
    try {
      const repo = new ManualImageReviewRepository(afterRevocation),
        effective = repo.getImageApproval(r.review.packageHash)!;
      expect(effective.revoked).toBe(true);
      expect(effective.contentHash).toBe(affiliateHash(effective));
      expect(repo.getRecord(r.review.decisionId)).toEqual(r);
      expect(
        repo.revoke(
          'revoke',
          'c'.repeat(64),
          r.review.decisionId,
          r.review.contentHash,
          () => {
            throw Error('REPLAY_FACTORY_CALLED');
          },
        ),
      ).toEqual(r);
    } finally {
      afterRevocation.close();
    }
  } finally {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    expect(basename(directory).startsWith('mktauto-image-review-')).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
