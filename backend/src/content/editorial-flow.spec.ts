import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { contentStore } from '../../test/support/content-store.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { OperationsPersistence } from '../content-operations/infrastructure/operations.persistence.js';
import { ContentService } from './application/content.service.js';
import { EditorialFlowService } from './application/editorial-flow.service.js';
import { FakeEditorialProvider } from './infrastructure/fake-editorial.provider.js';
import { scriptContentHash } from './domain/script-contracts.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { provisionSchema } from '../administration/schema-provisioner.js';

export function editorialFixture() {
  const f = p2EditorialFixture();
  const affiliate = new AffiliateRunContextService(
    new SqliteAffiliateRunContextPersistence(f.database),
  );
  const operations = new OperationsPersistence(f.database);
  const content = new ContentService(contentStore(f.database));
  const shortlist = f.shortlist;
  const research = {
    getShortlist: vi.fn(() => shortlist),
    getInsight: vi.fn(() => null),
  };
  const finance = { getGlobalOperation: vi.fn(() => null) };
  const provider = new FakeEditorialProvider();
  const catalog = new AffiliateService(
    new SqliteAffiliatePersistence(f.database),
    { get: vi.fn() },
  );
  const flow = () =>
    new EditorialFlowService(
      content,
      affiliate,
      research,
      operations,
      finance,
      provider,
      catalog,
    );
  const input = {
    generationRequestId: 'editorial_gen_001',
    pipelineRunId: 'run_001',
    briefingId: 'brief_001',
    researchShortlistId: shortlist.artifactId,
    referenceInsightId: null,
    requestedAt: '2026-10-14T12:01:00Z',
    supersedesScriptId: null,
  };
  return {
    ...f,
    affiliate,
    operations,
    content,
    research,
    finance,
    provider,
    catalog,
    flow,
    input,
  };
}

