import type { OperationalNotificationKind } from '../application/operational-notification.port.js';
export const authenticationCodes = new Set([
  'SOCIAL_AUTH_REQUIRED',
  'SOCIAL_PERMISSION_REQUIRED',
  'SOCIAL_INSTAGRAM_CONFIGURATION_REQUIRED',
  'SOCIAL_CONFIG_INVALID',
  'SOCIAL_DESTINATION_INVALID',
]);
const publicErrors: Record<string, string> = {
  SOCIAL_API_REJECTED: 'A plataforma rejeitou a operação.',
  SOCIAL_PUBLICATION_FAILED: 'A publicação falhou.',
  HANDOFF_MEDIA_CHANGED: 'A mídia aprovada mudou.',
  QC_FAILED: 'A verificação de qualidade falhou.',
  SOCIAL_LIVE_POST_BLOCKED: 'A configuração atual bloqueia publicação real.',
  CAMPAIGN_STEP_FAILED: 'A operação falhou e requer verificação.',
};
export function publicError(code: unknown) {
  return typeof code === 'string' && Object.hasOwn(publicErrors, code)
    ? code
    : 'OPERATION_FAILED';
}
export function safeLabel(raw: unknown) {
  const printable = (typeof raw === 'string' ? raw : '').replace(
    /\p{Cc}/gu,
    ' ',
  );
  return (
    printable
      .replace(
        /https?:\/\/\S+|[a-z]:[\\/]\S+|bearer\s+\S+|(?:sk-|bot\d+:)\S+|\d{5,20}:[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,}/gi,
        '[redigido]',
      )
      .slice(0, 120)
      .trim() || 'Não informado'
  );
}
export function publicPermalink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' &&
      /^[a-z0-9.-]+\.[a-z]{2,63}$/i.test(url.hostname) &&
      !/\.(?:localhost|local|internal|invalid)$/i.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(url.pathname)
      ? `${url.origin}${url.pathname}`
      : null;
  } catch {
    return null;
  }
}
export function notificationText(
  kind: OperationalNotificationKind,
  context: {
    campaign: unknown;
    product: unknown;
    day: string;
    destination?: unknown;
    step?: unknown;
    code?: unknown;
    permalink?: unknown;
    fake?: boolean;
  },
) {
  const stepNames: Record<string, string> = {
    PUBLICATION: 'Publicação',
    HANDOFF: 'Aprovação/finalização',
    EDITORIAL: 'Editorial',
    AUDIO: 'Áudio',
    QC: 'Qualidade',
    CONTEXT: 'Contexto',
    COMPOSITION: 'Composição',
    BURN: 'Render',
    MEDIA_QC: 'Revisão de mídia',
  };
  const texts: Record<OperationalNotificationKind, string> = {
    RENDER_READY_FOR_REVIEW:
      'Vídeo pronto. Revise e aprove o render no MKTauto.',
    PACKAGE_READY_FOR_REVIEW:
      'Pacote e legenda exatos aguardam revisão/aprovação no MKTauto.',
    PUBLICATION_SUCCEEDED: 'Publicação confirmada; recibo registrado.',
    NO_ELIGIBLE_PRODUCT:
      'Nenhum produto elegível. Revise o catálogo, link, evidências e imagem autorizada no MKTauto.',
    PUBLICATION_UNCERTAIN:
      'Não reenviar manualmente; reconciliação necessária.',
    AUTH_CONFIGURATION_REQUIRED:
      'Revise credenciais/permissões e configuração da plataforma no MKTauto.',
    OPERATION_FAILED:
      'A execução exige intervenção. Verifique o estado no MKTauto antes de retomar.',
  };
  const lines = [
    `MKTauto${context.fake ? ' — SIMULAÇÃO' : ''}`,
    `Campanha: ${safeLabel(context.campaign)}`,
    `Produto: ${safeLabel(context.product)}`,
    `Produção: ${context.day}`,
    texts[kind],
  ];
  if (context.destination)
    lines.push(`Destino: ${safeLabel(context.destination)}`);
  if (kind === 'OPERATION_FAILED') {
    const code = publicError(context.code);
    lines.push(
      `Etapa: ${stepNames[String(context.step)] ?? 'Operação'}`,
      `Erro: ${code}`,
    );
    if (publicErrors[code]) lines.push(publicErrors[code]);
  }
  const permalink =
    kind === 'PUBLICATION_SUCCEEDED'
      ? publicPermalink(context.permalink)
      : null;
  if (permalink) lines.push(permalink);
  return lines.join('\n');
}
