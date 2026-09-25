import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class RunStore {
  constructor(path = resolve("data/mktauto.sqlite")) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS discovery_runs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      )
      ;
      CREATE TABLE IF NOT EXISTS source_discovery_runs (
        id TEXT PRIMARY KEY,
        discovery_run_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      )
    `);
  }

  save(run) {
    this.db.prepare(`
      INSERT INTO discovery_runs (id, mode, created_at, payload)
      VALUES (?, ?, ?, ?)
    `).run(run.id, run.mode, run.createdAt, JSON.stringify(run));
    return run;
  }

  latest() {
    const row = this.db.prepare(`
      SELECT payload FROM discovery_runs ORDER BY created_at DESC LIMIT 1
    `).get();
    return row ? JSON.parse(row.payload) : null;
  }

  get(runId) {
    const row = this.db.prepare(`SELECT payload FROM discovery_runs WHERE id = ?`).get(runId);
    return row ? JSON.parse(row.payload) : null;
  }

  saveSourceDiscovery(sourceRun) {
    this.db.prepare(`
      INSERT INTO source_discovery_runs (id, discovery_run_id, created_at, payload)
      VALUES (?, ?, ?, ?)
    `).run(sourceRun.id, sourceRun.runId, sourceRun.createdAt, JSON.stringify(sourceRun));
    return sourceRun;
  }

  latestSourceDiscovery(runId) {
    const row = this.db.prepare(`
      SELECT payload FROM source_discovery_runs
      WHERE discovery_run_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(runId);
    return row ? JSON.parse(row.payload) : null;
  }

  reviewSource(sourceRunId, sourceId, decision) {
    if (!["green", "rejected"].includes(decision)) throw new Error("Decisão de fonte inválida");
    const row = this.db.prepare(`SELECT payload FROM source_discovery_runs WHERE id = ?`).get(sourceRunId);
    if (!row) throw new Error("Busca de fontes não encontrada");
    const sourceRun = JSON.parse(row.payload);
    const source = sourceRun.niches.flatMap((item) => item.sources)
      .find((item) => item.id === sourceId);
    if (!source) throw new Error("Fonte não encontrada");
    source.reviewDecision = decision;
    source.rightsState = decision === "green" ? "green" : "rejected";
    this.db.prepare(`UPDATE source_discovery_runs SET payload = ? WHERE id = ?`)
      .run(JSON.stringify(sourceRun), sourceRunId);
    return sourceRun;
  }

  reviewCandidate(runId, candidateId, decision) {
    if (!["approved", "rejected"].includes(decision)) {
      throw new Error("Decisão de revisão inválida");
    }
    const row = this.db.prepare(`SELECT payload FROM discovery_runs WHERE id = ?`).get(runId);
    if (!row) throw new Error("Rodada não encontrada");
    const run = JSON.parse(row.payload);
    const candidate = run.scored.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("Candidato não encontrado");
    const reviewable = [run.top ?? [], run.provisionalTop ?? []]
      .flat()
      .some((item) => item.id === candidateId);
    if (!reviewable) throw new Error("Candidato fora da seleção não pode ser revisado");
    candidate.reviewDecision = decision;
    for (const selection of [run.top ?? [], run.provisionalTop ?? []]) {
      const selectedCandidate = selection.find((item) => item.id === candidateId);
      if (selectedCandidate) selectedCandidate.reviewDecision = decision;
    }
    this.db.prepare(`UPDATE discovery_runs SET payload = ? WHERE id = ?`)
      .run(JSON.stringify(run), runId);
    return run;
  }

  close() {
    this.db.close();
  }
}
