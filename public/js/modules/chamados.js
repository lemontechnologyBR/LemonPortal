/**
 * Seção Chamados: listagem, detalhe e abertura de novos chamados.
 */
import { API } from './constants.js';
import { S } from './state.js';
import { request } from './http.js';
import { fmt, fmtData, emptyState, showAlert } from './format-ui.js';

// ─── helpers internos ────────────────────────────────────────────────────────

function chamadoStatusInfo(status) {
  const map = {
    'aberto': { cls: 'badge-orange', label: 'Aberto', icon: 'orange' },
    'fechado': { cls: 'badge-blue', label: 'Fechado', icon: 'blue' },
    'em_atendimento': { cls: 'badge-yellow', label: 'Em atendimento', icon: 'yellow' },
    'aguardando': { cls: 'badge-yellow', label: 'Aguardando', icon: 'yellow' },
  };
  return map[status] || { cls: 'badge-blue', label: status || 'Aberto', icon: 'blue' };
}

function chamadoItemHtml(c) {
  const info = chamadoStatusInfo(c.status);
  return `
    <div class="chamado-item" onclick="abrirChamado('${c.chamado || c.id}')">
      <div class="chamado-icon card-icon ${info.icon}">
        <i class="fa-solid fa-headset"></i>
      </div>
      <div class="chamado-info">
        <div class="chamado-assunto">${fmt(c.assunto)} <span class="badge ${info.cls}" style="margin-left:6px">${info.label}</span></div>
        <div class="chamado-data"><i class="fa-solid fa-clock" style="margin-right:4px;opacity:.6"></i>${fmtData(c.data || c.created_at)}</div>
      </div>
    </div>
  `;
}

// ─── funções exportadas ───────────────────────────────────────────────────────

export async function loadChamados() {
  const container = document.getElementById('lista-chamados');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await request('GET', `${API}/chamados`);
    const lista = res.chamados || [];
    if (!lista.length) {
      container.innerHTML = emptyState('fa-headset', 'Nenhum chamado aberto');
    } else {
      container.innerHTML = lista.map(c => chamadoItemHtml(c)).join('');
    }
  } catch {
    container.innerHTML = emptyState('fa-triangle-exclamation', 'Erro ao carregar chamados');
  }
}

export async function abrirChamado(id) {
  const modal = document.getElementById('modal-chamado');
  const content = document.getElementById('modal-chamado-content');
  content.innerHTML = '<div class="spinner"></div>';
  modal.classList.remove('hidden');

  try {
    const c = await request('GET', `${API}/chamados/${id}`);
    const info = chamadoStatusInfo(c.status);
    content.innerHTML = `
      <div class="modal-detail-row"><span class="modal-detail-label">Nº Chamado</span><span class="modal-detail-val">${fmt(c.chamado || id)}</span></div>
      <div class="modal-detail-row"><span class="modal-detail-label">Assunto</span><span class="modal-detail-val">${fmt(c.assunto)}</span></div>
      <div class="modal-detail-row"><span class="modal-detail-label">Status</span><span class="modal-detail-val"><span class="badge ${info.cls}">${info.label}</span></span></div>
      <div class="modal-detail-row"><span class="modal-detail-label">Prioridade</span><span class="modal-detail-val">${fmt(c.prioridade)}</span></div>
      <div class="modal-detail-row"><span class="modal-detail-label">Data</span><span class="modal-detail-val">${fmtData(c.data || c.created_at)}</span></div>
      ${c.mensagem ? `<div style="margin-top:16px;padding:14px;background:var(--dark-3);border-radius:8px;font-size:0.88rem;line-height:1.6;color:var(--text-muted)">${fmt(c.mensagem)}</div>` : ''}
      ${c.motivo ? `<div style="margin-top:10px;padding:14px;background:var(--dark-3);border-radius:8px;font-size:0.88rem;line-height:1.6"><strong style="display:block;margin-bottom:4px;font-size:0.78rem;text-transform:uppercase;color:var(--lemon)">Resolução</strong>${fmt(c.motivo)}</div>` : ''}
    `;
  } catch {
    content.innerHTML = emptyState('fa-triangle-exclamation', 'Erro ao carregar chamado');
  }
}

/** Registra o listener do formulário de abertura de chamado. */
export function initChamados() {
  const form = document.getElementById('form-chamado');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const assunto = document.getElementById('chamado-assunto').value;
    const prioridade = document.getElementById('chamado-prioridade').value;
    const mensagem = document.getElementById('chamado-mensagem').value.trim();

    if (!mensagem) {
      showAlert('chamado-feedback', 'Por favor, descreva seu problema ou dúvida.', 'error');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;margin:0"></div> Enviando...';

    try {
      await request('POST', `${API}/chamados`, { assunto, prioridade, mensagem });
      showAlert('chamado-feedback', 'Chamado aberto com sucesso! Em breve entraremos em contato.', 'success');
      window.completarMissao && window.completarMissao('abrir_chamado', null);
      document.getElementById('chamado-mensagem').value = '';
      S.faturasCarregadas.abertas = false;
      loadChamados();
    } catch (err) {
      showAlert('chamado-feedback', err.message || 'Erro ao abrir chamado.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Chamado';
    }
  });
}
