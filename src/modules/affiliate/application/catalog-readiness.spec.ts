import { AffiliateService } from './affiliate.service.js';
import type { ProjectSnapshotReader } from '../../project/application/ports/project-snapshot-reader.port.js';

test('catalog readiness exposes exact project context and separates technical and operational gates without writing', async () => {
  const close = vi.fn(),
    catalogCandidates = vi.fn(() => []),
    open = vi.fn(() => ({ catalogCandidates, close }));
  const project = { project: { id: 'project_001', version: 3 } };
  const get = vi.fn(async () => project);
  const projects = { get } as unknown as ProjectSnapshotReader;
  const service = new AffiliateService({ open } as any, projects);
  const result = await service.catalogReadiness('project_001', 3);
  expect(result).toMatchObject({
    schemaVersion: 'affiliate-catalog-readiness/1.0.0',
    projectId: 'project_001',
    projectVersion: 3,
    items: [],
  });
  expect(get).toHaveBeenCalledWith('project_001', 3);
  expect(open).toHaveBeenCalledWith(true);
  expect(close).toHaveBeenCalledOnce();
  expect(await service.catalogReadiness('project_001', 3)).toEqual(result);
});

test('catalog context fails closed before opening storage for invalid or missing projects', async () => {
  const open = vi.fn(),
    get = vi.fn(async () => null),
    service = new AffiliateService({ open }, { get });
  await expect(service.catalogReadiness('../project', 1)).rejects.toThrow();
  await expect(service.catalogReadiness('project_001', 0)).rejects.toThrow();
  await expect(
    service.catalogReadiness('project_001', 1),
  ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  expect(open).not.toHaveBeenCalled();
});

test('a mismatched project snapshot or candidate cannot cross project/version boundaries', async () => {
  const close = vi.fn(),
    get = vi.fn(async () => ({ project: { id: 'project_001', version: 2 } })),
    catalogCandidates = vi.fn(() => [
      { campaign: { projectId: 'other_project' } },
    ]);
  const open = vi.fn(() => ({ catalogCandidates, close })),
    service = new AffiliateService(
      { open } as any,
      { get } as unknown as ProjectSnapshotReader,
    );
  await expect(
    service.catalogReadiness('project_001', 1),
  ).rejects.toMatchObject({ code: 'AFFILIATE_SCOPE_MISMATCH' });
  expect(open).not.toHaveBeenCalled();
  await expect(
    service.catalogReadiness('project_001', 2),
  ).rejects.toMatchObject({ code: 'AFFILIATE_SCOPE_MISMATCH' });
  expect(close).toHaveBeenCalledOnce();
});
