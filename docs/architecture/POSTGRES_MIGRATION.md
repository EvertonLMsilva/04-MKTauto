# PostgreSQL foundation — CORE-POSTGRES-001-T01

PostgreSQL is the selected principal database architecture: one database named `mktauto`, schemas owned by NestJS domains, one infrastructure-managed pool, and versioned PostgreSQL migrations. PG-001 implements the Project pilot; PG-002-RESEARCH adds the isolated Research adapter described below. Operational modules continue using SQLite. There is no cutover, real-data import, dual write, scheduler activation or deploy.

## Implemented boundary

- `platform.schema_migrations` owns global migration versions, names, exact SQL SHA256 checksums and application timestamps.
- `project.projects`, `project.project_snapshots` and `project.project_commands` belong to Project. No empty schemas for other domains are created.
- `research.*` belongs to Research and is introduced by migration 2. The Project migration remains unchanged.
- The module-owned migration is `PROJECT_POSTGRES_MIGRATIONS`, version 1, `001_project_foundation`. SQL is a versioned TypeScript constant, included in the compiled artifact without changing the existing SQLite asset pipeline. It is new PostgreSQL DDL, not an executable copy of SQLite migrations 003/004.
- Queries and DDL qualify table/schema names explicitly. Configuration pins the connection search path to `pg_catalog`; the migration transaction additionally clears its local search path.
- Binary media remains in external storage. Project stores structured snapshots/receipts and their existing references, not binary files.

## Private configuration, pool and lifecycle

`loadPostgresConfig()` requires explicit `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DATABASE=mktauto`, `POSTGRES_USER` and `POSTGRES_PASSWORD`. `POSTGRES_SSL` accepts `true` or `false`; true uses the driver's normal certificate verification. These variables do not select an adapter or run migrations. Keep credentials in a private environment; the example file contains comments only. There is no fallback to an existing `PG*` connection or another database.

`PostgresModule.register(config)` provides a single lazy `PostgresDatabase` pool per Nest application context. Configurable pool size and acquisition/idle timeouts are validated. `healthcheck()` performs a real `SELECT 1`; failures expose stable error codes without credentials, SQL, parameters or raw driver messages. `close()` is idempotent and is called by the Nest application shutdown lifecycle. Project repository handles never end this shared pool.

`transaction(async client => ...)` owns BEGIN/COMMIT/ROLLBACK and releases that client. Every statement in the unit of work must use the provided client; a separate pool query is not part of that transaction. Application errors retain their identity. Driver errors are sanitized and retain only safe SQLSTATE. A failed rollback discards the connection; cleanup does not replace the primary failure. There is no automatic retry of callbacks that might contain effects.

The default pg parsers remain unchanged: `NUMERIC` is returned as a decimal string, not coerced to JavaScript Number. A real `numeric(40,18)` precision test covers a 38-digit value. This pilot does not introduce Finance tables or convert any existing money.

## Explicit migration and Project opt-in

Migrations are administrative and explicit. Application startup never applies them. A caller holding an explicitly authorized private configuration can use:

```ts
const database = new PostgresDatabase(config);
try {
  await new PostgresMigrationRunner(database).migrate(
    PROJECT_POSTGRES_MIGRATIONS,
  );
} finally {
  await database.close();
}
```

The runner serializes concurrent invocations with a transaction-scoped advisory lock. Schema/ledger bootstrap, pending DDL and ledger entries commit together. Reexecution verifies the entire supplied history and applies nothing twice. Unknown/gapped history, renamed versions or changed checksums fail rather than rewriting history. A failing migration rolls back DDL and ledger changes. Future domain migrations extend the ordered registry; do not edit a migration already applied.

After explicit provisioning, a separate Nest application can import `ProjectModule.postgres(config)`. This dynamic entry uses a distinct module with PostgreSQL providers, not the SQLite providers from the default decorator. Importing `ProjectModule` continues to use SQLite. No operational bootstrap or automatic adapter-selection flag was added.

`PostgresProjectPersistence.open()` checks the existing migration identity/checksum and never provisions missing schemas. The existing Project controllers, command validation, payload hashing, DTOs, snapshot reader and domain transition rules are shared. There is no second business service for PostgreSQL.

### Minimal scope extension for asynchronous I/O

The original internal repository port and its callback were synchronous. `pg` cannot satisfy that contract using normal asynchronous I/O. Before implementation the scope extension was justified for exactly three existing files: `project-repository.port.ts`, `project-application.service.ts` and `project-command.service.ts`, plus their directly affected Project test.

