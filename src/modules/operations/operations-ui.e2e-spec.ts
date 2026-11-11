import { Test } from '@nestjs/testing';
import request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { Script, createContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { facebookPublicationFixture } from '../../../test/support/facebook-publication.fixture.js';
import { PublishingController } from '../publishing/publishing.controller.js';
import { PublishingService } from '../publishing/application/publishing.service.js';
import { InstagramPublicationService } from '../publishing/application/instagram-publication.service.js';
import { DestinationPublicationController } from '../publishing/destination-publication.controller.js';
import { DestinationPublicationService } from '../publishing/application/destination-publication.service.js';
import { SocialPublicationRepository } from '../publishing/infrastructure/social-publication.repository.js';
import { DestinationReservationsRepository } from '../publishing/infrastructure/destination-reservations.repository.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';

test('browser shell, real session lifecycle and guarded actions use local mocks only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p7-ui-'));
  const file = join(root, 'identities.json'),
    secret = 'A'.repeat(43),
    salt = 'b'.repeat(32);
  const record = {
    id: 'operator_ui',
    salt,
    hash: scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 67108864,
    }).toString('hex'),
    roles: ['QC_REVIEWER'],
    revoked: false,
  };
  await writeFile(file, JSON.stringify({ version: 1, identities: [record] }), {
    mode: 0o600,
  });
  vi.stubEnv('QC_IDENTITIES_FILE', file);
  const execution = {
    execution_id: 'execution_ui',
    campaign_id: 'Campanha de teste offline',
    status: 'WAITING_INPUT',
    finalization: {
      step: 'MEDIA_QC',
      completedSteps: [],
      pending: {
        code: 'COMPLETE_TEMPORAL_QC_REQUIRED',
        message: 'Revise a mídia autorizada antes de continuar.',
      },
      availableActions: ['REVIEW_MEDIA'],
    },
  };
  const mock = {
    list: vi.fn(() => [execution]),
    detail: vi.fn(() => ({ execution, media: [], script: null })),
    advance: vi.fn(async () => execution),
    retry: vi.fn(async () => execution),
    audioMode: vi.fn(async () => execution),
    reviseScript: vi.fn(async () => execution),
    instagramConnection: vi.fn(() => ({
      connection: 'NOT_CONFIGURED',
      missingPermissions: null,
      livePublication: { eligible: false },
    })),
    checkInstagramConnection: vi.fn(async () => ({
      connection: 'READY',
      missingPermissions: [],
      livePublication: { eligible: false },
    })),
  };
  const module = await Test.createTestingModule({
    controllers: [OperationsController],
    providers: [{ provide: OperationsService, useValue: mock }],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  const browser = request.agent(app.getHttpServer());
  const origin = (query: ReturnType<typeof browser.post>) =>
    query.set('Host', 'localhost:3000').set('Origin', 'http://localhost:3000');
  try {
    const page = await browser
      .get('/operations')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Content-Type', /html/);
    expect(page.text).toContain(
      '<select id="script-revision-select" name="scriptId" required',
    );
    expect(page.text).not.toContain('<input name="scriptId"');
    const script = await browser.get('/operations/app.js').expect(200);
    expect(script.text).toContain('option.value = revision.scriptId');
    expect(script.text).toContain(
      'Uma revisão mais curta precisa estar cadastrada',
    );
    expect(script.text).not.toContain('POST /content/scripts');
    expect(script.text).toContain('action !== "SCRIPT_REVISION_REQUIRED"');
    expect(() => new Script(script.text)).not.toThrow();
    await browser
      .get('/operations/executions/execution_ui/narration.wav')
      .expect(401);
    await origin(
      browser.post(
        '/operations/executions/execution_ui/composition-authorization',
      ),
    )
      .send({})
      .expect(401);
    await browser.get('/operations/instagram/connection').expect(401);
    await origin(browser.post('/operations/instagram/connection/check'))
      .send({})
      .expect(401);
    await browser
      .post('/operations/session')
      .set('Host', 'evil.example')
      .set('Origin', 'http://evil.example')
      .send({ operatorId: record.id, secret })
      .expect(403);
    const login = await origin(browser.post('/operations/session'))
      .send({ operatorId: record.id, secret })
      .expect(201);
    expect(login.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(login.body).toEqual({
      operatorId: record.id,
      csrfToken: expect.any(String),
    });
    await browser
      .get('/operations/instagram/connection')
      .set('Host', 'localhost:3000')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect(({ body }) => expect(body.connection).toBe('NOT_CONFIGURED'));
    expect(mock.checkInstagramConnection).not.toHaveBeenCalled();
    await origin(browser.post('/operations/instagram/connection/check'))
      .send({})
      .expect(403);
    await browser
      .post('/operations/instagram/connection/check')
      .set('Host', 'localhost:3000')
      .set('Origin', 'http://attacker.example')
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(403);
    await origin(browser.post('/operations/instagram/connection/check'))
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          connection: 'READY',
          livePublication: { eligible: false },
        }),
      );
    expect(mock.checkInstagramConnection).toHaveBeenCalledTimes(1);
    await origin(browser.post('/operations/executions/execution_ui/audio-mode'))
      .send({ mode: 'RECORDING' })
      .expect(403);
    await origin(browser.post('/operations/executions/execution_ui/audio-mode'))
      .set('x-qc-csrf', login.body.csrfToken)
      .send({ mode: 'RECORDING' })
      .expect(201);
    expect(mock.audioMode).toHaveBeenCalledTimes(1);
    await origin(
      browser.post('/operations/executions/execution_ui/script-revision'),
    )
      .send({})
      .expect(403);
    await origin(
      browser.post('/operations/executions/execution_ui/script-revision'),
    )
      .set('x-qc-csrf', login.body.csrfToken)
      .send({ scriptId: 'new_script' })
      .expect(201);
    expect(mock.reviseScript).toHaveBeenCalledWith(
      'execution_ui',
      { scriptId: 'new_script' },
      expect.anything(),
    );
    await browser
      .get('/operations/executions')
      .set('Host', 'localhost:3000')
      .expect(200);
    await origin(browser.post('/operations/executions/execution_ui/advance'))
      .send({})
      .expect(403);
    await browser
      .post('/operations/executions/execution_ui/advance')
      .set('Host', 'localhost:3000')
      .set('Origin', 'http://attacker.example')
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(403);
    await origin(browser.post('/operations/executions/execution_ui/advance'))
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(201);
    expect(mock.advance).toHaveBeenCalledTimes(1);
    await origin(browser.post('/operations/logout'))
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(201);
    await origin(
      browser.post('/operations/executions/execution_ui/script-revision'),
    )
      .send({})
      .expect(401);
    await browser
      .get('/operations/executions')
      .set('Host', 'localhost:3000')
      .expect(401);
  } finally {
    await app.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

// DOM and provider ports are simulated; served JavaScript, HTTP contracts,
// commercial validation, Finance and SQLite persistence are exercised together.
class CommercialDomNode {
  hidden = false;
  disabled = false;
  required = false;
  readOnly = false;
  checked = false;
  value = '';
  dataset: Record<string, string> = {};
  children: CommercialDomNode[] = [];
  elements: Record<string, CommercialDomNode> = {};
  listeners: Record<string, (event: any) => unknown> = {};
  private content = '';
  constructor(readonly tag = 'div') {}
  get textContent(): string {
    return this.content + this.children.map((n) => n.textContent).join('');
  }
  set textContent(value: string) {
    this.content = String(value);
    this.children = [];
  }
  append(...nodes: CommercialDomNode[]) {
    this.children.push(...nodes);
    if (this.tag === 'select' && !this.value && nodes.length)
      this.value = nodes[0].value;
  }
  replaceChildren(...nodes: CommercialDomNode[]) {
    this.content = '';
    this.children = [];
    this.value = '';
    this.append(...nodes);
  }
  addEventListener(name: string, listener: (event: any) => unknown) {
    this.listeners[name] = listener;
  }
  async fire(name: string) {
    await this.listeners[name]?.({ target: this, preventDefault() {} });
  }
  querySelector() {
    return this.children[0] ?? new CommercialDomNode('button');
  }
  getAttribute(key: string) {
    return (this as any)[key] ?? null;
  }
  removeAttribute(key: string) {
    delete (this as any)[key];
  }
  reset() {
    for (const field of Object.values(this.elements)) {
      field.value = (field as any).defaultValue ?? '';
      field.checked = false;
    }
  }
}

async function commercialUiFixture() {
  const f = await facebookPublicationFixture();
  const identities = join(dirname(f.f.database), 'ui-identities.json');
  const secret = 'B'.repeat(43),
    salt = 'c'.repeat(32);
  await writeFile(
    identities,
    JSON.stringify({
      version: 1,
      identities: [
        {
          id: 'operator_commercial',
          salt,
          hash: scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
            N: 32768,
            r: 8,
            p: 1,
            maxmem: 67108864,
          }).toString('hex'),
          roles: ['QC_REVIEWER'],
          revoked: false,
        },
      ],
    }),
  );
  vi.stubEnv('QC_IDENTITIES_FILE', identities);
  const external = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('EXTERNAL_CALL_FORBIDDEN'));
  const social = new SocialPublicationRepository({ db: f.f.base.db });
  const patch = (id: string, change: Record<string, unknown>) => {
    const { contentHash: _hash, ...body } = social.get(id);
    const next = { ...body, ...change };
    f.f.base.db
      .prepare(
        'UPDATE social_publication_operations SET payload_json=? WHERE operation_id=?',
      )
      .run(JSON.stringify({ ...next, contentHash: affiliateHash(next) }), id);
  };
  const addFacebook = () => {
    const review = f.approve(f.facebookPackage);
    const op = social.prepare(
      {
        packageHash: f.facebookPackage.contentHash,
        accountId: 'facebook_reels:1355505384315575',
        network: 'FACEBOOK_REELS',
        mediaHash: f.hash,
      },
      'ui_facebook',
      f.at,
    );
    new DestinationReservationsRepository(f.f.base.db).reserve(
      f.execution.execution_id,
      op,
      f.facebookPackage,
      review.contentHash,
      f.at,
    );
    patch(op.operationId, {
      state: 'PUBLISHED',
      mediaId: '987654321',
      requiresReconciliation: false,
      remoteReceipt: {
        mediaId: '987654321',
        publishedAt: f.at,
        permalink: null,
      },
    });
    return op.operationId;
  };
  const destinations = f.reopen();
  const publish = vi.spyOn(destinations, 'execute');
  const instagramPublish = vi.spyOn(f.instagram, 'execute');
  const uiExecution = {
    ...f.execution,
    status: 'SUCCEEDED',
    finalization: { step: 'DONE', completedSteps: [] },
  };
  const module = await Test.createTestingModule({
    controllers: [
      OperationsController,
      PublishingController,
      DestinationPublicationController,
    ],
    providers: [
      {
        provide: OperationsService,
        useValue: {
          list: () => [uiExecution],
          detail: () => ({ execution: uiExecution, media: [], script: null }),
          instagramConnection: () => ({
            connection: 'NOT_CONFIGURED',
            livePublication: { eligible: false },
          }),
          instagramStatus: () => ({
            configuration: { mode: 'fake' },
            schedule: { status: 'PUBLISHED' },
            operation: social.get(f.ig.operationId),
          }),
        },
      },
      { provide: PublishingService, useValue: f.publishing },
      { provide: InstagramPublicationService, useValue: f.instagram },
      { provide: DestinationPublicationService, useValue: destinations },
    ],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  const agent = request.agent(app.getHttpServer());
  const login = await agent
    .post('/operations/session')
    .set('Host', 'localhost:3000')
    .set('Origin', 'http://localhost:3000')
    .send({ operatorId: 'operator_commercial', secret })
    .expect(201);
  const calls: { path: string; method: string; body?: any }[] = [];
  let loseResponse = false;
  async function browser() {
    const html = (await agent.get('/operations').expect(200)).text;
    const js = (await agent.get('/operations/app.js').expect(200)).text;
    const nodes = new Map<string, CommercialDomNode>();
    for (const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g))
      nodes.set(match[2], new CommercialDomNode(match[1]));
    const node = (id: string) => {
      const value = nodes.get(id);
      if (!value) throw new Error('Missing HTML element: ' + id);
      return value;
    };
    for (const form of html.matchAll(
      /<form id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g,
    )) {
      for (const field of form[2].matchAll(
        /<(input|select|textarea)\b([^>]*)>/g,
      )) {
        const name = /\bname="([^"]+)"/.exec(field[2])?.[1];
        if (!name) continue;
        const id = /\bid="([^"]+)"/.exec(field[2])?.[1];
        const element = id ? node(id) : new CommercialDomNode(field[1]);
        if (field[1] === 'select') {
          const remaining = form[2].slice(field.index! + field[0].length);
          element.value = /<option value="([^"]+)"/.exec(remaining)?.[1] ?? '';
        }
        (element as any).defaultValue = element.value;
        node(form[1]).elements[name] = element;
      }
    }
    const pending = new Set<Promise<any>>();
    const fetchLocal = (path: string, options: any = {}) => {
      const action = (async () => {
        const method = options.method ?? 'GET';
        const body = options.body ? JSON.parse(options.body) : undefined;
        calls.push({ path, method, body });
        if (
          !path.startsWith('/') ||
          (method !== 'GET' && !path.endsWith('/commercial-results'))
        )
          throw new Error('FORBIDDEN_UI_EFFECT: ' + path);
        const query =
          method === 'GET' ? agent.get(path) : agent.post(path).send(body);
        query
          .set('Host', 'localhost:3000')
          .set('Origin', 'http://localhost:3000');
        for (const [key, value] of Object.entries(options.headers ?? {}))
          query.set(key, String(value));
        const response = await query;
        if (loseResponse && method === 'POST') {
          loseResponse = false;
          throw new Error('OFFLINE_RESPONSE_LOST');
        }
        return {
          ok: response.status < 400,
          status: response.status,
          json: async () => response.body,
        };
      })();
      pending.add(action);
      void action.finally(() => pending.delete(action)).catch(() => {});
      return action;
    };
    const drain = async () => {
      for (let i = 0; i < 30; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!pending.size) return;
        await Promise.allSettled(pending);
      }
      throw new Error('UI did not settle');
    };
    new Script(js).runInContext(
      createContext({
        document: {
          getElementById: node,
          createElement: (tag: string) => new CommercialDomNode(tag),
        },
        fetch: fetchLocal,
        crypto: { randomUUID },
        FormData: class {
          constructor(private form: CommercialDomNode) {}
          get(name: string) {
            return this.form.elements[name]?.value ?? null;
          }
        },
        setTimeout: vi.fn(),
        clearTimeout: vi.fn(),
      }),
    );
    await drain();
    await node('execution-list').children[0].fire('click');
    await drain();
    return { node, drain, form: node('commercial-form').elements };
  }
  return {
    ...f,
    patch,
    addFacebook,
    browser,
    calls,
    social,
    agent,
    loseNextResponse: () => {
      loseResponse = true;
    },
    close: async () => {
      expect(external).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(instagramPublish).not.toHaveBeenCalled();
      expect(f.posts).toEqual([]);
      await app.close();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      f.cleanup();
    },
    csrf: login.body.csrfToken,
  };
}

