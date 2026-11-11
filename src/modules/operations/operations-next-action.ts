type Pending = { code: string; message: string };
type Execution = {
  status: string;
  finalization: { completedSteps: string[]; pending?: Pending | null };
};
type Tts = {
  requestHash?: string;
  state?: string;
  audioConfirmed?: boolean;
  code?: string;
};

// Presentation only: never changes persisted workflow, authorization or QC evidence.
export function operationsNextAction(
  execution: Execution,
  tts?: Tts | null,
): Pending | null {
  const { completedSteps, pending } = execution.finalization;
  if (
    execution.status !== 'WAITING_INPUT' ||
    !completedSteps.includes('MEDIA_QC') ||
    completedSteps.includes('AUDIO')
  )
    return pending ?? null;
  const audioPending =
    !pending ||
    [
      'AUDIO_REQUIRED',
      'LOCAL_TTS_CONFIGURATION_REQUIRED',
      'LOCAL_TTS_LICENSE_REQUIRED',
      'LOCAL_TTS_EXECUTION_REQUIRED',
      'LOCAL_TTS_BUSY_REQUIRED',
      'NARRATION_DURATION_REQUIRED',
      'LOCAL_AUDIO_SELECTION_REQUIRED',
    ].includes(pending.code);
  if (!audioPending) return pending;
  if (
    tts?.code === 'NARRATION_DURATION_REQUIRED' ||
    (pending?.code === 'NARRATION_DURATION_REQUIRED' && tts?.audioConfirmed)
  )
    return {
      code: 'SCRIPT_REVISION_REQUIRED',
      message:
        'A narração do roteiro atual não cabe no vídeo em fala natural. Revise o texto preservando o CTA e os visuais aprovados.',
    };
  if (tts?.requestHash) {
    if (tts.audioConfirmed)
      return {
        code: 'TTS_CONTINUATION_REQUIRED',
        message:
          'Áudio OpenAI confirmado. A finalização continuará sem novo envio pago.',
      };
    if (['SUBMITTING', 'UNKNOWN'].includes(tts.state ?? ''))
      return {
        code: 'TTS_RECONCILIATION_REQUIRED',
        message:
          'O envio TTS está em processamento ou incerto. Aguarde confirmação ou reconciliação; novo envio está bloqueado.',
      };
    return {
      code: 'TTS_AUTHORIZATION_REQUIRED',
      message:
        'O roteiro atual está pronto para narração OpenAI. Confira o texto e autorize individualmente o risco financeiro abaixo. O QC visual aprovado será reutilizado.',
    };
  }
  if (pending?.code === 'NARRATION_DURATION_REQUIRED')
    return { code: 'SCRIPT_REVISION_REQUIRED', message: pending.message };
  return pending ?? null;
}
