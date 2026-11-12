import { PilotDiagnosticService } from './pilot-diagnostic.service.js';
// Isolated read-port fixture: no storage, providers or operational credentials.
test('a pilot report refuses an unprotected run before consulting other domains', async () => {
  const get = vi.fn(() => ({
    execution_id: 'fixture_exec',
    run_id: 'fixture_run',
  }));
  const history = vi.fn(() => [
    { event_type: 'SCHEDULED', evidence: { runId: 'fixture_run' } },
  ]);
  const forbidden = vi.fn(() => {
    throw new Error('UNEXPECTED_DOMAIN_ACCESS');
  });
  const service = new PilotDiagnosticService(
    { get, history } as never,
    { inspect: forbidden } as never,
    { catalogReadiness: forbidden } as never,
    { getRunReadiness: forbidden } as never,
    { handoff: forbidden } as never,
  );
  await expect(service.inspect(['fixture_exec'])).rejects.toMatchObject({
    code: 'PILOT_CONTROLLED_FAKE_REQUIRED',
  });
  expect(forbidden).not.toHaveBeenCalled();
  expect(get).toHaveBeenCalledOnce();
  expect(history).toHaveBeenCalledOnce();
});
test('invalid execution identities do not reach a repository', async () => {
  const get = vi.fn();
  const service = new PilotDiagnosticService(
    { get } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(service.inspect(['../private'])).rejects.toMatchObject({
    code: 'INVALID_IDENTIFIER',
  });
  expect(get).not.toHaveBeenCalled();
});
