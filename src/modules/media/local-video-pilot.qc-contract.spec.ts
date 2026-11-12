import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import type { LocalFlowRepository } from './infrastructure/local-flow.repository.js';
import type { MediaService } from './application/media.service.js';
import { QualityControlRepository } from './infrastructure/quality-control.repository.js';
import { validateQualityControlReport } from './domain/quality-control-contracts.js';

it('documents the missing local_qc bridge without fabricating a passing QC or changing infrastructure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'local-pilot-qc-contract-'));
  const db = new DatabaseSync(':memory:');
  // Isolated lookup fixture only: these are not operational tables or migrations.
  db.exec(`CREATE TABLE p4_artifacts(kind TEXT,artifact_id TEXT,identity_hash TEXT,payload_json TEXT);
    CREATE TABLE quality_control_reports(quality_control_report_id TEXT);
    CREATE TABLE artifact_lineage(artifact_id TEXT,artifact_type TEXT,payload_json TEXT);`);
  const render = {
    videoRenderId: 'render_pilot',
    pipelineRunId: 'run_pilot',
    projectId: 'project_pilot',
    projectVersion: 1,
    contentHash: 'a'.repeat(64),
    revision: 2,
    createdAt: '2026-11-12T12:00:00Z',
  };
  const runner = vi.fn(async () => {
    throw Error('NATIVE_EXECUTION_NOT_EXPECTED');
  });
  const saved = vi.fn((id: string, type: string, value: unknown) => {
    db.prepare('INSERT INTO artifact_lineage VALUES (?,?,?)').run(
      id,
      type,
      JSON.stringify(value),
    );
    return value;
  });
  const repository = {
    getVideoRender: () => render,
    getArtifact: () => null,
    close() {},
    transaction: <T>(operation: () => T) => operation(),
    saveDocument: saved,
  };
  const runtime = new LocalFlowRuntime(
    () => repository as unknown as LocalFlowRepository,
    {} as MediaService,
    { FFMPEG_RENDER_ROOT: root, LOCAL_MEDIA_EVIDENCE_ROOT: root },
    undefined,
    runner,
  );
  try {
    // No video is supplied or generated. Runtime truthfully emits FAIL evidence.
    // Catalog incompatibility is independent of whether local findings pass.
    const report = (await runtime.qc(render.videoRenderId)) as {
      reportId: string;
      policyVersion: string;
      result: string;
    };
    expect(report.result).toBe('FAIL');
    expect(report.policyVersion).toBe('local-qc/1');
    expect(saved.mock.calls[0][1]).toBe('local_qc');
    expect(runner).not.toHaveBeenCalled();
    expect(
      db
        .prepare(
          'SELECT artifact_type FROM artifact_lineage WHERE artifact_id=?',
        )
        .get(report.reportId)?.artifact_type,
    ).toBe('local_qc');
    const before = db.prepare('SELECT total_changes() AS n').get()!.n;
    const reader = { db } as unknown as QualityControlRepository;
    expect(
      QualityControlRepository.prototype.getQualityControlReport.call(
        reader,
        report.reportId,
      ),
    ).toBeNull();
    expect(db.prepare('SELECT total_changes() AS n').get()!.n).toBe(before);
    // Passing the raw local document directly also violates the official contract.
    expect(() => validateQualityControlReport(report)).toThrow();
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
