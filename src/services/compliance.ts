import type { Config } from '../config.js';
import type { Lead } from '../domain/models.js';
import { gmailScopes, type Account, type Operations } from '../domain/operations.js';
import { validateMessage } from '../providers/messages.js';

export function activationReasons(
  config: Config,
  settings: Operations,
  account: Account | null,
): string[] {
  const reasons: string[] = [];
  if (config.ENABLE_LIVE_SENDS !== 'true' || config.DELIVERY_MODE !== 'live')
    reasons.push('Envio real desativado nas variáveis do servidor.');
  if (config.APP_MODE !== 'live' || config.STORAGE_DRIVER !== 'supabase')
    reasons.push('Envio real exige descoberta real e banco Supabase persistente.');
  if (!config.API_AUTH_TOKEN || !config.PUBLIC_ORIGIN || !config.UNSUBSCRIBE_SIGNING_KEY)
    reasons.push('Faltam autenticação administrativa, origem HTTPS ou chave de descadastro.');
  if (settings.paused) reasons.push('Automação pausada.');
  if (settings.breaker) reasons.push(`Envios interrompidos: ${settings.breaker}`);
  if (!settings.authorizedAt) reasons.push('Autorização inicial de envio pendente.');
  if (!settings.business) reasons.push('Identidade e endereço comercial pendentes.');
  if (!settings.unsubscribeVerifiedAt) reasons.push('Descadastro público ainda não validado.');
  if (!settings.jurisdictions.length) reasons.push('Nenhuma jurisdição autorizada.');
  if (!account || !gmailScopes.every((scope) => account.scopes.includes(scope)))
    reasons.push('Conta Gmail e permissões ainda não validadas.');
  if (account && settings.business && account.email !== settings.business.email)
    reasons.push('Remetente comercial diferente da conta Gmail autorizada.');
  return reasons;
}
export function personalizationReasons(lead: Lead): string[] {
  if (!lead.draft) return ['Proposta ainda não preparada.'];
  try {
    validateMessage({ subject: lead.draft.subject, body: lead.draft.body });
  } catch {
    return ['Proposta reprovada na validação de tamanho, portfólios ou alegações.'];
  }
  const body = lead.draft.body.toLowerCase();
  const specific = lead.channel.videos.some((v) => {
    const prefix = v.title.split(/\s+/).slice(0, 10).join(' ').slice(0, 100).toLowerCase();
    return (
      body.includes(`https://www.youtube.com/watch?v=${v.id}`.toLowerCase()) ||
      (prefix.length >= 12 && body.includes(prefix))
    );
  });
  return specific
    ? []
    : ['Sem referência verificável a um vídeo específico; não enviar automaticamente.'];
}
export function recipientReasons(lead: Lead, settings: Operations, now: Date): string[] {
  const reasons = [...lead.assessment.reasons, ...personalizationReasons(lead)];
  if (
    !lead.channel.email ||
    !lead.channel.contactUrl ||
    !lead.channel.contactVerifiedAt ||
    lead.channel.contactConfidence === 'unverified'
  )
    reasons.push('Contato comercial sem fonte, confiança ou data de verificação.');
  if (lead.channel.contactSource === 'demo' || lead.channel.email?.endsWith('.invalid'))
    reasons.push('Contato fictício não pode receber envio real.');
  if (
    lead.channel.contactVerifiedAt &&
    now.getTime() - Date.parse(lead.channel.contactVerifiedAt) > 30 * 86400000
  )
    reasons.push('Contato precisa ser reverificado após 30 dias.');
  const jurisdiction = settings.jurisdictions.find(
    (rule) => rule.country === lead.channel.country?.toUpperCase(),
  );
  if (!jurisdiction || Date.parse(jurisdiction.reviewedAt) > now.getTime())
    reasons.push('País desconhecido ou sem base legal/requisitos revisados.');
  if (lead.response) reasons.push('Canal já possui resposta registrada.');
  return [...new Set(reasons)];
}
