/**
 * Shell do portal: navegação, dashboard, faturas, chamados, perfil.
 * MP, velocidade e Lemon Club estão em modules/.
 */
import { API, VIEW_TITLES, MP_LOGO_IMG, FEATURE_WATCH_TV } from './modules/constants.js';
import { S, app } from './modules/state.js';
import { request } from './modules/http.js';
import {
  fmt,
  fmtData,
  fmtMoeda,
  showLoading,
  hideLoading,
  showAlert,
  emptyState,
  closeModal,
  closeModalDirect,
  showToast,
  hexToRgba,
  copiar,
} from './modules/format-ui.js';
import {
  gerarPixMP,
  fecharFormPagamentoCartaoFatura,
  fecharFormAssinaturaMP,
  abrirFormPagamentoCartaoFatura,
  abrirFormAssinaturaMP,
  confirmarPagamentoCartaoFatura,
  confirmarAssinaturaComToken,
  preencherCarteiraMpAviso,
  _mpCriarCardToken,
} from './modules/mercadopago.js';
import {
  loadConexao,
  loadVelocidade,
  iniciarSpeedTest,
  limparHistoricoSpeed,
  navToVelocidade,
} from './modules/connection-speed.js';
import {
  missaoVisita,
  loadIndicacoes,
  completarMissao,
  _prePopularCacheMissoes,
  irFazerMissao,
  resgatarBeneficio,
  copiarLinkRef,
  compartilharWhats,
  compartilharNativo,
  instalarApp,
  ativarNotificacoes,
  mostrarBoasVindas,
  fecharBoasVindas,
  initClubPwa,
} from './modules/club.js';

/** Pagamento único fatura no cartão (MP Payments). */
const MP_API_FATURA_CARTAO = `${API}/pagamento/fatura/cartao`;
// espelho em S.S.clienteData via _syncClienteToS()

// ===== UTILS =====

async function request(method, url, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  let data = {};
  if (ct.includes('application/json')) {
    try { data = await res.json(); } catch { data = {}; }
  } else {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        text.includes('Cannot POST')
          ? 'API não encontrada — reinicie o Node (npm start) na pasta do Lemon Portal e atualize a página (Ctrl+F5).'
          : (text.slice(0, 200) || 'Erro na requisição')
      );
    }
    const t = text.trimStart();
    if (t.startsWith('<!DOCTYPE') || t.startsWith('<html')) {
      throw new Error(
        `${method} ${url}: o browser recebeu uma página HTML em vez de JSON. ` +
          'Quem respondeu não foi o Lemon Portal (Node) neste endereço — abre o portal na URL onde o Node serve tudo (ex.: http://localhost:PORT) ou configura o teu servidor para este pedido chegar ao Node.'
      );
    }
    throw new Error('Resposta inválida do servidor');
  }
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

// ===== NAVEGAÇÃO =====

function navTo(view) {
  if (!FEATURE_WATCH_TV && view === 'watch') view = 'dashboard';
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.classList.add('hidden');
  });

  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) {
    viewEl.classList.remove('hidden');
    viewEl.classList.add('active');
  }

  // Bottom nav ativo
  document.querySelectorAll('.bnav-item').forEach(n => n.classList.remove('active'));
  const bnavEl = document.querySelector(`.bnav-item[data-view="${view}"]`);
  if (bnavEl) bnavEl.classList.add('active');

  // Topbar: mostrar brand no dashboard, título + back nas outras telas
  const backBtn  = document.getElementById('btn-back');
  const brand    = document.getElementById('topbar-brand');
  const titleEl  = document.getElementById('topbar-title');
  if (view === 'dashboard') {
    backBtn?.classList.add('hidden');
    brand?.classList.remove('hidden');
    titleEl?.classList.add('hidden');
  } else {
    backBtn?.classList.remove('hidden');
    brand?.classList.add('hidden');
    titleEl?.classList.remove('hidden');
    if (titleEl) titleEl.textContent = VIEW_TITLES[view] || view;
  }

  // Para o refresh de conexão ao sair da aba
  if (view !== 'conexao' && S.connInterval) {
    clearInterval(S.connInterval);
    S.connInterval = null;
  }

  if (view === 'dashboard')  loadDashboard();
  if (view === 'faturas')    { loadFaturas();    missaoVisita('ver_fatura'); }
  if (view === 'suporte')    { loadChamados();   missaoVisita('ver_suporte_sec'); }
  if (view === 'conexao')    { loadConexao();    missaoVisita('ver_conexao'); }
  if (view === 'velocidade') { loadVelocidade(); missaoVisita('ver_velocidade_sec'); }
  if (view === 'indicacoes') { loadIndicacoes({ resetSegment: true }); missaoVisita('ver_clube'); }
  if (view === 'perfil')     { loadPerfil();     missaoVisita('ver_perfil_sec'); }
  if (view === 'notificacoes') loadNotificacoes();
  if (view === 'watch')      loadWatchBrasil();

  // "explorador" é validado pelo servidor via /portal/visita automaticamente
}

