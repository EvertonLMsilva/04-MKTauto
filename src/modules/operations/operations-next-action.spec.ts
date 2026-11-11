import { operationsNextAction } from './operations-next-action.js';

const execution = (
  code = 'AUDIO_REQUIRED',
  completedSteps = ['EDITORIAL', 'MEDIA_QC'],
) => ({
  status: 'WAITING_INPUT',
  finalization: {
    completedSteps,
    pending: { code, message: 'Existing pending message' },
  },
});
const prepared = {
  requestHash: 'a'.repeat(64),
  state: 'NOT_SUBMITTED',
  audioConfirmed: false,
};

test('the current valid revision advances to individual TTS authorization instead of another script revision', () => {
  expect(operationsNextAction(execution(), prepared)?.code).toBe(
    'TTS_AUTHORIZATION_REQUIRED',
  );
  expect(
    operationsNextAction(execution('NARRATION_DURATION_REQUIRED'), prepared)
      ?.code,
  ).toBe('TTS_AUTHORIZATION_REQUIRED');
});
test('only a demonstrated current narration duration problem requires revision', () => {
  expect(
    operationsNextAction(execution('NARRATION_DURATION_REQUIRED'), {
      ...prepared,
      audioConfirmed: true,
    })?.code,
  ).toBe('SCRIPT_REVISION_REQUIRED');
  expect(
    operationsNextAction(execution(), { code: 'NARRATION_DURATION_REQUIRED' })
      ?.code,
  ).toBe('SCRIPT_REVISION_REQUIRED');
  expect(
    operationsNextAction(
      execution('ALIGNMENT_TEXT_DIVERGENT', ['EDITORIAL', 'MEDIA_QC', 'AUDIO']),
      prepared,
    )?.code,
  ).toBe('ALIGNMENT_TEXT_DIVERGENT');
});
test('uncertain submissions require reconciliation and confirmed audio resumes without another authorization', () => {
  expect(
    operationsNextAction(execution(), { ...prepared, state: 'UNKNOWN' })?.code,
  ).toBe('TTS_RECONCILIATION_REQUIRED');
  expect(
    operationsNextAction(execution(), {
      ...prepared,
      state: 'UNKNOWN',
      audioConfirmed: true,
    })?.code,
  ).toBe('TTS_CONTINUATION_REQUIRED');
});
test('financial and final human approval gates retain their own next action', () => {
  expect(
    operationsNextAction(execution('GLOBAL_DAILY_BUDGET_EXCEEDED'), prepared)
      ?.code,
  ).toBe('GLOBAL_DAILY_BUDGET_EXCEEDED');
  expect(
    operationsNextAction(
      execution('EXACT_HUMAN_APPROVAL_REQUIRED', [
        'EDITORIAL',
        'MEDIA_QC',
        'AUDIO',
        'QC',
        'PREVIEW',
      ]),
      prepared,
    )?.code,
  ).toBe('EXACT_HUMAN_APPROVAL_REQUIRED');
});
