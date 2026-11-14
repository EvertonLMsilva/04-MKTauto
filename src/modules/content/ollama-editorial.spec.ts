import { OllamaEditorialProvider } from './infrastructure/ollama-editorial.provider.js';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ContentModule } from './content.module.js';
import { EDITORIAL_PROVIDER } from './application/editorial-provider.port.js';
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

function kitInput(total = 14) {
  const counts = total === 14 ? [4, 4, 4, 2] : [2, 2, 2, 1];
  return {
    ...input,
    shortlist: null,
    projectSnapshot: { channel: { minDurationSeconds: 20 } },
    briefing: {
      ...input.briefing,
      productName: `Kit ${total} Organizadores Multiuso`,
      disclosure: 'Publicidade · Cena ilustrativa · Link de afiliado',
      cta: 'Confira os detalhes no link de afiliado!',
      attributes: [
        { name: 'variante_piloto', value: `KIT_${total}`, evidenceRef: 'spec' },
        { name: 'quantidade_total', value: String(total), evidenceRef: 'spec' },
        {
          name: `composicao_kit${total}`,
          value: `${counts[0]} x 7,5x7,5x5 cm; ${counts[1]} x 15x7,5x5 cm; ${counts[2]} x 23x7,5x5 cm; ${counts[3]} x 23x14,5x5 cm`,
          evidenceRef: 'spec',
        },
      ],
    },
  };
}
function kitProvider(indexes: number[]) {
  return new OllamaEditorialProvider(
    'gemma3:4b',
    async () =>
      new Response(
        JSON.stringify({
          done: true,
          response: JSON.stringify({ hookIndex: 0, attributeIndexes: indexes }),
        }),
      ),
  );
}
it.each([{ indexes: [0, 1, 2] }, { indexes: [] }])(
  'renders documented Kit14 counts with selector $indexes, without unsupported filler',
  async ({ indexes }) => {
    const source = kitInput();
    const result = await kitProvider(indexes).script(source);
    const text = [
      result.hook,
      ...result.narrativeBlocks.map((b) => b.narration),
      result.cta,
    ].join(' ');
    expect(text).toContain('14 peças');
    expect(text).toMatch(/4, 4, 4 e duas peças/);
    expect(text).toContain(source.briefing.disclosure);
    expect(result.cta).toBe(source.briefing.cta);
    expect(text.split(/\s+/).length).toBeGreaterThanOrEqual(36);
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(50);
    expect(text).not.toMatch(
      /variante_piloto|composicao_kit|plástico|acrílico|resistente|durável|R\$|estoque/iu,
    );
    expect(result.visualDirections).toHaveLength(1);
    expect(result.sensitiveClaims).toEqual([]);
    expect(kitProvider([]).configurationVersion).toMatch(
      /^ollama-grounded\/3:/,
    );
  },
);
it('renders another documented kit without campaign-specific quantities or identity', async () => {
  const result = await kitProvider([0, 1, 2]).script(kitInput(7));
  const text = result.narrativeBlocks[0].narration;
  expect(text).toContain('7 peças');
  expect(text).toMatch(/duas, duas, duas e uma peça/);
  expect(text).not.toContain('14');
});
it.each(['mismatched count', 'wrong variant', 'invalid dimensions'])(
  'rejects %s rather than inventing or silently dropping the kit facts',
  async (condition) => {
    const source = kitInput();
    if (condition === 'mismatched count')
      source.briefing.attributes[1].value = '15';
    if (condition === 'wrong variant')
      source.briefing.attributes[0].value = 'KIT_7';
    if (condition === 'invalid dimensions')
      source.briefing.attributes[2].value = '4 x -7,5x7,5x5 cm';
    await expect(kitProvider([0, 1, 2]).script(source)).rejects.toThrow(
      'OLLAMA_PRODUCT_EVIDENCE_REQUIRED',
    );
  },
);

it('preserves unrelated free-form variant/quantity fields as unknown, without inventing unit claims', async () => {
  const source = {
    ...input,
    briefing: {
      ...input.briefing,
      attributes: [
        { name: 'variante_piloto', value: 'AZUL', evidenceRef: 'spec' },
        { name: 'quantidade_total', value: 'um par', evidenceRef: 'spec' },
      ],
    },
  };
  const result = await kitProvider([0, 1]).script(source);
  expect(result.narrativeBlocks[0].narration).toBe('Publicidade.');
});
it('fails closed when the configured duration cannot fit required documented kit facts', async () => {
  const source = kitInput();
  source.projectSnapshot.channel.minDurationSeconds = 12;
  await expect(kitProvider([]).script(source)).rejects.toThrow(
    'NARRATION_DURATION_REQUIRED',
  );
});

