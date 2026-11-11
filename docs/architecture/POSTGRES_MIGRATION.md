# PostgreSQL foundation — CORE-POSTGRES-001-T01

PostgreSQL is the selected principal database architecture: one database named `mktauto`, schemas owned by NestJS domains, one infrastructure-managed pool, and versioned PostgreSQL migrations. This delivery implements the Project pilot. The operational application and all other domains continue using SQLite. There is no cutover, real-data import, dual write, scheduler activation or deploy.

## Implemented boundary

- `platform.schema_migrations` owns global migration versions, names, exact SQL SHA256 checksums and application timestamps.
- `project.projects`, `project.project_snapshots` and `project.project_commands` belong to Project. No empty schemas for other domains are created.
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

Only Project is implemented here. No other domain's repository, database, trigger or migration is changed.

## Real isolated validation

Run `npm ci`, `npm run build`, then `npm run test:postgres` from the CORE worktree. The harness requires the already-local `postgres:18.6` image and uses `--pull=never`. It creates a unique container, dedicated bridge, localhost-only ephemeral port, random private credentials and tmpfs database. Existing connection URLs are never used. On this Docker engine an internal network suppressed port publication; a dedicated bridge provides the required loopback test access without joining any other project's network.

The fixture database must independently match `mktauto`, the test role and its unique database COMMENT marker before any destructive test SQL. Missing configuration fails; integration tests are not silently skipped. The harness removes only the container/network it owns, checked by unique labels, and removes its private temporary directory after validating its boundary. It does not create a persistent DB volume or query the operational PostgreSQL server.

Integration coverage on PostgreSQL 18.6 includes schemas/migrations, concurrent migration idempotence, checksum/history drift, transactional migration failure, commit/rollback/client release, decimal precision, native checks/FKs/JSON validation, full Project lifecycle and history, exact SQLite contract parity, concurrent idempotent requests, competing expectedVersions, receipt-failure rollback/retry, immutable triggers, int8 boundaries and the actual NestJS HTTP flow. A separate test confirms default ProjectModule remains SQLite.

Focused offline Project tests and compiled legacy tests cover the synchronous path. Full MKTauto migration, import of operational data, deployment, paid providers and LIVE cutover are outside this delivery. No paid business calls are made; local CPU/energy cost is unavailable, not assumed zero.
