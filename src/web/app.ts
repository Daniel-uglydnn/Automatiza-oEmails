import type { Campaign, Lead, Rules } from '../domain/models.js';
import type { ProspectingService } from '../services/prospecting.js';
import type { Run } from '../domain/operations.js';
import { initOperations, renderOperations, type OperationData } from './operations.js';

type Dashboard = Awaited<ReturnType<ProspectingService['dashboard']>>;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const format = (n: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const date = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
let dashboard: Dashboard;
let campaignId = '';
let authToken = ''; // Memória da aba: não persistir tokens no navegador.
let busy = false;

function notify(message: string, error = false) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.className = `notice${error ? ' error' : ''}`;
  notice.hidden = false;
}
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json()) as { error?: string; details?: string[] };
  if (!response.ok) {
    if (response.status === 401) $('#connection').hidden = false;
    throw new Error(
      [data.error ?? 'Não foi possível concluir.', ...(data.details ?? [])].join(' '),
    );
  }
  return data as T;
}
async function action(operation: () => Promise<unknown>, message: string) {
  if (busy) return;
  busy = true;
  document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
  try {
    await operation();
    await load();
    notify(message);
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Falha ao executar a operação.', true);
  } finally {
    busy = false;
    document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = false));
  }
}
const rulesFields: Array<[keyof Rules, string, number, number]> = [
  ['discoveryDailyLimit', 'Novos canais / dia', 1, 100],
  ['minecraftPercent', 'Minecraft (%) · restante Roblox', 0, 100],
  ['subscriberMin', 'Inscritos · prioridade mínima', 0, 1000000000],
  ['subscriberMax', 'Inscritos · prioridade máxima', 1, 1000000000],
  ['priorityActiveDays', 'Atividade · prioridade (dias)', 1, 60],
  ['maxActiveDays', 'Atividade · máximo (dias)', 1, 60],
  ['minimumScore', 'Pontuação mínima', 0, 100],
  ['dailyContactLimit', 'Limite de contatos / dia', 1, 100],
  ['youtubeSearchBudget', 'Buscas YouTube / execução', 2, 30],
];
const weightLabels = {
  niche: 'Nicho',
  activity: 'Atividade',
  commercial: 'Potencial comercial',
  editing: 'Edição',
  contact: 'Contato',
};