async function localServer(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

it('uses the configured local URL and fixed route with an explicitly allowed disposable port', async () => {
  const requests: string[] = [];
  const server = await localServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.end(
      JSON.stringify({
        done: true,
        response: JSON.stringify({ attributeIndexes: [], hookIndex: 0 }),
      }),
    );
  });
  try {
    const provider = new OllamaEditorialProvider(
      'gemma3:4b',
      fetch,
      server.url,
      [server.port],
    );
    await provider.ideas(input);
    expect(requests).toEqual(['POST /api/generate']);
    expect(provider.configurationVersion).toBe(
      new OllamaEditorialProvider('gemma3:4b').configurationVersion,
    );
  } finally {
    await server.close();
  }
});

it.each([
  'http://127.0.0.1:11434',
  'http://localhost:11434/',
  'http://[::1]:11434',
  'http://host.docker.internal:11434',
])('accepts the explicit local Ollama origin %s', async (url) => {
  const send = vi.fn(
    async (_url: string) =>
      new Response(
        JSON.stringify({
          done: true,
          response: JSON.stringify({ attributeIndexes: [], hookIndex: 0 }),
        }),
      ),
  );
  const provider = new OllamaEditorialProvider(
    'gemma3:4b',
    send as typeof fetch,
    url,
  );
  await provider.ideas(input);
  expect(send.mock.calls[0][0]).toBe(`${url.replace(/\/$/, '')}/api/generate`);
});

it.each([
  'https://127.0.0.1:11434',
  'http://example.com:11434',
  'http://127.0.0.1:22',
  'http://host.docker.internal:80',
  'http://user:secret@localhost:11434',
  'http://localhost:11434/path',
  'http://localhost:11434/?x=1',
  'http://localhost:11434/#x',
  'http://127.1:11434',
  'http://2130706433:11434',
  'http://localhost:65536',
  ' http://localhost:11434',
  'http://localhost:11434\n',
  'file:///localhost:11434',
])('rejects unexpected Ollama destinations before transport: %s', (url) => {
  const send = vi.fn();
  expect(() => new OllamaEditorialProvider('gemma3:4b', send, url)).toThrow(
    'OLLAMA_BASE_URL_INVALID',
  );
  expect(send).not.toHaveBeenCalled();
});