The port and application service now have an asynchronous type parameter defaulting to the original synchronous behavior. SQLite source files remain untouched; synchronous callers and legacy fixture tests still receive values and synchronous validation failures. The PostgreSQL path opts into promises. The command service awaits open, execution/commit and handle close; asynchronous repository rejections receive the existing Project error mapping. Public HTTP/command contracts are unchanged.

## Project identity, storage and concurrency

- Existing textual project IDs are retained. Version columns are BIGINT with a safe-JavaScript-range check, preserving valid versions above int4 and through `Number.MAX_SAFE_INTEGER`; conversion is local to the Project adapter, never a global pg parser override.
- Native `json` columns preserve original snapshot/receipt JSON text. JSONB reordering is avoided because byte representations and existing payload hashes are part of parity evidence. Timestamps retain the contract's strings, including exact receipt representations; no implicit driver timezone conversion changes history.
- Primary keys, checks, native JSON validation, snapshot/command foreign keys, a deferred latest-snapshot FK and indexes protect integrity. PostgreSQL triggers reject snapshot mutation with SQLSTATE P1001 and command mutation with P1002. Existing history is append-only.
- A transaction advisory lock keyed by idempotency key precedes receipt lookup. Concurrent identical requests return the same committed receipt; a different command/hash with the same key preserves `IDEMPOTENCY_KEY_REUSED`.
- Row locks and the shared `assertProjectTransition` enforce optimistic expectedVersion and archive rules. Exactly one conflicting version writer succeeds; receipt and snapshot changes roll back together on any failure. Replay is checked before current-state transitions, so an old successful create/version command remains replayable after archival.
- Object immutability, canonicalization, sensitive-field rejection and public error codes/fields use the current domain/application code. A shared scenario compares PostgreSQL with a disposable SQLite schema39 fixture, including exact receipt JSON and hashes. Existing SQLite frozen-history tests remain unchanged.

## Directed SQLite inventory for subsequent migration design

This is a source/contract inventory, not an audit of LIVE databases. It reuses the existing migrations and adapters as historical references. The 53 SQL files contain 102 CREATE TABLE declarations, 217 CREATE TRIGGER declarations and 51 index declarations, including reconstruction tables, redefinitions and alternative lineages. These are source counts, not counts of effective objects in any operational database.

| Domain/responsibility       | Main current objects/families                                                                                                                                                               | Historical source                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Project                     | projects, project_snapshots, project_commands                                                                                                                                               | 003–004                                                              |
| Research                    | trend catalog/appearances/snapshots/clusters/scores, daily research/artifacts, reference analyses, insights and shortlists                                                                  | 001–002, 005–007                                                     |
| Content operations/campaign | pipeline_runs/transitions, recoveries/stage attempts, campaign_executions/events, claims, leases and campaign/day reservations                                                              | 008, 026, 041                                                        |
| Shared lineage              | artifact_lineage/inputs, written with ideas/scripts/media/render transactions                                                                                                               | 009                                                                  |
| Content                     | ideas/batches/evidence/scores, selections, scripts, generation requests/claims, editorial selection and transport gates                                                                     | 011–014, 030, 037–038                                                |
| Media                       | voice tracks/generation, media assets/acquisition, composition plans/segments, renders/compositions, subtitles, QC, video sources/selections, p4_artifacts                                  | 016–024, 027–028, 034 and framing extensions                         |
| Affiliate                   | product/campaign revisions, briefings, run bindings, script contexts, commands, discovery, campaign sources and Shopee journal                                                              | 029, 039, affiliate_campaign_source_v1 and TS journal                |
| Finance                     | cost events, telemetry, FAL/video budgets/billing, approvals/adjustments, TTS/global finance/risk dispatch                                                                                  | 010, 015, parallel 031/032 lineages, 033, 040 and finance extensions |
| Publishing                  | human approvals, manual distribution, social operations/commands/events, revocations, Instagram/multinetwork reservations, supersession/active ownership, captions/rights/context/schedules | 025, 035–036, 042–044, instagram_editorial_v1 and TS provisioning    |
| Notifications/platform      | projections/cursors over operational events; migration/extension lineage                                                                                                                    | current repositories and provisioner                                 |

Important DDL also exists outside SQL assets:

