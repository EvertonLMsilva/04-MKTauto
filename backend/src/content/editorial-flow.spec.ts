import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { contentStore } from '../../test/support/content-store.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { OperationsPersistence } from '../content-operations/infrastructure/operations.persistence.js';
import { ContentService } from './application/content.service.js';
import { EditorialFlowService } from './application/editorial-flow.service.js';
import { FakeEditorialProvider } from './infrastructure/fake-editorial.provider.js';
import { scriptContentHash } from './domain/script-contracts.js';

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
  const flow = () =>
    new EditorialFlowService(
      content,
      affiliate,
      research,
      operations,
      finance,
      provider,
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
