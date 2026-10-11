export function product(overrides = {}) {
  return { schemaVersion: 'affiliate-product/1.0.0', productId: 'prod_001', revision: 1,
    name: 'Fone de exemplo', brand: 'Marca exemplo',
    attributes: [{ name: 'connectivity', value: 'Bluetooth', evidenceRef: 'ev_spec' }],
    media: [{ mediaRef: 'authorized-image-001', evidenceRef: 'ev_rights' }],
    evidence: [
      { id: 'ev_spec', kind: 'PRODUCT_SPECIFICATION', sourceRef: 'manual-spec-001', recordedAt: '2026-10-11T12:00:00Z' },
      { id: 'ev_rights', kind: 'MEDIA_USAGE_RIGHT', sourceRef: 'authorization-001', recordedAt: '2026-10-11T12:00:00Z' },
    ], ...overrides };
}
export function campaign(overrides = {}) {
  return { schemaVersion: 'affiliate-campaign/1.0.0', campaignId: 'camp_001', revision: 1,
    projectId: 'project_001', productId: 'prod_001', productRevision: 1,
    affiliateUrl: 'https://example.com/item?tag=affiliate%2B001&ref=x',
    cta: 'Confira pelo link', disclosure: 'Publicidade | Link de afiliado', ...overrides };
}
export function project(overrides = {}) {
  return { id: 'project_001', name: 'Projeto exemplo', version: 1, niche: 'Tecnologia',
    subniches: ['Fones'], audience: { profile: 'Adultos', language: 'pt-BR' }, references: [],
    channel: { publishing: { contentsPerDay: 1, networks: ['instagram'], timezone: 'America/Sao_Paulo', times: ['10:00'] } },
    ...overrides };
}
export function startRun(repository, id = 'run_001', projectId = 'project_001') {
  return repository.startRun({ execution: { pipelineRunId: id, projectId, projectVersion: 1,
    startedAt: '2026-10-11T12:00:00.000Z' }, projectSnapshot: repository.get(projectId, 1) });
}
