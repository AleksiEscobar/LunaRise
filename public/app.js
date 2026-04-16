const serverStatusEl = document.getElementById('server-status');
const aiStatusEl = document.getElementById('ai-status');
const resultLog = document.getElementById('result-log');
const leadsTable = document.getElementById('leads-table');
const detailId = document.getElementById('detail-id');
const detailStatus = document.getElementById('detail-status');
const detailMetadata = document.getElementById('detail-metadata');
const leadsCountEl = document.getElementById('leads-count');
const selectedLeadEl = document.getElementById('selected-lead');
const lastActionEl = document.getElementById('last-action');
const generatedAnalysisEl = document.getElementById('generated-analysis');
const generatedResponseEl = document.getElementById('generated-response');

const api = async (path, method = 'GET', body) => {
  const config = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) config.body = JSON.stringify(body);
  const response = await fetch(path, config);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `${response.status} ${response.statusText}`);
  return data;
};

const log = (title, payload) => {
  const entry = `=== ${title} ===\n${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}\n\n`;
  resultLog.textContent = entry + resultLog.textContent;
  lastActionEl.textContent = title;
};

const refreshStatus = async () => {
  try {
    const server = await api('/status');
    serverStatusEl.textContent = JSON.stringify(server, null, 2);
  } catch (error) {
    serverStatusEl.textContent = `Error: ${error.message}`;
    log('Error estado servidor', error.message);
  }
  try {
    const ai = await api('/ai/status');
    aiStatusEl.textContent = JSON.stringify(ai, null, 2);
  } catch (error) {
    aiStatusEl.textContent = `Error: ${error.message}`;
    log('Error estado IA', error.message);
  }
};

const loadLeads = async () => {
  try {
    const response = await api('/leads');
    leadsTable.innerHTML = '';
    response.leads.forEach((lead) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${lead.id.slice(0, 10)}</td>
        <td>${lead.number}</td>
        <td>${lead.status}</td>
        <td>${lead.niche || 'n/a'}</td>
        <td>
          <button data-id="${lead.id}" class="view-detail">Ver</button>
          <button data-id="${lead.id}" class="qualify">Calificar</button>
          <button data-id="${lead.id}" class="notify">Notificar</button>
        </td>
      `;
      leadsTable.appendChild(row);
    });
    leadsCountEl.textContent = response.leads.length;
  } catch (error) {
    log('Error cargando leads', error.message);
  }
};

const loadLeadDetail = async (id) => {
  if (!id) return;
  try {
    const response = await api(`/leads/${id}`);
    const lead = response.lead;
    detailId.value = lead.id;
    detailStatus.value = lead.status;
    detailMetadata.value = JSON.stringify(lead.metadata || {}, null, 2);
    generatedAnalysisEl.value = lead.analysis || '';
    generatedResponseEl.value = lead.ai_response || '';
    selectedLeadEl.textContent = lead.id.slice(0, 10);
    log('Detalle de lead cargado', lead);
  } catch (error) {
    log('Error cargando detalle', error.message);
  }
};

const updateLead = async () => {
  try {
    const id = detailId.value.trim();
    if (!id) throw new Error('Selecciona un lead primero');
    const payload = {
      status: detailStatus.value,
      metadata: JSON.parse(detailMetadata.value || '{}'),
    };
    const response = await api(`/leads/${id}`, 'PATCH', payload);
    log('Lead actualizado', response.lead);
    loadLeads();
    loadLeadDetail(id);
  } catch (error) {
    log('Error actualizando lead', error.message);
  }
};

const qualifyLead = async (id = null) => {
  try {
    const leadId = id || detailId.value.trim();
    if (!leadId) throw new Error('Selecciona un lead primero');
    const response = await api(`/leads/${leadId}/qualify`, 'POST');
    log('Lead calificado', response);
    loadLeads();
    loadLeadDetail(leadId);
  } catch (error) {
    log('Error calificando lead', error.message);
  }
};

const notifyLead = async (id = null) => {
  try {
    const leadId = id || detailId.value.trim();
    if (!leadId) throw new Error('Selecciona un lead primero');
    const response = await api(`/leads/${leadId}/notify`, 'POST');
    log('Lead notificado', response);
  } catch (error) {
    log('Error notificando lead', error.message);
  }
};

const sendWhatsApp = async () => {
  try {
    const number = document.getElementById('send-number').value.trim();
    const message = document.getElementById('send-message').value.trim();
    if (!number || !message) throw new Error('Ingresa número y mensaje');
    const response = await api('/send', 'POST', { number, message });
    log('WhatsApp enviado', response);
  } catch (error) {
    log('Error enviando WhatsApp', error.message);
  }
};

const createLead = async () => {
  try {
    const number = document.getElementById('lead-number').value.trim();
    const message = document.getElementById('lead-message').value.trim();
    const niche = document.getElementById('lead-niche').value.trim();
    if (!number || !message) throw new Error('Ingresa número y mensaje del lead');
    const response = await api('/lead/convert', 'POST', { number, message, niche });
    log('Lead creado / convertido', response.lead);
    loadLeads();
    loadLeadDetail(response.lead.id);
  } catch (error) {
    log('Error creando lead', error.message);
  }
};

const sendAI = async (mode) => {
  try {
    const number = document.getElementById('ai-number').value.trim();
    const prompt = document.getElementById('ai-prompt').value.trim();
    if (!number || !prompt) throw new Error('Ingresa número y prompt');
    const path = mode === 'market' ? '/market' : '/ai';
    const body = mode === 'market' ? { number, query: prompt } : { number, prompt };
    const response = await api(path, 'POST', body);
    log(`${mode === 'market' ? 'Market' : 'IA'} enviado`, response);
  } catch (error) {
    log(`Error en ${mode === 'market' ? 'Market' : 'IA'}`, error.message);
  }
};

const setupEvents = () => {
  document.getElementById('refresh-status').addEventListener('click', refreshStatus);
  document.getElementById('refresh-leads').addEventListener('click', loadLeads);
  document.getElementById('load-detail').addEventListener('click', () => loadLeadDetail(detailId.value));
  document.getElementById('patch-detail').addEventListener('click', updateLead);
  document.getElementById('qualify-lead').addEventListener('click', () => qualifyLead());
  document.getElementById('qualify-lead-detail').addEventListener('click', () => qualifyLead());
  document.getElementById('notify-lead').addEventListener('click', () => notifyLead());
  document.getElementById('notify-lead-detail').addEventListener('click', () => notifyLead());
  document.getElementById('send-button').addEventListener('click', sendWhatsApp);
  document.getElementById('send-button-duplicate').addEventListener('click', sendWhatsApp);
  document.getElementById('create-lead').addEventListener('click', createLead);
  document.getElementById('convert-lead').addEventListener('click', createLead);
  document.getElementById('ai-button').addEventListener('click', () => sendAI('ai'));
  document.getElementById('market-button').addEventListener('click', () => sendAI('market'));

  leadsTable.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const id = button.dataset.id;
    if (!id) return;
    if (button.classList.contains('view-detail')) {
      loadLeadDetail(id);
    }
    if (button.classList.contains('qualify')) {
      detailId.value = id;
      qualifyLead(id);
    }
    if (button.classList.contains('notify')) {
      detailId.value = id;
      notifyLead(id);
    }
  });
};

window.addEventListener('DOMContentLoaded', () => {
  refreshStatus();
  loadLeads();
  setupEvents();
});