// ===== SIDEBAR MOBILE (legado — mantido para não quebrar) =====

function toggleSidebar() {
  // sidebar removida — não faz nada
}

function _legacySidebarSetup() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  let overlay = document.getElementById('sb-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sb-overlay';
    overlay.className = 'sidebar-overlay';
    overlay.onclick = closeSidebarMobile;
    document.body.appendChild(overlay);
  }
  overlay.classList.toggle('active', sb.classList.contains('open'));
}

function closeSidebarMobile() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.remove('active');
}

// ===== LOGIN =====

function togglePass() {
  const input = document.getElementById('senha-input');
  const icon = document.getElementById('eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

// Máscara de CPF
const cpfInput = document.getElementById('cpf-input');
if (cpfInput) {
  cpfInput.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
    else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
    else if (v.length > 3) v = v.replace(/(\d{3})(\d{0,3})/, '$1.$2');
    e.target.value = v;
  });
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cpf = document.getElementById('cpf-input').value.trim();
  const btn = document.getElementById('btn-login');

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;margin:0"></div>';

  try {
    const res = await request('POST', `${API}/login`, { cpf });
    const primeiroNome = (res.nome || cpf).split(' ')[0];
    document.getElementById('topbar-nome').textContent = primeiroNome;
    // Avatar no topbar
    const _initials = (res.nome || '?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
    const _avatarEl = document.getElementById('topbar-avatar');
    if (_avatarEl) _avatarEl.textContent = _initials;
    document.getElementById('page-login').classList.remove('active');
    document.getElementById('page-login').classList.add('hidden');
    document.getElementById('page-portal').classList.remove('hidden');
    navTo('dashboard');
    // Pré-população do cache de missões (silenciosa, em background)
    _prePopularCacheMissoes();
    // Missão de primeiro acesso (silencioso)
    setTimeout(() => completarMissao('primeiro_login', null, true), 1500);
    // Missões automáticas pós-login — validadas pelo servidor (loginHistory real)
    // Aguarda 2.5s para o cache ser populado antes de tentar
    setTimeout(() => {
      completarMissao('acesso_noturno', null, true);
      completarMissao('login_3x',       null, true);
      completarMissao('uso_semanal',    null, true);
      // Se o portal está aberto em modo standalone, o app já foi instalado
      try {
        if (window.matchMedia('(display-mode: standalone)').matches) {
          completarMissao('instalar_app', null, true);
        }
      } catch (_) {}
    }, 2500);
    // Modal de boas-vindas no primeiro acesso
    if (res.primeiroAcesso) {
      const titulo = document.getElementById('bv-nome-title');
      if (titulo) titulo.textContent = `Bem-vindo, ${primeiroNome}! 🎉`;
      setTimeout(() => mostrarBoasVindas(), 800);
    }

    // Prompt de notificações push após login (se ainda não ativou)
    setTimeout(() => _verificarEPedirPush(), 4000);
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
    document.getElementById('login-error').classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = '<span>Entrar</span><i class="fa-solid fa-arrow-right"></i>';
  }
});

// ===== PROMPT PUSH NOTIFICATIONS =====

async function _verificarEPedirPush() {
  try {
    // Não pede se: já concedido, já negado, não suportado, ou já viu o modal hoje
    if (!('Notification' in window) || !('PushManager' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') return;
    const visto = localStorage.getItem('lemon_push_prompt_ts');
    if (visto && Date.now() - Number(visto) < 24 * 60 * 60 * 1000) return; // 1x por dia

    // Só mostra se não tiver outro modal aberto
    const outroModal = document.querySelector('.modal-overlay:not(.hidden):not(#modal-push-notif)');
    if (outroModal) return;

    const modal = document.getElementById('modal-push-notif');
    if (!modal) return;
    modal.classList.remove('hidden');
    localStorage.setItem('lemon_push_prompt_ts', String(Date.now()));

    document.getElementById('btn-push-ativar').onclick = async () => {
      modal.classList.add('hidden');
      try { await ativarNotificacoes(); } catch (_) {}
    };
    document.getElementById('btn-push-depois').onclick = () => {
      modal.classList.add('hidden');
    };
  } catch (_) {}
}

// ===== LOGOUT =====

async function logout() {
  // Cancela intervalos pendentes antes de limpar o estado
  if (typeof _connInterval !== 'undefined' && _connInterval) {
    clearInterval(_connInterval);
    _connInterval = null;
  }

  try { await request('POST', `${API}/logout`); } catch (_) {}

  // Reseta estado em memória
  S.clienteData = null;
  faturasCarregadas = { abertas: false, vencidas: false, pagas: false };

  // Limpa cache de missões do sessionStorage
  sessionStorage.removeItem('lemon_miss');

  document.getElementById('page-portal').classList.add('hidden');
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-login').classList.add('hidden');
  document.getElementById('page-landing').classList.remove('hidden');
  document.getElementById('page-landing').classList.add('active');
  document.getElementById('cpf-input').value = '';
}