function measurementForm(form: Record<string, CommercialDomNode>) {
  form.periodStart.value = '2026-11-08T00:00';
  form.periodEnd.value = '2026-11-09T00:00';
  form.sourceReference.value = 'Relatório autorizado do afiliado';
  form.attribution.value = 'DIRECT_PUBLICATION';
}

test.each(['instagram', 'facebook'])(
  'commercial UI: %s, valid/invalid entry, UNKNOWN, zero, correction and reload',
  async (network) => {
    const f = await commercialUiFixture();
    try {
      let operation = f.ig.operationId;
      if (network === 'facebook') {
        operation = f.addFacebook();
        f.patch(f.ig.operationId, {
          state: 'UNCERTAIN',
          requiresReconciliation: true,
        });
      }
      const ui = await f.browser();
      expect(ui.node('commercial-summary').textContent).toContain(
        'Nenhum resultado registrado',
      );
      expect(ui.node('commercial-summary').textContent).toContain(
        network === 'facebook' ? 'Facebook' : 'Instagram',
      );
      expect(ui.node('commercial-summary').textContent).toContain('PUBLISHED');
      expect(ui.node('commercial-summary').textContent).toContain(
        'Fone de exemplo',
      );
      expect(ui.node('commercial-summary').textContent).not.toContain(
        '[object Object]',
      );
      expect(ui.node('commercial-content').textContent).toContain(
        'Produto autorizado',
      );
      measurementForm(ui.form);
      ui.form.periodEnd.value = '2026-11-07T00:00';
      await ui.node('commercial-form').fire('submit');
      expect(ui.node('commercial-error').textContent).toContain('período');
      expect(
        f.publishing.commercialSummary({ kind: 'operation', id: operation })
          .history,
      ).toHaveLength(0);
      ui.form.periodEnd.value = '2026-11-09T00:00';
      await ui.node('commercial-form').fire('submit');
      expect(ui.node('commercial-summary').textContent).toContain(
        'Desconhecido',
      );
      expect(
        f.publishing.commercialSummary({ kind: 'operation', id: operation })
          .history,
      ).toHaveLength(1);
      const correction = ui
        .node('commercial-history')
        .children.flatMap((n) => n.children)
        .find((n) => n.tag === 'button')!;
      await correction.fire('click');
      expect(ui.form.sourceReference.readOnly).toBe(true);
      ui.form.clicks.value = '0';
      ui.form.sales.value = '0';
      ui.form.revenue.value = '0';
      ui.form.revenueCurrency.value = 'BRL';
      ui.form.commissions.value = '5';
      ui.form.commissionsCurrency.value = 'BRL';
      await ui.node('commercial-form').fire('submit');
      expect(ui.node('commercial-error').textContent).toContain(
        'justificativa',
      );
      ui.form.correctionReason.value = 'Correção conferida no relatório';
      f.loseNextResponse();
      await ui.node('commercial-form').fire('submit');
      await ui.node('commercial-form').fire('submit');
      const result = f.publishing.commercialSummary({
        kind: 'operation',
        id: operation,
      });
      expect(result.history).toHaveLength(2);
      expect(result.sales).toEqual({ status: 'KNOWN', value: 0 });
      expect(result.history[1].previousResultHash).toBe(
        result.history[0].contentHash,
      );
      expect(result.history[1].identity.operationId).toBe(operation);
      expect(result.history[1].actor).toBe('operator_commercial');
      expect(result.knownCost.status).toBe('UNKNOWN');
      expect(ui.node('commercial-summary').textContent).toContain('Vendas: 0');
      expect(ui.node('commercial-summary').textContent).toContain(
        'Lucro completo indisponível',
      );
      const reloaded = await f.browser();
      expect(reloaded.node('commercial-history').textContent).toContain(
        'Correção conferida',
      );
      expect(reloaded.node('commercial-history').textContent).toContain(
        'Revisão 2',
      );
      const posts = f.calls.filter((c) => c.method === 'POST');
      expect(
        posts.every((c) =>
          c.path.includes(
            '/social-operations/' +
              encodeURIComponent(operation) +
              '/commercial-results',
          ),
        ),
      ).toBe(true);
      expect(posts.at(-1)!.body.idempotencyKey).toBe(
        posts.at(-2)!.body.idempotencyKey,
      );
      expect(posts.at(-1)!.body.input).not.toHaveProperty('publicationId');
      expect(posts.at(-1)!.body.input).not.toHaveProperty('packageHash');
    } finally {
      await f.close();
    }
  },
);