- `src/infrastructure/administration/schema-provisioner.ts` creates extension lineage and reconciles parallel historical 031/032 families; supported schemas extend through 44.
- `src/modules/affiliate/infrastructure/shopee-dynamic-journal.ts` creates the append-only Shopee journal without advancing global user_version.
- `src/modules/publishing/infrastructure/social-publication.repository.ts` and `src/infrastructure/administration/prepare-instagram-live.ts` provision fake/live provenance context and schedules. File identity and context protections cannot simply be dropped when changing storage technology.

Cross-domain atomicity must be designed before migrating those modules:

- ShopeeCatalogCommit shares one transaction for product, campaign and source.
- CampaignRepository relies on SQLite BEGIN IMMEDIATE while revalidating facts through synchronous ports, reserving notifications, advancing catalog cursors and claiming campaign/day executions.
- FinanceSession shares the ledger connection across commitments/readers/TTS and opens consistent read snapshots. Its current port directly exposes synchronous SQLite prepare/get/all/run semantics.
- PublishingPersistence builds an operational queue from execution, package, review, revocation and social-operation data in a read snapshot.
- Artifact lineage is written within Content/Media operations. Claims, leases, revocations, rights/QC gates and recovery evidence must remain transactional with their originating operation.

SQLite-specific dependencies include PRAGMA/user_version/sqlite_master, BEGIN IMMEDIATE, changes counts, rowid cursors, AUTOINCREMENT, INSERT OR IGNORE, typeof/GLOB/RAISE(ABORT), JSON functions and SQLite time functions. PublishingOperationsPersistence and CampaignRepository use rowid in cursor contracts. Finance keeps decimal values as text with exact comparisons. Several errors depend on SQLite constraint messages/SQLITE_BUSY. Constraints, triggers, partial indexes, deferred FKs, immutable history, reconciliation-pending states and lease ownership need explicit PostgreSQL designs, not placeholder substitutions or raw migration replay.

PostgreSQL adapters currently cover Project and Research only. The inventory above remains a historical source/contract map; other domains' repositories, databases, triggers and migrations are unchanged.

## Real isolated validation

Run `npm ci`, `npm run build`, then `npm run test:postgres` from the CORE worktree. The harness requires the already-local `postgres:18.6` image and uses `--pull=never`. It creates a unique container, dedicated bridge, localhost-only ephemeral port, random private credentials and tmpfs database. Existing connection URLs are never used. On this Docker engine an internal network suppressed port publication; a dedicated bridge provides the required loopback test access without joining any other project's network.

The fixture database must independently match `mktauto`, the test role and its unique database COMMENT marker before any destructive test SQL. Missing configuration fails; integration tests are not silently skipped. The harness removes only the container/network it owns, checked by unique labels, and removes its private temporary directory after validating its boundary. It does not create a persistent DB volume or query the operational PostgreSQL server.

Integration coverage on PostgreSQL 18.6 includes schemas/migrations, concurrent migration idempotence, checksum/history drift, transactional migration failure, commit/rollback/client release, decimal precision, native checks/FKs/JSON validation, full Project lifecycle and history, exact SQLite contract parity, concurrent idempotent requests, competing expectedVersions, receipt-failure rollback/retry, immutable triggers, int8 boundaries and the actual NestJS HTTP flow. A separate test confirms default ProjectModule remains SQLite.

Focused offline Project tests and compiled legacy tests cover the synchronous path. Full MKTauto migration, import of operational data, deployment, paid providers and LIVE cutover are outside this delivery. No paid business calls are made; local CPU/energy cost is unavailable, not assumed zero.

## Research — PG-002-RESEARCH-T01

Esta entrega fecha somente o domínio Research, dentro do programa PG-002. A aplicação operacional continua importando o `ResearchModule` SQLite. A ativação PostgreSQL exige uma aplicação isolada que importe explicitamente `ResearchModule.postgres(config)`; variáveis de ambiente não selecionam outro adapter automaticamente.

O módulo reutiliza `PostgresModule`, `PostgresDatabase`, o pool, o gerenciador de transações e `PostgresMigrationRunner` de PG-001. Não existe um segundo pool ou runner implementado por Research. Cada contexto Nest registra a infraestrutura uma vez e os handles do repository nunca encerram o pool compartilhado.

### Registro de migrations e schema

