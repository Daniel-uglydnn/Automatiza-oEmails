import type { Campaign } from '../domain/models.js';
import type { Delivery, Operations, Run } from '../domain/operations.js';

type API = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Action = (fn: () => Promise<unknown>, message: string) => Promise<void>;
export interface OperationData {
  settings: Operations;
  gmail: { connected: boolean; email: string | null };
  liveBlockReasons: string[];
  deliveries: Delivery[];
}
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const e = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const when = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
let state: OperationData;
let campaigns: Campaign[] = [];

function renderTable() {
  const value = (id: string) => $<HTMLInputElement>(id).value;
  const text = value('#table-search').toLowerCase(),
    niche = value('#table-niche'),
    score = Number(value('#table-score')),
    date = value('#table-date'),
    status = value('#table-status');
  const rows = campaigns.flatMap((c) => c.leads.map((l) => ({ campaign: c, lead: l })));
  $('#channel-rows').innerHTML =
    rows
      .filter(({ campaign: c, lead: l }) => {
        const d = state.deliveries.find((d) => d.channelId === l.channel.id);
        const statuses = [
          d?.status,
          d?.crmStage,
          l.simulation ? 'simulated' : l.assessment.eligible ? 'qualified' : 'pending',
        ];
        return (
          (!text ||
            `${l.channel.title} ${l.channel.id} ${l.channel.email ?? ''}`
              .toLowerCase()
              .includes(text)) &&
          (!niche || l.channel.discoveredFor === niche) &&
          l.assessment.score >= score &&
          (!date || c.createdAt.slice(0, 10) >= date) &&
          (!status || statuses.includes(status)) &&
          (!value('#table-subs-min') ||
            (l.channel.subscriberCount !== null &&
              l.channel.subscriberCount >= Number(value('#table-subs-min')))) &&
          (!value('#table-subs-max') ||
            (l.channel.subscriberCount !== null &&
              l.channel.subscriberCount <= Number(value('#table-subs-max'))))
        );
      })
      .map(({ campaign: c, lead: l }) => {
        const d = state.deliveries.find((d) => d.channelId === l.channel.id);
        return `<tr><td><button class="secondary open-channel" data-campaign="${c.id}" data-channel="${e(l.channel.id)}">${e(l.channel.title)}</button><small>${when(c.createdAt)}</small></td><td>${l.channel.discoveredFor}</td><td>${l.channel.subscriberCount ?? 'Não informado'}</td><td>${l.assessment.score}</td><td>${e(l.channel.email ?? 'Pendente')}</td><td>${e((d?.crmStage !== 'new' && d?.crmStage) || d?.status || (l.simulation ? 'Simulado' : l.assessment.eligible ? 'Qualificado' : 'Pendente'))}</td></tr>`;
      })
      .join('') || '<tr><td colspan="6">Nenhum canal neste filtro.</td></tr>';
}
export function renderOperations(data: OperationData, history: Campaign[], runs: Run[]) {
  state = data;
  campaigns = history;
  $('#operation-status').textContent =
    `${state.settings.paused ? 'Automação pausada' : 'Automação liberada para executar'} · Gmail: ${state.gmail.email ?? 'não conectado'} · Envio real: ${state.liveBlockReasons.length ? 'bloqueado' : 'autorizado'}`;
  $('#pause-toggle').textContent = state.settings.paused ? 'Retomar automação' : 'Pausar automação';
  $('#live-reasons').innerHTML = state.liveBlockReasons
    .map((reason) => `<li>${e(reason)}</li>`)
    .join('');
  $('#unsubscribe-test-status').textContent = state.settings.unsubscribeVerifiedAt
    ? `Última validação do descadastro: ${when(state.settings.unsubscribeVerifiedAt)}. O teste não autoriza envios reais.`
    : 'Descadastro ainda não validado. Clique em Testar descadastro após configurar a chave no Render.';
  const countryNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
  $('#jurisdiction-list').innerHTML =
    state.settings.jurisdictions
      .map(
        (rule) =>
          `<article class="panel"><h4>${e(countryNames.of(rule.country) ?? rule.country)} (${e(rule.country)})</h4><p>${e(rule.legalBasis)}</p><p class="muted">Revisão registrada em ${when(rule.reviewedAt)} · <a href="${e(rule.evidenceUrl)}" target="_blank" rel="noopener noreferrer">Consultar fonte</a></p><button type="button" class="secondary remove-jurisdiction" data-country="${e(rule.country)}">Remover país ${e(rule.country)}</button></article>`,
      )
      .join('') || '<p class="muted">Nenhum país revisado. O envio real permanece bloqueado.</p>';
  const form = $<HTMLFormElement>('#operation-form');
  const set = (name: string, value: string) =>
    ((form.elements.namedItem(name) as HTMLInputElement).value = value);
  set('businessName', state.settings.business?.name ?? 'Daniel');
  set('businessEmail', state.settings.business?.email ?? '');
  set('postalAddress', state.settings.business?.postalAddress ?? '');
  set('retentionDays', String(state.settings.retentionDays));
  set('jurisdictions', JSON.stringify(state.settings.jurisdictions, null, 2));
  (form.elements.namedItem('useAI') as HTMLInputElement).checked = state.settings.useAI;
  (form.elements.namedItem('reportEmail') as HTMLInputElement).checked =
    !!state.settings.reportEmail;
  $('#run-reports').innerHTML =
    [...runs]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(
        (run) =>
          `<article class="panel"><h3>${e(run.day)} · ${e(run.status)}</h3><p class="muted">${when(run.startedAt)} · ${e(run.id)}</p>${
            run.report
              ? `<div class="breakdown"><span>Encontrados ${run.report.discovered}</span><span>Qualificados ${run.report.qualified}</span><span>Minecraft ${run.report.minecraft}</span><span>Roblox ${run.report.roblox}</span><span>Contatos ${run.report.contacts}</span><span>Preparados ${run.report.prepared}</span><span>Enviados ${run.report.sent}</span><span>Simulados ${run.report.simulated}</span><span>Não enviados ${run.report.blocked}</span><span>Respostas ${run.report.replies}</span><span>Positivas ${run.report.positiveReplies}</span><span>Erros ${run.report.errors.length}</span></div><ul class="evidence">${Object.entries(
                  run.report.blockReasons,
                )
                  .map(([reason, count]) => `<li>${count} · ${e(reason)}</li>`)
                  .join(
                    '',
                  )}</ul><details><summary>10 melhores oportunidades e erros</summary><ol class="evidence">${run.report.top.map((t) => `<li><strong>${e(t.title)} · ${t.score}</strong><br>${e(t.url)}<br>${e(t.reason)}</li>`).join('')}</ol><p class="reasons">${run.report.errors.map(e).join(' · ') || 'Nenhum erro nesta execução.'}</p></details>`
              : '<p>Execução em andamento.</p>'
          }</article>`,
      )
      .join('') ||
    '<p class="empty">Execute um ciclo de simulação para gerar o primeiro relatório.</p>';
  $('#delivery-history').innerHTML =
    state.deliveries
      .map(
        (d) =>
          `<article class="panel"><h3>${e(d.recipient ?? 'Contato minimizado')} · ${e(d.status)}</h3><p class="muted">${when(d.createdAt)} · Gmail: ${e(d.gmailMessageId ?? 'Não confirmado')} · ${e(d.crmStage)}</p>${d.error ? `<p class="reasons">${e(d.error)}</p>` : ''}<details><summary>Consultar mensagem e respostas</summary><h3>${e(d.subject)}</h3><pre class="mail-body">${e(d.body || 'Corpo minimizado pela política de retenção.')}</pre><ul class="evidence">${d.replies.map((r) => `<li>${when(r.at)} · ${e(r.kind)} · ${e(r.note)}</li>`).join('')}</ul></details><form class="crm-form" data-id="${d.id}"><label>Resultado confirmado<select name="stage"><option value="positive">Resposta positiva</option><option value="negotiation">Em negociação</option><option value="won">Cliente conquistado</option><option value="negative">Recusa</option><option value="unsubscribe">Descadastro</option></select></label><button class="secondary">Registrar resultado</button></form></article>`,
      )
      .join('') ||
    '<p class="empty">Nenhum envio real foi registrado. Simulações aparecem nas fichas dos canais.</p>';
  renderTable();
}
export function initOperations(
  api: API,
  action: Action,
  download: () => Promise<void>,
  openChannel: (campaignId: string, channelId: string) => void,
) {
  for (const id of [
    '#table-search',
    '#table-niche',
    '#table-subs-min',
    '#table-subs-max',
    '#table-score',
    '#table-date',
    '#table-status',
  ])
    $(id).addEventListener('input', renderTable);
  $('#channel-rows').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.open-channel');
    if (button) openChannel(button.dataset.campaign!, button.dataset.channel!);
  });
  $('#export-csv').addEventListener('click', () => void action(download, 'CSV exportado.'));
  $('#pause-toggle').addEventListener(
    'click',
    () =>
      void action(
        () => api('/operations', 'PUT', { paused: !state.settings.paused }),
        'Estado da automação atualizado.',
      ),
  );
  $('#run-cycle').addEventListener(
    'click',
    () =>
      void action(
        () => api('/automation/run', 'POST', { simulate: true }),
        'Ciclo concluído; consulte o relatório. Nenhum e-mail foi enviado.',
      ),
  );
  $('#gmail-connect').addEventListener(
    'click',
    () =>
      void action(async () => {
        const result = await api<{ url: string }>('/gmail/connect', 'POST');
        const url = new URL(result.url);
        if (url.origin !== 'https://accounts.google.com') throw new Error('URL OAuth inválida.');
        window.location.assign(result.url);
      }, 'Abrindo autorização Google.'),
  );
  $('#gmail-validate').addEventListener(
    'click',
    () =>
      void action(
        () => api('/gmail/validate', 'POST'),
        'Credenciais Gmail validadas. Nenhum envio foi ativado.',
      ),
  );
  $('#sync-replies').addEventListener(
    'click',
    () => void action(() => api('/tracking/sync', 'POST'), 'Respostas sincronizadas.'),
  );
  $('#reconcile').addEventListener(
    'click',
    () =>
      void action(
        () => api('/deliveries/reconcile', 'POST'),
        'Reconciliação concluída. Nenhuma mensagem foi reenviada.',
      ),
  );
  $('#unsubscribe-test').addEventListener(
    'click',
    () =>
      void action(async () => {
        $('#unsubscribe-test-status').textContent =
          'Verificando a página pública e o bloqueio de um endereço fictício…';
        try {
          return await api('/operations/unsubscribe-test', 'POST');
        } catch (error) {
          $('#unsubscribe-test-status').textContent =
            'Teste não concluído. Confira a mensagem de erro acima.';
          throw error;
        }
      }, 'Descadastro verificado: a página pública registrou o bloqueio fictício no banco. Nenhum e-mail foi enviado e o envio real continua sujeito à autorização.'),
  );
  $('#revoke').addEventListener(
    'click',
    () =>
      void action(
        () => api('/operations/revoke', 'POST'),
        'Autorização revogada e automação pausada.',
      ),
  );
  $('#operation-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget as HTMLFormElement);
    void action(async () => {
      const email = String(f.get('businessEmail') ?? '');
      return api('/operations', 'PUT', {
        useAI: f.has('useAI'),
        retentionDays: Number(f.get('retentionDays')),
        business: email
          ? { name: f.get('businessName'), email, postalAddress: f.get('postalAddress') }
          : null,
        jurisdictions: JSON.parse(String(f.get('jurisdictions'))) as unknown,
        reportEmail: f.has('reportEmail') ? email : null,
      });
    }, 'Configuração salva. Alterações legais ou de identidade exigem nova autorização inicial.');
  });
  const jurisdictionForm = $<HTMLFormElement>('#jurisdiction-form');
  const guidance: Record<string, string> = {
    US: 'https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business',
    GB: 'https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/',
    CA: 'https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en',
    AU: 'https://www.acma.gov.au/avoiding-sending-spam',
  };
  const updateGuidance = () => {
    const country = (jurisdictionForm.elements.namedItem('country') as HTMLSelectElement).value;
    const url = guidance[country];
    $('#jurisdiction-guidance').hidden = !url;
    $('#jurisdiction-guidance').innerHTML = url
      ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">Consultar orientação oficial para este país</a>. Leia também as regras do Gmail; este formulário registra sua revisão, sem verificar automaticamente a legalidade dos contatos.`
      : '';
  };
  jurisdictionForm.addEventListener('change', updateGuidance);
  jurisdictionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const f = new FormData(jurisdictionForm);
    void action(async () => {
      await api('/operations/jurisdictions', 'POST', {
        country: f.get('country'),
        evidenceUrl: f.get('evidenceUrl'),
        legalBasis: f.get('legalBasis'),
        confirmed: f.has('confirmed'),
      });
      jurisdictionForm.reset();
      updateGuidance();
    }, 'Revisão do país registrada. Teste o descadastro novamente antes da ativação; nenhum envio foi autorizado por esta etapa.');
  });
  $('#jurisdiction-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.remove-jurisdiction');
    if (button)
      void action(
        () =>
          api(`/operations/jurisdictions/${encodeURIComponent(button.dataset.country!)}`, 'DELETE'),
        'País removido. A autorização anterior foi revogada.',
      );
  });
  $('#authorize-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget as HTMLFormElement);
    void action(
      () =>
        api('/operations/authorize', 'POST', {
          authorization: f.get('authorization'),
          identityReviewed: f.has('identityReviewed'),
          complianceReviewed: f.has('complianceReviewed'),
          unsubscribeReviewed: f.has('unsubscribeReviewed'),
        }),
      'Autorização inicial registrada. A rotina seguirá os limites e jurisdições configurados.',
    );
  });
  $('#delivery-history').addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    if (!form.matches('.crm-form')) return;
    event.preventDefault();
    const f = new FormData(form);
    void action(
      () => api(`/deliveries/${form.dataset.id}/stage`, 'PUT', { stage: f.get('stage') }),
      'Resultado confirmado e registrado.',
    );
  });
}