test('commercial UI: unconfirmed operation blocks entry, refresh recovers and rapid submissions remain idempotent', async () => {
  const f = await commercialUiFixture();
  try {
    const original = f.social.get(f.ig.operationId);
    f.patch(f.ig.operationId, { state: 'PREPARED', remoteReceipt: null });
    const ui = await f.browser();
    expect(ui.node('commercial-form').hidden).toBe(true);
    expect(ui.node('commercial-error').textContent).toContain('confirmada');
    f.patch(f.ig.operationId, original);
    await ui.node('commercial-refresh').fire('click');
    expect(ui.node('commercial-form').hidden).toBe(false);
    measurementForm(ui.form);
    ui.form.clicks.value = '-1';
    await ui.node('commercial-form').fire('submit');
    expect(ui.node('commercial-error').textContent).toContain(
      'inteiros não negativos',
    );
    ui.form.clicks.value = '0';
    ui.form.attribution.value = 'CAMPAIGN_REPORTED';
    ui.form.commissions.value = '99999999999999999999.123456789012345678';
    ui.form.commissionsCurrency.value = 'BRL';
    const before = f.calls.filter((c) => c.method === 'POST').length;
    await Promise.all([
      ui.node('commercial-form').fire('submit'),
      ui.node('commercial-form').fire('submit'),
    ]);
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(before + 1);
    const summary = f.publishing.commercialSummary({
      kind: 'operation',
      id: f.ig.operationId,
    });
    expect(summary.history).toHaveLength(1);
    expect(summary.history[0].commissions.amount).toBe(
      '99999999999999999999.123456789012345678',
    );
    expect(summary.commission.status).toBe('UNKNOWN');
    expect(ui.node('commercial-summary').textContent).toContain(
      'Sem atribuição direta',
    );
    expect(ui.node('commercial-history').textContent).toContain(
      '99999999999999999999.123456789012345678 BRL',
    );
  } finally {
    await f.close();
  }
});

