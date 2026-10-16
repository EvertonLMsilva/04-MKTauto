import { historicalResidualPersistence } from '../../test/support/historical-residual-persistence.js';
import { historicalResidualContracts } from '../../test/support/historical-residual-contracts.js';
import { affiliateRunFixture } from '../../test/support/affiliate-run-fixture.js';
import { contentStore } from '../../test/support/content-store.js';
import { script } from '../../test/support/content-fixture.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { scriptContentHash } from './domain/script-contracts.js';
import { validateAffiliateEditorialSelection } from './domain/affiliate-editorial-contracts.js';
const legacy = historicalResidualPersistence('script-repository');
const contracts = historicalResidualContracts('affiliate-contracts');

describe('Content owns Affiliate editorial decisions', () => {
  it('preserves editorial selection, commercial script, provenance and replay across JS/TS', () => {
    const f = affiliateRunFixture();
    const affiliate = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
    affiliate.bindRun(
      { pipelineRunId: 'run_001', briefingId: 'brief_001' },
      'editorial_bind',
    );
    const briefing = affiliate.resolveRunBriefing('run_001')!;
    const r = contentStore(f.database).open(),
      js = new legacy.ScriptRepository(f.database);
    try {
      const value = {
        schemaVersion: 'affiliate-editorial-selection/1.0.0',
        selectionId: 'editorial_001',
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        briefingId: 'brief_001',
        briefingHash: briefing.contentHash,
        evidenceRefs: ['ev_spec', 'ev_rights'],
        title: 'Conheça este fone',
        editorialAngle: 'Conectividade para o cotidiano',
        decision: 'SELECTED',
        actor: { type: 'HUMAN', id: 'operator_001' },
        decidedAt: '2026-10-14T12:01:00Z',
        contentHash: '',
      };
      value.contentHash = affiliateHash(value);
      expect(validateAffiliateEditorialSelection(value)).toEqual(
        contracts.validateAffiliateEditorialSelection(value),
      );
      expect(r.registerAffiliateEditorialSelection(value)).toEqual(
        js.registerAffiliateEditorialSelection(value),
      );
      expect(r.getAffiliateEditorialSelection(value.selectionId)).toEqual(
        value,
      );
      const commercial = script(
        {
          pipelineRunId: 'run_001',
          projectId: 'project_001',
          projectVersion: 1,
        },
        {
          schemaVersion: 'script/2.0.0',
          editorialSelectionId: value.selectionId,
          editorialSelectionContentHash: value.contentHash,
          cta: briefing.cta,
        },
      );
      for (const key of [
        'ideaSelectionId',
        'ideaSelectionContentHash',
        'ideaCandidateId',
        'ideaContentHash',
      ])
        delete commercial[key];
      commercial.contentHash = scriptContentHash(commercial);
      expect(r.registerScript(commercial)).toEqual(
        js.registerScript(commercial),
      );
      expect(r.getScript(commercial.scriptId)).toEqual(
        js.getScript(commercial.scriptId),
      );
      expect(
        r.db.prepare('SELECT COUNT(*) AS n FROM cost_events').get()?.n,
      ).toBe(0);
      expect(
        r.db
          .prepare('SELECT COUNT(*) AS n FROM script_generation_requests')
          .get()?.n,
      ).toBe(0);
      const lineage = r.db
        .prepare(
          'SELECT input_id,content_hash FROM artifact_lineage_inputs WHERE artifact_id=?',
        )
        .all(value.selectionId);
      expect(lineage).toEqual([
        { input_id: briefing.briefingId, content_hash: briefing.contentHash },
      ]);
    } finally {
      r.close();
      js.close();
      f.cleanup();
    }
  });
  it('rejects automated selections without authorized media evidence', () => {
    const f = affiliateRunFixture();
    const affiliate = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
    affiliate.bindRun(
      { pipelineRunId: 'run_001', briefingId: 'brief_001' },
      'editorial_bind',
    );
    const briefing = affiliate.resolveRunBriefing('run_001')!;
    const r = contentStore(f.database).open();
    try {
      const value = {
        schemaVersion: 'affiliate-editorial-selection/1.0.0',
        selectionId: 'editorial_001',
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        briefingId: 'brief_001',
        briefingHash: briefing.contentHash,
        evidenceRefs: ['ev_spec'],
        title: 'Conheça este fone',
        editorialAngle: 'Conectividade para o cotidiano',
        decision: 'SELECTED',
        actor: {
          type: 'AUTOMATION',
          id: 'operator_001',
          policyId: 'policy_001',
          policyVersion: '1',
          productId: briefing.productId,
          campaignId: briefing.campaignId,
          reason: 'Seleção por política',
        },
        decidedAt: '2026-10-14T12:01:00Z',
        contentHash: '',
      };
      value.contentHash = affiliateHash(value);
      expect(() => r.registerAffiliateEditorialSelection(value)).toThrowError(
        expect.objectContaining({
          code: 'AFFILIATE_AUTOMATION_RIGHTS_REQUIRED',
        }),
      );
      expect(
        r.db
          .prepare('SELECT COUNT(*) AS n FROM affiliate_editorial_selections')
          .get()?.n,
      ).toBe(0);
    } finally {
      r.close();
      f.cleanup();
    }
  });
});