`RESEARCH_POSTGRES_MIGRATIONS` contém a versão 2, `002_research_foundation`. `RESEARCH_POSTGRES_MIGRATION_REGISTRY` concatena a migration Project v1 original e a nova v2. O provisionamento administrativo Research deve passar esse registro completo ao runner existente. O exemplo Project acima pertence a um banco PG-001: executar apenas o registro v1 contra um banco que já possui v2 resulta em erro de histórico, sem downgrade ou reescrita de checksums.

O schema `research` contém somente as 18 tabelas consumidas pelo repository Research:

| Responsabilidade            | Tabelas                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| Catálogos e operações       | trend_runs, source_runs, trend_operations                                                              |
| Identidade e histórico      | trend_candidates, candidate_appearances, trend_snapshots                                               |
| Clusters e ranking          | topic_clusters, topic_cluster_candidates, topic_cluster_snapshots, trend_scores, trend_score_snapshots |
| Pesquisa diária e evidência | research_daily_runs, research_daily_steps, research_artifacts                                          |
| Referências estratégicas    | reference_analysis_runs, reference_analysis_steps, reference_insights                                  |
| Shortlist                   | research_shortlists                                                                                    |

PKs, FKs, índices de deduplicação e unicidades de pipeline/revisão preservam os vínculos do SQLite. O trigger PostgreSQL de snapshots imutáveis usa SQLSTATE `P2001`. As relações são explicitamente qualificadas como `research.*`. Texto com collation `pg_catalog."C"` preserva identidade e ordenação binária; JSON preserva a representação original, sem normalização JSONB que altere hashes. Inteiros são convertidos localmente para números seguros do contrato. Durações e posições fracionárias aceitas pelo SQLite usam NUMERIC, sem truncamento para inteiro; parsers globais do driver não são modificados.

### Contratos e fronteira de I/O

Regras puras de validação, identidade, hash, linhagem, retry e estados são compartilhadas pelos adapters. Os SQL SQLite existentes permanecem iguais. Ranking, velocidade histórica, seleção e validação de evidências continuam usando as funções de domínio/aplicação existentes.

Os ports Research possuem modo assíncrono explícito, com o comportamento síncrono como padrão. Isso preserva os consumidores SQLite que compartilham uma conexão/transação com outros domínios; nenhum port externo desses módulos é alterado. O serviço aguarda open, trabalho transacional e close quando o adapter é PostgreSQL. A análise já assíncrona passa a aguardar leituras de histórico e a persistência antes de montar a resposta.

A shortlist utiliza um único algoritmo e um pequeno interpretador de etapas de I/O: resultados SQLite continuam síncronos, enquanto operações PostgreSQL são aguardadas. Não há uma segunda implementação de ranking, seleção, validação ou cálculo de hashes. O controller e seus códigos HTTP permanecem os mesmos.

As operações PostgreSQL usam a conexão fornecida pelo gerenciador existente durante toda a unidade de trabalho. O contexto assíncrono do handle permite chamadas aninhadas sem abrir uma transação independente. A serialização de writers de Research conserva a semântica de `BEGIN IMMEDIATE` para deduplicação, recibos idempotentes e atualizações de histórico. Leituras compostas não misturam conexões dentro da mesma transação. Handles read-only e fechados são protegidos; fechar um handle não encerra a infraestrutura.

### Validação e limite operacional

Os novos testes são incluídos automaticamente por `npm run test:postgres`, reutilizando a harness PG-001, PostgreSQL 18.6 local, porta loopback efêmera, tmpfs, credenciais aleatórias e marcador independente da database descartável. Nenhuma database existente é usada como fixture. A suíte compara cenários equivalentes com SQLite descartável, além dos testes congelados e HTTP SQLite existentes.

A validação cobre versões/checksums v1/v2, reexecução, rollback, catálogo e histórico, análise local, ranking determinístico, dados ausentes, estados/retomada de runs e steps, artifacts, shortlists, insights, evidências, erros, integridade referencial, concorrência e HTTP NestJS. Propostas locais de agrupamento substituem provedores externos nos testes. Não há chamada paga, scraping, migração de dados operacionais, dual write, deploy ou cutover. O programa PG-002 completo permanece fora do escopo desta entrega Research.

## Content — PG-002-CONTENT-T01

Esta entrega cobre somente Content. `ContentModule` continua SQLite; o opt-in isolado é `ContentModule.postgres(config, dependencies)`. `dependencies` exige os contratos de leitura Operations.get, Affiliate.resolveRunBriefing e Research.getShortlist/getInsight. Nenhum bootstrap operacional foi alterado. Não há dual write, importação real, deploy ou cutover.