describe('Nest editorial production', () => {
  let f: ReturnType<typeof editorialFixture>;
  beforeEach(() => {
    f = editorialFixture();
  });
  afterEach(() => f.cleanup());
  it('uses product evidence without entertainment research and replays after reopening', async () => {
    const ideas = vi.spyOn(f.provider, 'ideas');
    const scripts = vi.spyOn(f.provider, 'script');
    const input = { ...f.input, researchShortlistId: null };
    const first = await f.flow().generate(input);
    expect(ideas.mock.calls[0][0].shortlist).toBeNull();
    expect(f.research.getShortlist).not.toHaveBeenCalled();
    expect(first.script.fullNarration).toContain('Publicidade');
    expect(await f.flow().generate(input)).toEqual(first);
    expect(scripts).toHaveBeenCalledTimes(1);
    expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('passes exact Shopee provenance and commercial revisions to the existing flow, replays and detects source changes', async () => {
    provisionSchema(f.base.db, 42);
    const repo = new SqliteAffiliatePersistence(f.database).open();
    const campaign = repo.getCampaign('camp_001', 1)!;
    repo.registerCampaign(
      {
        ...campaign,
        revision: 2,
        affiliateUrl: 'https://s.shopee.com.br/offline',
      },
      'shopee_campaign',
      true,
    );
    const source = repo.associateCampaignSource(
      {
        schemaVersion: 'affiliate-campaign-source/1.0.0',
        sourceId: 'source_001',
        revision: 1,
        source: 'SHOPEE_AFFILIATE_API',
        offer: {
          offerId: 'offer-001',
          productId: 'external-001',
          shopId: null,
          provenance: {
            source: 'FAKE',
            fixtureVersion: 'offline/1',
            observedAt: null,
          },
        },
        campaignId: 'camp_001',
        campaignRevision: 2,
        productId: 'prod_001',
        productRevision: 1,
        briefingId: 'brief_shopee',
        affiliateUrl: 'https://s.shopee.com.br/offline',
      },
      'shopee_source',
      ['authorized-image-001'],
    );
    repo.close();
    const input = { ...f.input, briefingId: 'brief_shopee' };
    const ideas = vi.spyOn(f.provider, 'ideas');
    const scripts = vi.spyOn(f.provider, 'script');
    const first = await f.flow().generate(input);
    const briefing = f.affiliate.resolveRunBriefing(input.pipelineRunId)!;
    expect(ideas.mock.calls[0][0].shortlist).toEqual(f.shortlist);
    expect(ideas.mock.calls[0][0].briefing).toEqual(briefing);
    expect(ideas.mock.calls[0][0]).toMatchObject({
      campaignSource: source,
      briefing: { campaignRevision: 2, productRevision: 1 },
    });
    expect(scripts.mock.calls[0][0].campaignSource).toEqual(source);
    expect(await f.flow().generate(input)).toEqual(first);
    expect(ideas).toHaveBeenCalledTimes(1);
    vi.spyOn(f.catalog, 'resolveBriefingSource').mockResolvedValue({
      ...source,
      revision: 2,
    });
    await expect(f.flow().generate(input)).rejects.toMatchObject({
      code: 'AFFILIATE_SCRIPT_CONTEXT_CONFLICT',
    });
    for (const table of [
      'cost_events',
      'campaign_executions',
      'script_generation_requests',
    ])
      expect(
        f.base.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,
      ).toBe(0);
    expect(f.base.db.prepare('SELECT COUNT(*) n FROM scripts').get()?.n).toBe(
      1,
    );
  });
  it('preserves non-Shopee briefings without deriving provenance from their URLs', async () => {
    provisionSchema(f.base.db, 42);
    const ideas = vi.spyOn(f.provider, 'ideas');
    await f.flow().generate(f.input);
    expect(ideas.mock.calls[0][0].campaignSource).toBeNull();
  });
  it('selects an eligible product, produces ideas and script, preserves evidence, CTA and disclosure; replays after reopening', async () => {
    expect(f.base.db.prepare('PRAGMA user_version').get()?.user_version).toBe(
      40,
    );
    const ideas = vi.spyOn(f.provider, 'ideas');
    const scripts = vi.spyOn(f.provider, 'script');
    const first = await f.flow().generate(f.input);
    const briefing = f.affiliate.resolveRunBriefing('run_001')!;
    expect(first.script.cta).toBe(briefing.cta);
    expect(first.script.fullNarration).toContain(briefing.disclosure);
    expect(first.script.fullNarration).toContain(briefing.productName);
    expect(first.script.contentHash).toBe(scriptContentHash(first.script));
    expect(first.cost.amount).toBeNull();
    expect((await f.flow().generate(f.input)).script).toEqual(first.script);
    expect(ideas).toHaveBeenCalledTimes(1);
    expect(scripts).toHaveBeenCalledTimes(1);
    expect(
      f.base.db.prepare('SELECT COUNT(*) AS n FROM cost_events').get()?.n,
    ).toBe(0);
    const s = f.operations.open(true);
    try {
      expect(
        s.stages.getLatestAttempt('run_001', 'SCRIPT')?.result?.value,
      ).toMatchObject({ cost: { amount: null } });
    } finally {
      s.close();
    }
  });
  it('rejects ineligible briefing and research outside run scope before generation', async () => {
    const ideas = vi.spyOn(f.provider, 'ideas');
    await expect(
      f.flow().generate({ ...f.input, briefingId: 'missing' }),
    ).rejects.toMatchObject({ code: 'AFFILIATE_BRIEFING_NOT_FOUND' });
    f.research.getShortlist.mockReturnValue({
      ...f.research.getShortlist()!,
      projectId: 'other',
    });
    await expect(f.flow().generate(f.input)).rejects.toMatchObject({
      code: 'EDITORIAL_RESEARCH_SCOPE_MISMATCH',
    });
    expect(ideas).not.toHaveBeenCalled();
  });
  it('rejects reused request identity and persists script revisions', async () => {
    const first = await f.flow().generate(f.input);
    await expect(
      f.flow().generate({ ...f.input, requestedAt: '2026-10-14T12:02:00Z' }),
    ).rejects.toMatchObject({ code: 'AFFILIATE_SCRIPT_CONTEXT_CONFLICT' });
    const next = await f.flow().generate({
      ...f.input,
      generationRequestId: 'editorial_gen_002',
      supersedesScriptId: first.script.scriptId,
    });
    expect(next.script.revision).toBe(2);
    expect(next.script.supersedesScriptId).toBe(first.script.scriptId);
    expect(next.script.editorialSelectionId).toBe(
      first.script.editorialSelectionId,
    );
  });
  it('prevents duplicate concurrent provider calls', async () => {
    let release!: () => void;
    const original = f.provider.ideas.bind(f.provider);
    const ideas = vi
      .spyOn(f.provider, 'ideas')
      .mockImplementation(async (input) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return original(input);
      });
    const first = f.flow().generate(f.input);
    await vi.waitFor(() => expect(ideas).toHaveBeenCalledTimes(1));
    await expect(f.flow().generate(f.input)).rejects.toMatchObject({
      code: 'STAGE_ALREADY_RUNNING',
    });
    release();
    await first;
    expect(ideas).toHaveBeenCalledTimes(1);
  });
  it('reports provider unavailable explicitly with durable failure evidence', async () => {
    vi.spyOn(f.provider, 'ideas').mockRejectedValue(
      new Error('secret provider detail'),
    );
    await expect(f.flow().generate(f.input)).rejects.toMatchObject({
      code: 'EDITORIAL_PROVIDER_UNAVAILABLE',
    });
    const s = f.operations.open(true);
    try {
      expect(
        s.stages.getLatestAttempt('run_001', 'IDEA_GENERATION')?.failure?.code,
      ).toBe('EDITORIAL_PROVIDER_UNAVAILABLE');
    } finally {
      s.close();
    }
  });
  it('rejects malformed script responses explicitly', async () => {
    vi.spyOn(f.provider, 'script').mockResolvedValue(undefined as never);
    await expect(f.flow().generate(f.input)).rejects.toMatchObject({
      code: 'EDITORIAL_PROVIDER_INVALID_RESPONSE',
    });
  });
  it('recovers a completed generation after persistence failure without invoking the provider again', async () => {
    const scripts = vi.spyOn(f.provider, 'script');
    vi.spyOn(f.content, 'registerScript').mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    await expect(f.flow().generate(f.input)).rejects.toThrow(
      'storage unavailable',
    );
    const replay = await f.flow().generate(f.input);
    expect(replay.script.scriptId).toBe(
      `script:${f.input.generationRequestId}`,
    );
    expect(scripts).toHaveBeenCalledTimes(1);
  });
  it.each(['cta', 'disclosure', 'product', 'price'])(
    'blocks unsafe provider output: %s',
    async (kind) => {
      const original = f.provider.script.bind(f.provider);
      vi.spyOn(f.provider, 'script').mockImplementation(async (input) => {
        const output = await original(input);
        if (kind === 'cta') output.cta = 'Outro CTA';
        if (kind === 'disclosure')
          output.narrativeBlocks[0].narration = 'Conteúdo sem disclosure';
        if (kind === 'product') output.hook = 'Outro produto';
        if (kind === 'price') output.hook += ' R$ 99';
        return output;
      });
      await expect(f.flow().generate(f.input)).rejects.toThrow();
      expect(f.content.listScripts('run_001')).toEqual([]);
    },
  );
  it('blocks paid transport, including UNKNOWN, without invoking the provider', async () => {
    f.provider.mode = 'PAID';
    const ideas = vi.spyOn(f.provider, 'ideas');
    await expect(f.flow().generate(f.input)).rejects.toMatchObject({
      code: 'GLOBAL_PRICE_UNPROVEN',
    });
    f.finance.getGlobalOperation.mockReturnValue({ state: 'UNKNOWN' } as never);
    await expect(f.flow().generate(f.input)).rejects.toMatchObject({
      code: 'EDITORIAL_FINANCE_UNKNOWN',
    });
    expect(ideas).not.toHaveBeenCalled();
  });
});
