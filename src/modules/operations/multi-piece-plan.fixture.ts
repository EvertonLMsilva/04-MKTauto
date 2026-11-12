import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { SqliteOperationsRepository } from '../content-operations/infrastructure/sqlite-operations.repository.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { MultiPiecePlanRepository } from './multi-piece-plan.repository.js';
import { MultiPiecePlanService } from './multi-piece-plan.service.js';
import { planMultiPieceCalendar } from './multi-piece-calendar.planner.js';
import {
  MULTI_PIECE_CALENDAR_VERSION,
  MULTI_PIECE_PROFILE,
} from './multi-piece-calendar.contract.js';

// Test-only, disposable storage. Production code never imports this factory.
export async function multiPiecePlanFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mktauto-multi-piece-009-'));
  const database = join(directory, 'disposable.sqlite');
  let projectsRepository: SqliteOperationsRepository | undefined;
  const cleanup = () => {
    projectsRepository?.db.close();
    const target = resolve(directory);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('mktauto-multi-piece-009-')
    )
      throw new Error('FIXTURE_PATH_INVALID');
    rmSync(target, { recursive: true, force: true });
  };
  try {
    const schema = new DatabaseSync(database);
    try {
      provisionSchema(schema);
    } finally {
      schema.close();
    }
    projectsRepository = new SqliteOperationsRepository(database);
    const base = { base: projectsRepository, database, cleanup };
    projectsRepository.create({
      id: 'project_001',
      name: 'FICTITIOUS_TEST_ONLY',
      version: 1,
      niche: 'Tecnologia',
      subniches: [],
      audience: { profile: 'Adultos', language: 'pt-BR' },
      references: [],
      channel: {
        publishing: {
          contentsPerDay: 1,
          networks: ['instagram'],
          timezone: 'America/Sao_Paulo',
          times: ['10:00'],
        },
      },
    });
    const projects = {
      get: async (id: string, version?: number) => {
        const value = base.base.get(id);
        return value &&
          (version === undefined || value.project.version === version)
          ? value
          : null;
      },
    };
    const affiliate = new AffiliateService(
      new SqliteAffiliatePersistence(base.database),
      projects,
    );
    await affiliate.registerProduct({
      idempotencyKey: 'fixture_product',
      product: {
        schemaVersion: 'affiliate-product/1.0.0',
        productId: 'prod_001',
        revision: 1,
        name: 'FICTITIOUS_TEST_ONLY',
        brand: 'Fixture',
        attributes: [
          { name: 'tipo', value: 'TEST', evidenceRef: 'fixture_spec' },
        ],
        media: [{ mediaRef: 'fixture_media', evidenceRef: 'fixture_rights' }],
        evidence: [
          {
            id: 'fixture_spec',
            kind: 'PRODUCT_SPECIFICATION',
            sourceRef: 'FICTITIOUS_TEST_ONLY:spec',
            recordedAt: '2026-11-12T12:00:00Z',
          },
          {
            id: 'fixture_rights',
            kind: 'MEDIA_USAGE_RIGHT',
            sourceRef: 'FICTITIOUS_TEST_ONLY:license',
            recordedAt: '2026-11-12T12:00:00Z',
          },
        ],
      },
    });
    for (const campaignId of ['camp_001', 'camp_002', 'camp_003'])
      await affiliate.registerCampaign({
        idempotencyKey: `fixture_${campaignId}`,
        campaign: {
          schemaVersion: 'affiliate-campaign/1.0.0',
          campaignId,
          revision: 1,
          projectId: 'project_001',
          productId: 'prod_001',
          productRevision: 1,
          affiliateUrl: 'https://fixture.invalid/product',
          cta: 'Confira os detalhes',
          disclosure: 'Publicidade | Link de afiliado',
        },
      });
    const identities = { projects, campaigns: affiliate };
    const open = () =>
      new MultiPiecePlanRepository(
        base.database,
        identities,
        () => '2026-11-12T12:00:00.000Z',
      );
    const repository = open();
    const command = (count = 1, requestId = 'request_001') => {
      const input = {
        schemaVersion: MULTI_PIECE_CALENDAR_VERSION,
        profile: MULTI_PIECE_PROFILE,
        projectId: 'project_001',
        projectVersion: 1,
        timeZone: 'America/Sao_Paulo',
        startDate: '2026-12-20',
        durationWeeks: 4,
        weeklyGoals: { VIDEO: 1, IMAGE: 10 },
        campaigns: ['camp_001', 'camp_002', 'camp_003']
          .slice(0, count)
          .map((campaignId) => ({
            campaignId,
            campaignRevision: 1,
            destinations: [`destination_${campaignId}`],
            preferredTimes: { VIDEO: ['18:00'], IMAGE: ['09:00', '15:00'] },
          })),
      };
      return { requestId, input, plan: planMultiPieceCalendar(input) };
    };
    const installExtension = () =>
      base.base.db.exec(
        readFileSync(
          new URL(
            '../../infrastructure/database/migrations/operations_multi_piece_plan_v1.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
    const extensionCounts = () =>
      Object.fromEntries(
        ['plans', 'pieces', 'occurrences', 'requests'].map((kind) => [
          kind,
          base.base.db
            .prepare(
              `SELECT count(*) AS n FROM operations_multi_piece_${kind === 'plans' ? 'plans' : `plan_${kind}`}_v1`,
            )
            .get()!.n,
        ]),
      );
    return {
      ...base,
      affiliate,
      identities,
      open,
      repository,
      service: new MultiPiecePlanService(repository),
      command,
      installExtension,
      extensionCounts,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
