import { OllamaEditorialProvider } from './infrastructure/ollama-editorial.provider.js';
const input: any = {
  briefing: {
    productName: 'Travesseiro branco',
    attributes: [{ name: 'Cor', value: 'Branco', evidenceRef: 'spec' }],
    evidence: [{ id: 'spec', kind: 'PRODUCT_SPECIFICATION' }],
    cta: 'Veja os detalhes.',
    disclosure: 'Publicidade.',
  },
  shortlist: { orderedCandidates: [{ candidate: { id: 'candidate_1' } }] },
  projectSnapshot: { channel: { minDurationSeconds: 10 } },
};
it('uses only loopback structured local inference and literal verified facts', async () => {
  const send = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          done: true,
          response: JSON.stringify({ attributeIndexes: [0], hookIndex: 0 }),
        }),
      ),
  );
  const provider = new OllamaEditorialProvider(
    'gemma3:4b',
    send as typeof fetch,
  );
  const script = await provider.script(input);
  expect(script.narrativeBlocks[0].narration).toBe('Publicidade. Cor: Branco.');
  expect(script.cta).toBe(input.briefing.cta);
  expect(send.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/generate');
  const body = send.mock.calls[0][1].body;
  if (typeof body !== 'string') throw new Error('Expected JSON request body');
  expect(JSON.parse(body).stream).toBe(false);
  expect(provider.mode).toBe('LOCAL');
});
it.each([
  { attributeIndexes: [99], hookIndex: 0 },
  { attributeIndexes: [0, 0], hookIndex: 0 },
  { attributeIndexes: [0], hookIndex: 0, claim: 'cures pain' },
])('rejects ungrounded structured output %j', async (response) => {
  const p = new OllamaEditorialProvider(
    'gemma3:4b',
    async () =>
      new Response(
        JSON.stringify({ done: true, response: JSON.stringify(response) }),
      ),
  );
  await expect(p.script(input)).rejects.toThrow('OLLAMA_INVALID_RESPONSE');
});
it('fails closed on transport failure without fallback or paid calls', async () => {
  const send = vi.fn(async () => {
    throw Error('private transport details');
  });
  await expect(
    new OllamaEditorialProvider('gemma3:4b', send).script(input),
  ).rejects.toThrow('OLLAMA_UNAVAILABLE');
  expect(send).toHaveBeenCalledTimes(1);
});
it('renders readable factual labels and separates disclosure without inventing claims', async () => {
  const p = new OllamaEditorialProvider(
    'gemma3:4b',
    async () =>
      new Response(
        JSON.stringify({
          done: true,
          response: JSON.stringify({ attributeIndexes: [0], hookIndex: 0 }),
        }),
      ),
  );
  const script = await p.script({
    ...input,
    shortlist: null,
    briefing: {
      ...input.briefing,
      disclosure: 'Publicidade · Cena ilustrativa',
      attributes: [
        { name: 'material_declarado', value: 'plástico', evidenceRef: 'spec' },
      ],
    },
  });
  expect(script.narrativeBlocks[0].narration).toBe(
    'Publicidade · Cena ilustrativa. material declarado: plástico.',
  );
});