test('commercial UI: multiple destinations require selection, isolate histories and never add execution costs', async () => {
  const f = await commercialUiFixture();
  try {
    const fb = f.addFacebook();
    f.finance.register({
      schemaVersion: 'cost-event/1.0.0',
      costEventId: 'ui_cost',
      category: 'production_cost',
      pipelineRunId: 'run_001',
      projectId: 'project_001',
      projectVersion: 1,
      contentIdentity: null,
      artifactId: null,
      amount: '2.1',
      currency: 'BRL',
      occurredAt: f.at,
      recordedAt: f.at,
      origin: 'fixture_measured',
      attributionRuleVersion: 'fixture/1.0.0',
    });
    const ui = await f.browser();
    expect(ui.node('commercial-form').hidden).toBe(true);
    expect(ui.node('commercial-error').textContent).toContain('Selecione');
    expect(ui.node('commercial-publication').value).toBe('');
    for (const id of [fb, f.ig.operationId]) {
      ui.node('commercial-publication').value = id;
      await ui.node('commercial-publication').fire('change');
      expect(ui.node('commercial-summary').textContent).toContain(
        'Nenhum resultado registrado',
      );
      measurementForm(ui.form);
      ui.form.commissions.value = '5';
      ui.form.commissionsCurrency.value = 'BRL';
      await ui.node('commercial-form').fire('submit');
      expect(ui.node('commercial-summary').textContent).toContain('2.1 BRL');
      expect(ui.node('commercial-summary').textContent).toContain('2.9 BRL');
      expect(ui.node('commercial-summary').textContent).toContain(
        'não somar entre publicações',
      );
      expect(
        f.publishing.commercialSummary({ kind: 'operation', id }).history,
      ).toHaveLength(1);
    }
    f.patch(fb, { state: 'UNCERTAIN', requiresReconciliation: true });
    ui.node('commercial-publication').value = fb;
    await ui.node('commercial-publication').fire('change');
    expect(ui.node('commercial-form').hidden).toBe(true);
    expect(ui.node('commercial-error').textContent).toContain('confirmada');
    expect(ui.node('commercial-summary').textContent).toBe('');
  } finally {
    await f.close();
  }
});