`CONTENT_POSTGRES_MIGRATION_REGISTRY` estende o registro Research original com v3 `003_content_foundation`. O provisionamento é administrativo, explícito, pelo runner PG-001; startup verifica nome/checksum v3 e não executa DDL. v1/v2 não foram modificadas. A infraestrutura PG-001, o pool e o transaction manager são reutilizados.

O schema `content` contém nove tabelas: idea_batches, idea_candidates, idea_candidate_evidence, idea_scores, idea_selections, affiliate_editorial_selections, scripts, artifact_lineage e artifact_lineage_inputs. JSON nativo e parser local de texto preservam a representação armazenada; hashes continuam nas funções atuais. IDs/textos usam collation C, inteiros têm limite seguro e scores usam NUMERIC sem alteração dos parsers globais. FKs e unicidades internas, revisões contíguas, validação de inputs de linhagem e triggers imutáveis protegem o histórico.

Content é o proprietário do registro canônico PostgreSQL `content.artifact_lineage` e de seus inputs, usando o contrato existente em `content/domain/artifact-lineage-contracts.ts`. Uma futura migração Media deverá consumir esse mesmo registro na transação de seu artefato; não deverá criar outra tabela de linhagem. Media SQLite permanece inalterada. IDs externos de pipeline, projeto, briefing e Research são referências verificadas pelos ports de leitura, sem FKs inventadas para domínios/cópias ainda não participantes da mesma unidade transacional. Esse vínculo externo não é uma garantia de consistência distribuída.

Os três repositories usam uma única implementação das regras com etapas de I/O. A execução SQLite continua síncrona e mantém seus SQLs. O adapter PostgreSQL qualifica os nomes físicos conhecidos e converte placeholders estáticos para parâmetros $n. Não recebe SQL do usuário. Cada sessão reutiliza o mesmo PoolClient através do contexto assíncrono; writers serializam decisões com advisory lock do domínio e leituras compostas usam snapshot REPEATABLE READ READ ONLY. Erros do driver são sanitizados antes dos mappers públicos existentes. Fechar o handle não encerra o pool.

O serviço mantém seus contratos síncronos por padrão e aguarda open/operação/close no opt-in. O controller aguarda a resposta para mapear também rejeições assíncronas com os mesmos códigos HTTP. Seleção editorial afiliada e cadastro manual de roteiro apenas leem briefing/evidências e escrevem Content. O endpoint `editorial-generations` exige efeitos em Affiliate, Operations/recuperação e gates Finance; no opt-in ele retorna 409 `CONTENT_CROSS_DOMAIN_TRANSACTION_REQUIRED` antes de qualquer efeito. Claims, requests de geração e transport gates desse fluxo não são provisionados em PostgreSQL nesta entrega. Resolver sua unidade transacional é dependência explícita, sem simular transações distribuídas. Finance não é chamado pelo módulo PostgreSQL isolado.

Os testes novos reutilizam exclusivamente a harness PG-001 com PostgreSQL 18.6 real, tmpfs, rede própria, porta loopback efêmera e marcador independente da database. A fixture SQLite nova usa provisionamento e adapters atuais; as observações históricas existentes continuam congeladas. A cobertura inclui schema/ledger/checksum, reexecução, rollback/retry, ideias/scoring, seleções/roteiros/revisões, evidências/linhagem, replay/concorrência, erros, recuperação, paridade SQLite e HTTP NestJS com o bloqueio entre domínios. Não se declara o pipeline comercial nem o programa PG-002 integralmente migrado. Nenhuma chamada paga é executada; custo local de CPU/energia indisponível.

## Affiliate — PG-002-AFFILIATE-T01

Esta entrega cobre somente Affiliate. `AffiliateModule` operacional permanece SQLite; o opt-in é `AffiliateModule.postgres(config, options)`, em aplicação isolada. O módulo PostgreSQL não importa os providers SQLite, não seleciona o provider LIVE pelo ambiente e não altera AppModule. Sem `options.shopee` e `options.discovery`, operações de provider/source falham explicitamente; os testes fornecem somente implementações locais fake. Não há dual write, importação de dados reais, deploy, downloads comerciais, publicação ou cutover.

### Migration v4 e catálogo único