it('injects OLLAMA_BASE_URL through the existing module factory', async () => {
  vi.stubEnv('CONTENT_EDITORIAL_PROVIDER', 'ollama');
  vi.stubEnv('OLLAMA_MODEL', 'gemma3:4b');
  vi.stubEnv('OLLAMA_BASE_URL', 'http://host.docker.internal:11434');
  const send = vi.fn(
    async (_url: string) =>
      new Response(
        JSON.stringify({
          done: true,
          response: JSON.stringify({ attributeIndexes: [], hookIndex: 0 }),
        }),
      ),
  );
  vi.stubGlobal('fetch', send);
  try {
    const binding = Reflect.getMetadata('providers', ContentModule).find(
      (p: any) => p.provide === EDITORIAL_PROVIDER,
    );
    await binding.useFactory().ideas(input);
    expect(send.mock.calls[0][0]).toBe(
      'http://host.docker.internal:11434/api/generate',
    );
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

it('rejects actual HTTP redirects without following them', async () => {
  let requests = 0;
  const server = await localServer((_req, res) => {
    requests++;
    res.writeHead(302, { Location: '/unexpected' });
    res.end();
  });
  try {
    await expect(
      new OllamaEditorialProvider('gemma3:4b', fetch, server.url, [
        server.port,
      ]).ideas(input),
    ).rejects.toThrow('OLLAMA_UNAVAILABLE');
    expect(requests).toBe(1);
  } finally {
    await server.close();
  }
});

it('preserves the 90-second timeout and aborts a stalled local response', async () => {
  const server = await localServer(() => {});
  const original = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation(() => original(20));
  try {
    await expect(
      new OllamaEditorialProvider('gemma3:4b', fetch, server.url, [
        server.port,
      ]).ideas(input),
    ).rejects.toThrow('OLLAMA_UNAVAILABLE');
    expect(timeout).toHaveBeenCalledWith(90000);
  } finally {
    timeout.mockRestore();
    await server.close();
  }
});

it('rejects invalid JSON from a real disposable local service', async () => {
  const server = await localServer((_req, res) => {
    res.end('invalid');
  });
  try {
    await expect(
      new OllamaEditorialProvider('gemma3:4b', fetch, server.url, [
        server.port,
      ]).ideas(input),
    ).rejects.toThrow('OLLAMA_INVALID_RESPONSE');
  } finally {
    await server.close();
  }
});
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
    briefing: {
      ...input.briefing,
      attributes: [
        {
          name: 'organizacao_declarada',
          value: 'modular e compactável',
          evidenceRef: 'spec',
        },
      ],
    },
  });
  expect(script.narrativeBlocks[0].narration).toContain(
    'A organização informada pelo vendedor é modular e compactável.',
  );
  expect(script.narrativeBlocks[0].narration).not.toContain(
    'organizacao_declarada',
  );
});
it('uses the received store value and preserves terminal punctuation', async () => {
  const p = new OllamaEditorialProvider(
    'gemma3:4b',
    async () =>
      new Response(
        JSON.stringify({
          done: true,
          response: JSON.stringify({ attributeIndexes: [0], hookIndex: 1 }),
        }),
      ),
  );
  const script = await p.script({
    ...input,
    briefing: {
      ...input.briefing,
      productName: 'Organizador 2 em 1 e 3 em 1',
      attributes: [
        { name: 'loja_declarada', value: 'Outra Loja!', evidenceRef: 'spec' },
      ],
    },
  });
  expect(script.hook).toBe('Veja os detalhes de Organizador 2 em 1 e 3 em 1.');
  expect(script.narrativeBlocks[0].narration).toBe(
    'Publicidade. O anúncio é da loja Outra Loja!',
  );
  expect(script.cta).toBe('Veja os detalhes.');
});
it('keeps selected index order, omits unknown fields and respects the word limit', async () => {
  const p = new OllamaEditorialProvider(
    'gemma3:4b',
    async () =>
      new Response(
        JSON.stringify({
          done: true,
          response: JSON.stringify({
            attributeIndexes: [2, 1, 0],
            hookIndex: 0,
          }),
        }),
      ),
  );
  const script = await p.script({
    ...input,
    projectSnapshot: { channel: { minDurationSeconds: 8 } },
    briefing: {
      ...input.briefing,
      attributes: [
        { name: 'material_declarado', value: 'plástico', evidenceRef: 'spec' },
        { name: 'campo_desconhecido', value: 'não falar', evidenceRef: 'spec' },
        { name: 'loja_declarada', value: 'Loja Exemplo', evidenceRef: 'spec' },
      ],
    },
  });
  expect(script.narrativeBlocks[0].narration).toBe(
    'Publicidade. O anúncio é da loja Loja Exemplo.',
  );
  expect(script.narrativeBlocks[0].narration).not.toContain(
    'campo_desconhecido',
  );
  expect(script.narrativeBlocks[0].narration).not.toContain(
    'material_declarado',
  );
});
it('rejects attributes without product specification evidence', async () => {
  const send = vi.fn();
  await expect(
    new OllamaEditorialProvider('gemma3:4b', send).script({
      ...input,
      briefing: { ...input.briefing, evidence: [] },
    }),
  ).rejects.toThrow('OLLAMA_PRODUCT_EVIDENCE_REQUIRED');
  expect(send).not.toHaveBeenCalled();
});

it.each([0, 1, 4])(
  'bounds generation schema to the same %i facts accepted by validation',
  async (count) => {
    const send = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            done: true,
            response: JSON.stringify({ attributeIndexes: [], hookIndex: 0 }),
          }),
        ),
    );
    const attributes = Array.from({ length: count }, () => ({
      name: 'material_declarado',
      value: 'papel',
      evidenceRef: 'spec',
    }));
    await new OllamaEditorialProvider('gemma3:4b', send).ideas({
      ...input,
      briefing: { ...input.briefing, attributes },
    });
    const body = JSON.parse((send.mock.calls as any)[0][1].body);
    expect(body.format.properties.attributeIndexes.maxItems).toBe(
      Math.min(3, count),
    );
    if (count)
      expect(body.format.properties.attributeIndexes.items.enum).toEqual(
        attributes.map((_, i) => i),
      );
    else
      expect(
        body.format.properties.attributeIndexes.items.enum,
      ).toBeUndefined();
    expect(body.options).toEqual({
      temperature: 0,
      num_predict: 160,
      num_ctx: 2048,
    });
    expect(send).toHaveBeenCalledTimes(1);
  },
);
