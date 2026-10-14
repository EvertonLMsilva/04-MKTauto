import * as ts from './project-contracts.js';

const legacy = (await import(
  new URL('../../../../src/domain/project-contracts.js', import.meta.url).href
)) as typeof ts;
const valid = {
  id: 'project_parity',
  name: '  Nome   Original ',
  niche: ' TECNOLOGIA ',
  audience: { profile: ' Público ', language: 'pt-br' },
  channel: { publishing: { networks: ['INSTAGRAM'] } },
};
function outcome(run: () => unknown) {
  try {
    return { result: run() };
  } catch (error) {
    const e = error as {
      name: string;
      code: string;
      path: string;
      message: string;
    };
    return { name: e.name, code: e.code, path: e.path, message: e.message };
  }
}
describe('Project domain JS × TS', () => {
  it.each([
    valid,
    null,
    [],
    {},
    { ...valid, schemaVersion: 'wrong' },
    { ...valid, id: 'UPPER', name: '' },
    { ...valid, unknown: true, token: 'hidden' },
    { ...valid, subniches: [' IA ', 'ia'] },
    { ...valid, audience: { profile: 'P', language: 'pt-BR-extra' } },
    { ...valid, version: Number.MAX_SAFE_INTEGER + 1 },
    {
      ...valid,
      references: [{ platform: 'instagram', handle: '@x', purpose: 'repost' }],
    },
    { ...valid, channel: { minDurationSeconds: 45, maxDurationSeconds: 25 } },
    {
      ...valid,
      channel: {
        publishing: {
          networks: ['instagram'],
          contentsPerDay: 2,
          times: ['18:00', '10:00'],
        },
      },
    },
    {
      ...valid,
      channel: { publishing: { networks: ['instagram'], timezone: 'invalid' } },
    },
  ])('preserves output and first validation failure %#', (input) => {
    expect(outcome(() => ts.createProjectSnapshot(input))).toEqual(
      outcome(() => legacy.createProjectSnapshot(input)),
    );
  });
  it('preserves snapshot serialization, defaults and schemas', () => {
    expect(JSON.stringify(ts.createProjectSnapshot(valid))).toBe(
      JSON.stringify(legacy.createProjectSnapshot(valid)),
    );
    expect(ts.PROJECT_DEFAULTS).toEqual(legacy.PROJECT_DEFAULTS);
    expect(ts.PROJECT_SCHEMAS).toEqual(legacy.PROJECT_SCHEMAS);
    const snapshot = ts.createProjectSnapshot(valid);
    expect(outcome(() => ts.validateProjectSnapshot(snapshot))).toEqual(
      outcome(() => legacy.validateProjectSnapshot(snapshot)),
    );
  });
});
