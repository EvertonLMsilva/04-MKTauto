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

  reviewCandidate(runId, candidateId, decision) {
    if (!["approved", "rejected"].includes(decision)) {
      throw new Error("Decisão de revisão inválida");
    }
    const row = this.db.prepare(`SELECT payload FROM discovery_runs WHERE id = ?`).get(runId);
    if (!row) throw new Error("Rodada não encontrada");
    const run = JSON.parse(row.payload);
    const candidate = run.scored.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("Candidato não encontrado");
    if (!candidate.eligible) throw new Error("Candidato bloqueado não pode ser aprovado");
    candidate.reviewDecision = decision;
    const topCandidate = run.top.find((item) => item.id === candidateId);
    if (topCandidate) topCandidate.reviewDecision = decision;
    this.db.prepare(`UPDATE discovery_runs SET payload = ? WHERE id = ?`)
      .run(JSON.stringify(run), runId);
    return run;
  }

  close() {
    this.db.close();
  }
}
