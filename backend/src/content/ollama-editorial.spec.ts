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
  expect(script.narrativeBlocks[0].narration).toBe('Publicidade.');
  expect(script.hook).toBe('Conheça Travesseiro branco.');
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
    'Publicidade · Cena ilustrativa. Segundo o vendedor, o material é plástico.',
  );
});
it('renders a documented organization field with its Portuguese accent', async () => {
  const p = new OllamaEditorialProvider('gemma3:4b', async () =>
    new Response(JSON.stringify({ done: true,
      response: JSON.stringify({ attributeIndexes: [0], hookIndex: 0 }) })));
  const script = await p.script({ ...input, briefing: { ...input.briefing,
    attributes: [{ name: 'organizacao_declarada', value: 'modular e compactável', evidenceRef: 'spec' }],
  } });
  expect(script.narrativeBlocks[0].narration).toContain('A organização informada pelo vendedor é modular e compactável.');
  expect(script.narrativeBlocks[0].narration).not.toContain('organizacao_declarada');
});
it('uses the received store value and preserves terminal punctuation', async () => {
  const p = new OllamaEditorialProvider('gemma3:4b', async () =>
    new Response(JSON.stringify({ done: true,
      response: JSON.stringify({ attributeIndexes: [0], hookIndex: 1 }) })));
  const script = await p.script({ ...input, briefing: { ...input.briefing,
    productName: 'Organizador 2 em 1 e 3 em 1',
    attributes: [{ name: 'loja_declarada', value: 'Outra Loja!', evidenceRef: 'spec' }],
  } });
  expect(script.hook).toBe('Veja os detalhes de Organizador 2 em 1 e 3 em 1.');
  expect(script.narrativeBlocks[0].narration).toBe('Publicidade. O anúncio é da loja Outra Loja!');
  expect(script.cta).toBe('Veja os detalhes.');
});
it('keeps selected index order, omits unknown fields and respects the word limit', async () => {
  const p = new OllamaEditorialProvider('gemma3:4b', async () =>
    new Response(JSON.stringify({ done: true,
      response: JSON.stringify({ attributeIndexes: [2, 1, 0], hookIndex: 0 }) })));
  const script = await p.script({ ...input,
    projectSnapshot: { channel: { minDurationSeconds: 8 } },
    briefing: { ...input.briefing,
      attributes: [
        { name: 'material_declarado', value: 'plástico', evidenceRef: 'spec' },
        { name: 'campo_desconhecido', value: 'não falar', evidenceRef: 'spec' },
        { name: 'loja_declarada', value: 'Loja Exemplo', evidenceRef: 'spec' },
      ],
    },
  });
  expect(script.narrativeBlocks[0].narration).toBe('Publicidade. O anúncio é da loja Loja Exemplo.');
  expect(script.narrativeBlocks[0].narration).not.toContain('campo_desconhecido');
  expect(script.narrativeBlocks[0].narration).not.toContain('material_declarado');
});
it('rejects attributes without product specification evidence', async () => {
  const send = vi.fn();
  await expect(new OllamaEditorialProvider('gemma3:4b', send).script({ ...input,
    briefing: { ...input.briefing, evidence: [] },
  })).rejects.toThrow('OLLAMA_PRODUCT_EVIDENCE_REQUIRED');
  expect(send).not.toHaveBeenCalled();
});