function renderRules() {
  $('#rule-inputs').innerHTML = rulesFields
    .map(
      ([key, label, min, max]) =>
        `<label>${escape(label)}<input type="number" name="${key}" min="${min}" max="${max}" value="${dashboard.rules[key]}" required></label>`,
    )
    .join('');
  $('#weight-inputs').innerHTML = Object.entries(dashboard.rules.weights)
    .map(
      ([key, value]) =>
        `<label>${weightLabels[key as keyof typeof weightLabels]}<input type="number" name="weight-${key}" min="0" max="100" value="${value}" required></label>`,
    )
    .join('');
}
function leadCard(campaign: Campaign, lead: Lead): string {
  const { channel: c, assessment: a, review, draft } = lead;
  const blocked = dashboard.suppressions.some((s) => s.email === c.email);
  const status = blocked
    ? 'Bloqueado'
    : lead.response
      ? 'Resposta registrada'
      : lead.simulation
        ? 'Simulado'
        : a.eligible
          ? 'Qualificado'
          : 'Pendente';
  const endpoint = `/campaigns/${campaign.id}/leads/${encodeURIComponent(c.id)}`;
  const title =
    campaign.mode === 'demo'
      ? escape(c.title)
      : `<a href="https://www.youtube.com/channel/${encodeURIComponent(c.id)}" target="_blank" rel="noopener noreferrer">${escape(c.title)}</a>`;
  return `<article class="lead-card"><div class="lead-top"><div class="score ${a.eligible ? '' : 'pending'}" aria-label="Pontuação ${a.score} de 100">${a.score}</div><div class="lead-title"><h3>${title}</h3><p>${c.discoveredFor === 'minecraft' ? 'Minecraft' : 'Roblox'} · ${c.subscriberCount === null ? 'Inscritos ocultos' : `${format(c.subscriberCount)} inscritos`} · País: ${escape(c.country ?? 'não informado')}</p><p>${escape(c.email ?? 'Contato comercial pendente')}</p></div><span class="pill ${a.eligible && !blocked ? '' : 'pending'}">${status}</span></div><details><summary>Ver evidências e proposta</summary><div class="lead-content" data-endpoint="${endpoint}"><div class="breakdown">${Object.entries(
    a.breakdown,
  )
    .map(
      ([key, value]) =>
        `<span>${weightLabels[key as keyof typeof weightLabels]} ${value}/${campaign.rules.weights[key as keyof typeof weightLabels]}</span>`,
    )
    .join(
      '',
    )}</div>${a.reasons.length ? `<p class="reasons">${a.reasons.map(escape).join(' · ')}</p>` : ''}<ul class="evidence">${[...a.evidence, ...lead.suggestions].map((e) => `<li>${escape(e)}</li>`).join('')}</ul>
  <form class="review-form"><h3>Revisão com evidências</h3><div class="form-grid"><label>Idioma predominante<select name="language">${[
    ['unknown', 'Usar metadata / desconhecido'],
    ['en', 'Inglês verificado'],
    ['pt', 'Português'],
    ['other', 'Outro'],
  ]
    .map(
      ([v, label]) =>
        `<option value="${v}" ${review.language === v ? 'selected' : ''}>${label}</option>`,
    )
    .join('')}</select></label><label>Nicho verificado<select name="niche">${[
    ['unknown', 'Usar metadata / desconhecido'],
    ['minecraft', 'Minecraft'],
    ['roblox', 'Roblox'],
    ['other', 'Fora do alvo'],
  ]
    .map(
      ([v, label]) =>
        `<option value="${v}" ${review.niche === v ? 'selected' : ''}>${label}</option>`,
    )
    .join(
      '',
    )}</select></label><label>Oportunidade de edição (0–1)<input name="editingRating" type="number" min="0" max="1" step="0.05" value="${review.editingRating}" required></label></div><label>Evidência de idioma/nicho<textarea name="languageEvidence" placeholder="O que foi verificado na amostra de vídeos?">${escape(review.languageEvidence)}</textarea></label><label>Oportunidade concreta de edição<textarea name="editingEvidence" placeholder="Vídeo, timestamp e observação específica, sem críticas agressivas.">${escape(review.editingEvidence)}</textarea></label><label>Fonte pública da avaliação<input name="evidenceUrl" type="url" placeholder="https://www.youtube.com/watch?v=…" value="${escape(review.evidenceUrl ?? '')}"></label><label class="check"><input type="checkbox" name="messageApproved" ${review.messageApproved ? 'checked' : ''}> Revisei a proposta e confirmei seus fatos.</label><button class="secondary">Salvar avaliação</button></form>
  ${!lead.simulation && !lead.response ? `<form class="contact-form"><h3>Contato comercial público</h3><label>E-mail<input name="email" type="email" value="${escape(c.email ?? '')}" required></label><label>URL pública da fonte<input name="sourceUrl" type="url" value="${escape(c.contactUrl ?? '')}" required></label><label>Contexto comercial da publicação<input name="note" minlength="10" maxlength="1000" value="${escape(c.contactNote ?? '')}" required></label><label class="check"><input type="checkbox" name="publicBusinessContact" required> O criador ou representante publicou este contato para negócios.</label><button class="secondary">Registrar contato</button></form>` : ''}
  ${draft ? `<form class="draft-form"><h3>Proposta em inglês · ${draft.source === 'openai' ? 'OpenAI' : 'modelo com dados reais'}</h3><label>Assunto<input name="subject" maxlength="160" value="${escape(draft.subject)}" ${lead.simulation ? 'readonly' : ''} required></label><label>Mensagem · 80 a 140 palavras<textarea name="body" ${lead.simulation ? 'readonly' : ''} required>${escape(draft.body)}</textarea></label><p class="muted">Assinatura e identificação comercial deverão ser validadas antes de qualquer ativação de envio. A simulação não envia esta proposta.</p>${!lead.simulation ? '<div class="actions"><button class="secondary">Salvar proposta</button><button type="button" class="secondary ai-draft">Gerar com OpenAI</button></div>' : ''}</form>` : a.eligible ? '<button type="button" class="secondary template-draft">Preparar proposta</button>' : ''}
  ${lead.simulation ? `<p class="simulation">SIMULAÇÃO · NÃO ENVIADO<br>${date(lead.simulation.at)} · ${escape(lead.simulation.recipient)}</p>` : ''}
  <form class="response-form"><h3>Registrar resposta manualmente</h3><p class="muted">Consulte também as respostas sincronizadas no histórico de entrega.</p><div class="form-grid"><label>Resultado<select name="kind"><option value="positive">Resposta positiva</option><option value="negotiation">Em negociação</option><option value="won">Cliente confirmado</option><option value="negative">Recusa / resposta negativa</option><option value="unsubscribe">Pedido de descadastro</option></select></label><label>Observação<input name="note" maxlength="1000" placeholder="Contexto da resposta recebida"></label></div><button class="secondary">Registrar resposta</button>${lead.response ? `<p class="muted">Registro: ${escape(lead.response.kind)} · ${date(lead.response.at)} · ${escape(lead.response.note)}</p>` : ''}</form></div></details></article>`;
}
function renderLeads() {
  const campaign = dashboard.campaigns.find((c) => c.id === campaignId);
  $('#simulate').hidden = !campaign;
  if (!campaign) {
    $('#leads').innerHTML =
      '<div class="empty">Seu pipeline está pronto para começar.<br>Pesquise canais para preparar a primeira abordagem.</div>';
    $('#campaign-notes').textContent = '';
    return;
  }
  $('#campaign-notes').textContent = campaign.warnings.join(' ');
  const filter = $<HTMLSelectElement>('#lead-filter').value;
  const leads = campaign.leads.filter(
    (l) =>
      filter === 'all' ||
      (filter === 'qualified' && l.assessment.eligible) ||
      (filter === 'pending' && !l.assessment.eligible) ||
      (filter === 'simulated' && !!l.simulation),
  );
  $('#leads').innerHTML =
    leads.map((l) => leadCard(campaign, l)).join('') ||
    '<div class="empty">Nenhum canal neste filtro. Os canais já conhecidos não são adicionados novamente.</div>';
  document.querySelectorAll<HTMLElement>('[data-endpoint]').forEach((container) => {
    const path = container.dataset.endpoint!;
    container
      .querySelector<HTMLFormElement>('.review-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget as HTMLFormElement);
        void action(
          () =>
            api(`${path}/review`, 'PUT', {
              language: f.get('language'),
              niche: f.get('niche'),
              languageEvidence: f.get('languageEvidence'),
              editingRating: Number(f.get('editingRating')),
              editingEvidence: f.get('editingEvidence'),
              evidenceUrl: f.get('evidenceUrl') || null,
              messageApproved: f.has('messageApproved'),
            }),
          'Avaliação atualizada.',
        );
      });
    container
      .querySelector<HTMLFormElement>('.contact-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget as HTMLFormElement);
        void action(
          () =>
            api(`${path}/contact`, 'PUT', {
              email: f.get('email'),
              sourceUrl: f.get('sourceUrl'),
              note: f.get('note'),
              publicBusinessContact: f.has('publicBusinessContact'),
            }),
          'Contato registrado com sua fonte.',
        );
      });
    container.querySelector<HTMLFormElement>('.draft-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const f = new FormData(event.currentTarget as HTMLFormElement);
      void action(
        () =>
          api(`${path}/draft`, 'POST', {
            message: { subject: f.get('subject'), body: f.get('body') },
          }),
        'Proposta salva; revise antes de aprovar.',
      );
    });
    container
      .querySelector('.ai-draft')
      ?.addEventListener(
        'click',
        () =>
          void action(
            () => api(`${path}/draft`, 'POST', { useAI: true }),
            'Proposta gerada. Revise os fatos e o texto.',
          ),
      );
    container
      .querySelector('.template-draft')
      ?.addEventListener(
        'click',
        () => void action(() => api(`${path}/draft`, 'POST', {}), 'Proposta preparada.'),
      );
    container
      .querySelector<HTMLFormElement>('.response-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget as HTMLFormElement);
        void action(
          () => api(`${path}/response`, 'POST', { kind: f.get('kind'), note: f.get('note') }),
          'Resposta registrada. Recusas e descadastros ficam bloqueados.',
        );
      });
  });
}
async function load() {
  dashboard = await api<Dashboard>('/dashboard');
  const operationData = await api<OperationData>('/operations');
  renderOperations(operationData, dashboard.campaigns, await api<Run[]>('/reports'));
  $('#delivery-badge').textContent = operationData.liveBlockReasons.length
    ? 'ENVIO REAL BLOQUEADO'
    : 'ENVIO REAL AUTORIZADO';
  $('#sidebar-mode').textContent = operationData.liveBlockReasons.length
    ? 'Envio real bloqueado'
    : 'Envio real autorizado';
  $('#delivery-rule-badge').textContent = operationData.liveBlockReasons.length
    ? 'Envio real bloqueado'
    : 'Envio real autorizado';
  $('#delivery-note').textContent = operationData.liveBlockReasons.length
    ? 'Simulações não enviam e-mails.'
    : 'Automação segue limites e jurisdições.';
  $('#connection').hidden = true;
  const s = dashboard.stats;
  $('#stats').innerHTML = [
    ['Canais encontrados', s.discovered, 'Histórico de descoberta'],
    ['Qualificados', s.qualified, 'Evidências e pontuação'],
    ['Contatos comerciais', s.businessContacts, 'Com fonte registrada'],
    ['Propostas simuladas', s.simulated, 'Nenhuma entrega real'],
    ['E-mails enviados', s.sent, 'Confirmados pelo Gmail'],
    ['Respostas registradas', s.replies, 'Gmail + registros confirmados'],
    ['Preparadas', s.prepared, 'Propostas personalizadas'],
    ['Respostas positivas', s.positiveReplies, 'Confirmadas pelo operador'],
    ['Em negociação', s.negotiation, 'Status confirmado'],
    ['Clientes conquistados', s.won, 'Confirmação manual'],
    [
      'Taxa de respostas',
      s.responseRate === null ? '—' : `${(s.responseRate * 100).toFixed(1)}%`,
      'Base: propostas enviadas',
    ],
    [
      'Conversão',
      s.conversionRate === null ? '—' : `${(s.conversionRate * 100).toFixed(1)}%`,
      'Base: propostas enviadas',
    ],
  ]
    .map(
      ([label, value, note]) =>
        `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`,
    )
    .join('');
  $('#daily-progress').textContent =
    `Hoje: ${s.discoveredToday}/${dashboard.rules.discoveryDailyLimit} canais novos · ${s.simulatedToday}/${dashboard.rules.dailyContactLimit} contatos simulados. ${dashboard.mode === 'demo' ? 'Demonstração com 8 canais fictícios.' : 'Descoberta real no YouTube.'}`;
  if (!dashboard.campaigns.some((c) => c.id === campaignId))
    campaignId = dashboard.campaigns[0]?.id ?? '';
  $('#campaign-select').innerHTML =
    dashboard.campaigns
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === campaignId ? 'selected' : ''}>${date(c.createdAt)} · ${c.leads.length} canais · ${escape(c.input.query || 'Minecraft + Roblox')}</option>`,
      )
      .join('') || '<option>Sem pesquisas</option>';
  renderLeads();
  renderRules();
  $('#blocks').innerHTML =
    dashboard.suppressions
      .map(
        (b) =>
          `<div class="block-row">${b.email.startsWith('unsubscribe-self-test-') && b.email.endsWith('@example.invalid') ? 'TESTE DE DESCADASTRO · endereço fictício' : escape(b.email)} · ${escape(b.reason)} · ${date(b.createdAt)}</div>`,
      )
      .join('') || '<p class="muted">Nenhum endereço bloqueado.</p>';
  $('#errors').innerHTML =
    dashboard.errors
      .map((e) => `<div class="error-row"><time>${date(e.at)}</time>${escape(e.message)}</div>`)
      .join('') || '<span class="muted">Nenhum erro registrado.</span>';
  const integrations =
    await api<Record<string, { configured?: boolean; active?: boolean }>>('/integrations');
  $('#integration-cards').innerHTML = [
    ['youtube', 'YouTube', 'Descoberta e metadata'],
    [
      'openai',
      'OpenAI',
      integrations.openai?.configured ? 'Propostas sob demanda' : 'Propostas pelo modelo padrão',
    ],
    [
      'gmail',
      'Gmail',
      operationData.liveBlockReasons.length ? 'Envio real bloqueado' : 'Envio real autorizado',
    ],
    ['supabase', 'Supabase', 'Histórico persistente'],
  ]
    .map(([key, title, description]) => {
      const configured = !!integrations[key!]?.configured;
      const connected = key === 'gmail' && operationData.gmail.connected;
      const optional = key === 'openai' && !configured;
      const status = connected
        ? 'Conta conectada'
        : configured
          ? 'Credencial presente'
          : optional
            ? 'Opcional · sem IA'
            : 'Configuração pendente';
      return `<div class="integration"><h3>${title}</h3><span class="pill ${configured || connected || optional ? '' : 'pending'}">${status}</span><p>${description}</p></div>`;
    })
    .join('');
}
$('#auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  authToken = $<HTMLInputElement>('#auth-token').value;
  void action(load, 'Conexão estabelecida.');
});
$('#discover-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const f = new FormData(event.currentTarget as HTMLFormElement);
  notify(
    'Pesquisando e verificando as publicações. Na consulta real isso pode levar alguns minutos.',
  );
  void action(async () => {
    const campaign = await api<Campaign>('/campaigns', 'POST', {
      query: f.get('query'),
      maxResults: Number(f.get('maxResults')),
    });
    campaignId = campaign.id;
  }, 'Pesquisa concluída. Confira as evidências de cada canal.');
});
$('#simulate').addEventListener(
  'click',
  () =>
    void action(async () => {
      const result = await api<{ simulated: number }>(`/campaigns/${campaignId}/simulate`, 'POST');
      return result;
    }, 'Simulação concluída. Histórico, bloqueios e limite diário foram respeitados. Nenhum e-mail foi enviado.'),
);
$('#campaign-select').addEventListener('change', (event) => {
  campaignId = (event.target as HTMLSelectElement).value;
  renderLeads();
});
$('#lead-filter').addEventListener('change', renderLeads);
$('#refresh').addEventListener('click', () => void action(load, 'Histórico atualizado.'));
$('#refresh-reports').addEventListener(
  'click',
  () => void action(load, 'Relatórios atualizados com os dados do servidor.'),
);
$('#rules-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const f = new FormData(event.currentTarget as HTMLFormElement);
  const rules = {
    ...dashboard.rules,
    ...Object.fromEntries(rulesFields.map(([key]) => [key, Number(f.get(key))])),
    weights: Object.fromEntries(
      Object.keys(weightLabels).map((key) => [key, Number(f.get(`weight-${key}`))]),
    ),
  };
  void action(
    () => api('/rules', 'PUT', { rules, complianceReviewed: f.has('complianceReviewed') }),
    'Regras salvas. A autorização de envio depende da configuração operacional.',
  );
});
$('#block-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const f = new FormData(event.currentTarget as HTMLFormElement);
  void action(
    () => api('/suppressions', 'POST', { email: f.get('email') }),
    'Endereço bloqueado em todas as campanhas.',
  );
});
initOperations(
  api,
  action,
  async () => {
    const response = await fetch('/api/export.csv', {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!response.ok) throw new Error('Não foi possível exportar o CSV. Verifique a autenticação.');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'prospeccao.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  },
  (id, channelId) => {
    campaignId = id;
    $<HTMLSelectElement>('#campaign-select').value = id;
    $<HTMLSelectElement>('#lead-filter').value = 'all';
    renderLeads();
    const path = `/campaigns/${id}/leads/${encodeURIComponent(channelId)}`;
    const container = [...document.querySelectorAll<HTMLElement>('[data-endpoint]')].find(
      (node) => node.dataset.endpoint === path,
    );
    const details = container?.closest('details');
    if (details) {
      details.open = true;
      details.scrollIntoView({ behavior: 'smooth' });
    }
  },
);
void load().catch((error) =>
  notify(error instanceof Error ? error.message : 'Não foi possível carregar o dashboard.', true),
);
