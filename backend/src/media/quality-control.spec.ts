import { contentFixture } from '../../test/support/content-fixture.js';
import { mediaStore } from '../../test/support/media-store.js';
import {
  qcReport,
  p4Qc,
  seedQc,
  seedP4Qc,
} from '../../test/support/media-qc-fixture.js';
import {
  validateQualityControlReport,
  aggregateQualityControlStatus,
} from './domain/quality-control-contracts.js';
const legacy = await import(
  new URL('../../../src/quality-control-repository.js', import.meta.url).href
);
const contracts = await import(
  new URL('../../../src/domain/quality-control-contracts.js', import.meta.url)
    .href
);
function failure(action: () => unknown) {
  try {
    action();
    return null;
  } catch (error) {
    const e = error as {
      name: string;
      code: string;
      field: string;
      path: string;
      message: string;
    };
    return {
      name: e.name,
      code: e.code,
      field: e.field ?? e.path,
      message: e.message,
    };
  }
}
describe('Existing QC reports without inspection or rendering', () => {
  it('preserves V1/V2 contracts, immutable historical reads and exact policy lookup', () => {
    const f = contentFixture();
    const writes = mediaStore(f.database).open();
    const one = seedQc(writes.db),
      two = seedP4Qc(writes.db);
    writes.close();
    const r = mediaStore(f.database).openQuality(),
      js = new legacy.QualityControlRepository(f.database, { readOnly: true });
    try {
      for (const value of [one, two]) {
        expect(validateQualityControlReport(value)).toEqual(
          contracts.validateQualityControlReport(value),
        );
        expect(r.getQualityControlReport(value.qualityControlReportId)).toEqual(
          js.getQualityControlReport(value.qualityControlReportId),
        );
        expect(
          r.findQualityControlReport(
            value.policyVersion,
            value.videoRenderId,
            value.videoRenderContentHash,
          ),
        ).toEqual(value);
        expect(
          r.findQualityControlReport(
            value.policyVersion,
            value.videoRenderId,
            'f'.repeat(64),
          ),
        ).toBeNull();
      }
      expect(() => r.db.exec('DELETE FROM quality_control_reports')).toThrow();
      expect(
        aggregateQualityControlStatus([{ status: 'WARN' }, { status: 'PASS' }]),
      ).toBe('WARN');
    } finally {
      r.close();
      js.close();
      f.close();
    }
  });
  it('preserves malformed-report errors and permission findings', () => {
    for (const value of [
      null,
      {},
      { ...qcReport(), approvalBlocked: true },
      { ...qcReport(), contentHash: 'f'.repeat(64) },
      {
        ...p4Qc(),
        origin: { ...p4Qc().origin, videoRenderContentHash: 'invalid' },
      },
    ])
      expect(failure(() => validateQualityControlReport(value))).toEqual(
        failure(() => contracts.validateQualityControlReport(value)),
      );
  });
  it('detects finding tampering with the legacy error and preserves historical rows', () => {
    const f = contentFixture();
    const writer = mediaStore(f.database).open();
    const value = seedQc(writer.db);
    for (const row of writer.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='quality_control_findings'",
      )
      .all())
      writer.db.exec(`DROP TRIGGER "${String(row.name)}"`);
    writer.db.exec("UPDATE quality_control_findings SET message='tampered'");
    writer.close();
    const r = mediaStore(f.database).openQuality(),
      js = new legacy.QualityControlRepository(f.database, { readOnly: true });
    try {
      expect(
        failure(() => r.getQualityControlReport(value.qualityControlReportId)),
      ).toEqual(
        failure(() => js.getQualityControlReport(value.qualityControlReportId)),
      );
      expect(
        r.db.prepare('SELECT COUNT(*) AS n FROM quality_control_reports').get()
          ?.n,
      ).toBe(1);
    } finally {
      r.close();
      js.close();
      f.close();
    }
  });
});
