import { PublishingService } from './application/publishing.service.js';

const input = {
  campaignId: 'campaign_001',
  campaignRevision: 1,
  videoRenderId: 'render_001',
  qualityControlReportId: 'qc_001',
  platform: 'instagram',
  account: '123456789',
  caption: 'Produto autorizado',
};
function fixture() {
  const records: any[] = [];
  const manual = {
    repository: { list: () => records },
    prepare: vi.fn(() => {
      const pkg = {
        ...input,
        contentHash: 'a'.repeat(64),
        identity: {
          pipelineRunId: 'run_001',
          videoRenderId: input.videoRenderId,
          qualityControlReportId: input.qualityControlReportId,
        },
      };
      records.push(pkg);
      return pkg;
    }),
  };
  const service = new PublishingService(
    { open: () => ({ manual, close() {} }) } as any,
    {} as any,
  );
  return { service, manual, records };
}
test('coordination prepares once and resolves the same package on restart/replay', () => {
  const f = fixture();
  expect(f.service.coordinatePackage('run_001', input)).toEqual(
    f.service.coordinatePackage('run_001', input),
  );
  expect(f.manual.prepare).toHaveBeenCalledTimes(1);
});
test('coordination never selects among ambiguous packages or another destination', () => {
  const f = fixture();
  f.service.coordinatePackage('run_001', input);
  f.records.push({ ...f.records[0], contentHash: 'b'.repeat(64) });
  expect(() => f.service.coordinatePackage('run_001', input)).toThrow(
    'DISTRIBUTION_PACKAGE_AMBIGUOUS',
  );
  f.records.pop();
  f.records[0].account = '987654321';
  expect(() => f.service.coordinatePackage('run_001', input)).toThrow(
    'DISTRIBUTION_PACKAGE_SCOPE_MISMATCH',
  );
});

test('Facebook package on the same run does not make Instagram coordination ambiguous', () => {
  const f = fixture();
  const instagram = f.service.coordinatePackage('run_001', input);
  f.records.push({
    ...instagram,
    platform: 'facebook',
    account: '1355505384315575',
    contentHash: 'c'.repeat(64),
  });
  expect(f.service.coordinatePackage('run_001', input)).toEqual(instagram);
  expect(f.manual.prepare).toHaveBeenCalledTimes(1);
});