`AFFILIATE_POSTGRES_MIGRATION_REGISTRY` concatena o registro Content v1/v2/v3 intacto com a versão 4, `004_affiliate_foundation`. O provisionamento é administrativo e explícito pelo runner PG-001. Abertura de sessão verifica nome/checksum v4; não executa DDL. `ShopeeDynamicJournal.initialize()` no modo PG apenas verifica o provisionamento existente. Pool, transações e runner são os de PG-001; não existe segundo pool ou mecanismo de migrations implementado por Affiliate.

O schema `affiliate` contém 11 tabelas: affiliate_product_revisions, affiliate_campaign_revisions, affiliate_briefings, affiliate_commands, affiliate_campaign_sources_v1, affiliate_run_bindings, affiliate_script_contexts, affiliate_discovery_decisions, affiliate_discovery_execution, affiliate_discovery_events e affiliate_shopee_dynamic_events_v1. O journal é histórico operacional, sem duplicar o catálogo. Claims de ciclo/link, leases, reservas e reconciliações usam os mesmos tópicos/eventos dos contratos existentes.

PKs, unicidades, FKs compostas de campanha/produto/briefing/fonte e FK real para `project.projects` protegem as relações migradas. Revisões são contíguas e os históricos imutáveis usam trigger `P4001`; violações de sequência usam `P4002`. Inteiros têm limite seguro para JavaScript, IDs/textos usam collation C e JSON nativo preserva os bytes armazenados. O parser JSON em texto é local à query. Preços, taxas e comissões permanecem strings decimais dentro de JSON, sem Number nem normalização NUMERIC que perca precisão; não se alteram parsers globais.

### Regras compartilhadas e atomicidade

Os repositories existentes executam uma única implementação de validação, revisão, hashing, materialização de briefing, elegibilidade, replay e seleção. Um interpretador de I/O mantém SQLite síncrono e aguarda as operações PG, sem duplicar as regras. A fronteira SQL qualifica somente os nomes físicos conhecidos e converte placeholders de statements internos em parâmetros $n. Nenhum texto SQL vem do usuário. A detecção da extensão de fontes e a disponibilidade do journal são capacidades explícitas; PostgreSQL não executa PRAGMA nem consulta sqlite_master.

`PostgresAffiliateSession` reutiliza o PoolClient do transaction manager, inclusive em operações aninhadas. Writers utilizam advisory lock do domínio; leituras compostas abrem snapshot REPEATABLE READ READ ONLY. Fechar um handle não encerra o pool compartilhado. Erros do driver são sanitizados. `ShopeeCatalogCommit` mantém produto + campanha + fonte + recibos na mesma transação e conexão. Falhas descartam todas as escritas, permitindo retry. Reserva de LINK e LINK_SCOPE é atômica; resultado remoto incerto bloqueia uma segunda mutação até reconciliação explícita. Eventos PREPARATION permitem recuperar interrupção após commit do catálogo, sem repetir query ou geração de link.

A descoberta mantém decisão, checkpoint e evento na mesma transação, recalculando exclusões sob o lock de escrita. Leitura, ranking e reserva usam a implementação atual. WAITING/PREPARED, evidências, direitos e SubIDs permanecem nas funções existentes. A ordem do catálogo coincide com SQLite. `ROUND_ROBIN_ID_V1` pertence a Operations, cujo código e aplicação operacional permanecem inalterados; não se declara esse pipeline integrado ao opt-in.

Os ports têm modo assíncrono explícito com padrão síncrono. Serviços já assíncronos aguardam seus I/Os; catálogo e run contexts preservam os retornos síncronos do modo padrão. O único controller ampliado por autorização do operador é `affiliate-run-context.controller.ts`: `respond()` aguarda `operation()` dentro do try, mantendo o bloco de mapeamento de erros intacto. Os testes cobrem sucesso e erros síncronos/rejeições de Promise com os mesmos códigos HTTP.

### Fronteiras que continuam bloqueadas

`options.readers` fornece somente projeções de execução e atividade de scripts. Não se inventa uma FK para Operations ainda em SQLite e não se afirma que uma leitura externa participa da transação PostgreSQL. A associação de um run deve competir atomicamente com seu início de geração/atividade. Por isso `bindingCommand`, `insertRunBinding` e novas inserções de script context falham no opt-in antes da primeira escrita com `AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED`. Leituras e verificação/replay de contextos históricos continuam disponíveis. `POST /affiliate/run-bindings` retorna 409 por um guard exclusivo do módulo PG; o controller SQLite mantém seu mapeamento original. Histórico nos testes é semeado somente na fixture, sem criar caminho de importação operacional.

O callback de reserva de orçamento/autorização do provider LIVE atual é síncrono e deve reservar antes do efeito externo. `runAuthorizedScheduledCycle` rejeita o journal PG com `SHOPEE_POSTGRES_LIVE_RESERVATION_UNSUPPORTED` antes de consultar grants ou chamar o provider. Não se converte essa reserva em Promise sem suporte do contrato da Frente C. Endpoints, assinaturas, autenticação, limites e regras do provider LIVE permanecem intactos; sua homologação e ativação não fazem parte desta entrega. O restante do ciclo local é validado com fake e banco real.

### Validação isolada

`npm run test:postgres -- test/postgres/affiliate.integration.test.ts` reutiliza a harness PG-001 com PostgreSQL 18.6 real, tmpfs, rede própria, porta loopback efêmera e marcador independente da database. Os cenários comparam SQLite descartável e PG, incluindo histórico/checksums v1–v4, rollback de DDL, catálogo/revisões/briefing, proveniência e JSON, recibos, concorrência, reserva de descoberta, journal/claims, precisão decimal, WAITING/PREPARED, interrupção/reconciliação/recuperação e HTTP NestJS. Os providers são locais fake e nenhuma chamada Shopee real é efetuada. Testes SQLite congelados, concorrência em workers e controller continuam como regressão; os workers passam a incluir o pequeno interpretador de I/O sem mudar as asserções. Custos locais de CPU/energia indisponíveis; nenhuma execução paga realizada. PG-002 completo e cutover permanecem fora do escopo.

## Campaign/Operations — CORE-PG-002-CAMPAIGN-OPERATIONS-001

Esta entrega cobre a persistência operacional de Campaign/Operations. O opt-in isolado é `OperationsModule.postgres(config, options)`; `ContentOperationsModule.postgres` e `CampaignOrchestrationModule.postgres` expõem a mesma composição. Importar os módulos padrão continua selecionando SQLite. AppModule, Docker, configurações LIVE, Finance e demais frentes permanecem inalterados. Não há dual write, migração de dados reais, execução Shopee LIVE, publicação ou cutover.

### Ownership e migration v5

`CAMPAIGN_POSTGRES_MIGRATION_REGISTRY` estende o registro completo Affiliate v1–v4 com `005_campaign_operations`, versão 5. As versões anteriores e seus checksums permanecem intactos. O runner administrativo PG-001 aplica DDL somente por chamada explícita. Abertura de handles e startup verificam a versão 5/nome/checksum; não criam schema nem reescrevem o ledger.

O schema `campaign` possui seis tabelas: pipeline_runs, pipeline_run_transitions, pipeline_run_recoveries, pipeline_stage_attempts, campaign_executions e campaign_execution_events. Runs, tentativas, reservas, claims/leases e eventos são responsabilidade operacional de Campaign. Campanhas comerciais canônicas continuam exclusivamente em `affiliate.affiliate_campaign_revisions`, referenciadas por FK composta; snapshots de projeto usam a FK real em `project.project_snapshots`. `run_id` de uma reserva pode preceder a criação do pipeline, conforme o contrato existente. Artefatos produzidos são referências opacas com hash, sem FKs inventadas para Media/Content ainda não participantes dessa unidade transacional.

JSON nativo preserva a representação original com parser local em texto; os parsers globais do driver não mudam. IDs e ordenação textual usam collation C; números persistidos possuem limite inteiro seguro. O cursor global de eventos e IDs de tentativas/histórico são alocados sob o lock da mesma transação e não são consumidos após rollback, preservando a semântica de identidade SQLite. A sequência de cada execução continua contígua. O cursor interno `event_cursor` é exposto somente como o campo histórico `cursor`; não altera o JSON dos DTOs originais.

Triggers protegem identidade, estados e histórico imutável (`P5001`/`P5002`). Constraints nativas cobrem integridade referencial, campanha/data única, run único, claim/token/lease coerentes e somente uma tentativa RUNNING por run/estágio.

### Regras, I/O e commit antes de efeitos

Os algoritmos atuais de runs, transições, recuperação, estágios e CampaignRepository são compartilhados pelos dois adapters através de etapas de I/O. `SqliteOperationsRepository` preserva sua herança Project, API síncrona e banco nativo; o core de runs não abre SQLite quando usado pelo facade PG. O pequeno interpretador permanece nos repositories existentes para preservar a dependência dos workers SQLite sem alterar os helpers fora da allowlist. Portas e serviços mantêm o modo síncrono por padrão e optam explicitamente por I/O assíncrono.

`PostgresCampaignSession` utiliza exclusivamente `PostgresDatabase.transaction` e seu PoolClient, inclusive em chamadas aninhadas. Writers serializam com advisory lock do domínio; leituras compostas usam snapshot REPEATABLE READ READ ONLY. Handles fechados/read-only são protegidos e seu fechamento não encerra o pool. A projeção de execução e histórico usa readSnapshot na mesma sessão, impedindo mistura de versões durante avanço concorrente. Statements internos são qualificados e parametrizados. As diferenças físicas de rowid, JSON e retorno de IDs são adaptadas explicitamente; PostgreSQL não recebe PRAGMA, sqlite_master ou DDL SQLite. Erros do driver são sanitizados.

`StageRecoveryService` aguarda o commit de startAttempt antes da operação e aguarda a persistência terminal. `CampaignOrchestrator` aguarda claim e STEP_STARTED antes de executar um passo, mantém heartbeat assíncrono serializado e aguarda renovações pendentes ao finalizar. Expiração de lease preserva WAITING_RECONCILIATION e exige verificação explícita antes de retomar. Novos workers não repetem checkpoints já concluídos. Recorrência fixa, reserva campanha/data, versão otimista, replay e histórico reutilizam as regras existentes.

### Composição e fronteiras preservadas

O módulo PG registra os controllers existentes de runs e campaign-executions, os serviços de ciclo de vida e o repository PG, sem importar a composição operacional NativeCampaignWorkflow. `options.workflow` é um port explícito para passos controlados e validação; sem ele não se agenda/executa trabalho por fallback. Não há scheduler habilitado no startup. A execução do runner é manual/explicita e os testes usam somente funções locais fake. O token Nest existente de CampaignAdministration preserva a inferência síncrona dos consumidores SQLite; `CampaignAdministrationRuntime<true>` identifica o serviço assíncrono do opt-in. A projeção HTTP existente foi extraída como função pura compartilhada, sem mudar mensagens, DTOs ou códigos de erro.

As seguintes operações continuam bloqueadas antes de efeitos no opt-in:

- Seleção de catálogo via callback externo, recorrência CATALOG e rotação entre domínios, pois o contrato atual não assegura que a leitura Affiliate participe da conexão/lock de Campaign. `ROUND_ROBIN_ID_V1` permanece intacta, sem rotação simulada entre bancos.
- Claims/baselines de notificação que dependem de revalidação transacional em Notifications/Publishing, e revisão de composição que depende de reservas de publicação ainda não migradas.
- NativeCampaignWorkflow comercial, geração/produção de conteúdo, revisões/aprovações, legacy recovery e ações que envolvam escrita em Content, Affiliate, Finance, Media ou Publishing. O opt-in rejeita payloads de produção/publicação e ações não suportadas; os guards operacionais padrão não são enfraquecidos.

Esses limites usam `CAMPAIGN_CROSS_DOMAIN_REQUIRED`. O guard exclusivo do piloto rejeita endpoints não suportados antes de consultar identidade QC ou chamar controllers de efeitos. Nenhum bloqueio PG-002 Affiliate/Content foi removido nesta entrega: a coordenação transacional desses domínios requer contrato posterior explícito. A UI/dashboard Operations e os consumidores Notifications continuam na composição SQLite operacional.

### Validação

`npm run test:postgres -- test/postgres/campaign-operations.integration.test.ts` reutiliza a harness PG-001: PostgreSQL 18.6 local real, database marcada, tmpfs, rede dedicada e porta loopback efêmera. A fixture verifica sua identidade antes de DDL destrutivo e é removida ao terminar, sem acessar instâncias operacionais ou apagar volumes existentes. A cobertura inclui registro v1–v5, reexecução/checksum/rollback, paridade SQLite, hashes/identidade/JSON, transições, claims/leases, tentativa e recuperação após restart, recorrência fixa, concorrência e idempotência, rollback de reservas/eventos, bloqueios entre domínios, ausência de efeito antes do commit, histórico/read-only/handles fechados e HTTP NestJS. Nenhum resultado PostgreSQL é baseado apenas em mocks; somente os ports externos usam fakes. Build, TypeScript, lint direcionado, regressões dos módulos afetados e diff-check completam a validação. Custos locais de CPU/energia indisponíveis; nenhuma chamada paga realizada.
