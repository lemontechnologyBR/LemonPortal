/**
 * Portal do cliente — núcleo (navegação, login/logout, sidebar).
 * Dashboard, faturas, chamados, perfil, Watch TV, MP, velocidade e Lemon Club: modules/.
 */
import { API, MP_LOGO_IMG, VIEW_TITLES, FEATURE_WATCH_TV } from './modules/constants.js';
import { S, app } from './modules/state.js';
import { request } from './modules/http.js';
import { initOnboardingFormListeners, onboardingWindowAPI } from './modules/onboarding.js';
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
import * as mp from './modules/mercadopago.js';
import * as conn from './modules/connection-speed.js';
import * as club from './modules/club.js';
import * as notif from './modules/notificacoes.js';
import * as dash from './modules/dashboard.js';
import * as watch from './modules/watch.js';
import * as fat from './modules/faturas.js';
import * as cham from './modules/chamados.js';
import * as perf from './modules/perfil.js';

/** Landing / captação usam onclick no HTML — disponível antes do resto do boot. */
Object.assign(window, onboardingWindowAPI);

const loadNotificacoes = notif.loadNotificacoes;

/** MP, conexão, Lemon Club, Dashboard, Faturas, etc. — globais para onclick / HTML */
Object.assign(window, {
  gerarPixMP: mp.gerarPixMP,
  pagarPixFaturaComValorAtualizado: mp.pagarPixFaturaComValorAtualizado,
  abrirCartaoFaturaComValorAtualizado: mp.abrirCartaoFaturaComValorAtualizado,
  fecharFormPagamentoCartaoFatura: mp.fecharFormPagamentoCartaoFatura,
  abrirFormPagamentoCartaoFatura: mp.abrirFormPagamentoCartaoFatura,
  confirmarPagamentoCartaoFatura: mp.confirmarPagamentoCartaoFatura,
  fecharFormAssinaturaMP: mp.fecharFormAssinaturaMP,
  abrirFormAssinaturaMP: mp.abrirFormAssinaturaMP,
  confirmarAssinaturaComToken: mp.confirmarAssinaturaComToken,
  preencherCarteiraMpAviso: mp.preencherCarteiraMpAviso,
  _mpCriarCardToken: mp._mpCriarCardToken,
  loadConexao: conn.loadConexao,
  loadVelocidade: conn.loadVelocidade,
  iniciarSpeedTest: conn.iniciarSpeedTest,
  limparHistoricoSpeed: conn.limparHistoricoSpeed,
  navToVelocidade: conn.navToVelocidade,
  missaoVisita: club.missaoVisita,
  setClubSegment: club.setClubSegment,
  loadIndicacoes: club.loadIndicacoes,
  completarMissao: club.completarMissao,
  _prePopularCacheMissoes: club._prePopularCacheMissoes,
  irFazerMissao: club.irFazerMissao,
  resgatarBeneficio: club.resgatarBeneficio,
  copiarLinkRef: club.copiarLinkRef,
  compartilharWhats: club.compartilharWhats,
  compartilharNativo: club.compartilharNativo,
  instalarApp: club.instalarApp,
  fecharModalInstalarApp: club.fecharModalInstalarApp,
  ativarNotificacoes: club.ativarNotificacoes,
  mostrarBoasVindas: club.mostrarBoasVindas,
  fecharBoasVindas: club.fecharBoasVindas,
  loadNotificacoes: notif.loadNotificacoes,
  setPushNotifPref: notif.setPushNotifPref,
  ativarPushNesteDispositivo: notif.ativarPushNesteDispositivo,
  desativarPushNesteDispositivo: notif.desativarPushNesteDispositivo,
  loadDashboard: dash.loadDashboard,
  watchAtivarFree: watch.watchAtivarFree,
  loadWatchBrasil: watch.loadWatchBrasil,
  loadFaturas: fat.loadFaturas,
  switchTab: fat.switchTab,
  abrirFatura: fat.abrirFatura,
  loadChamados: cham.loadChamados,
  abrirChamado: cham.abrirChamado,
  loadPerfil: perf.loadPerfil,
  toggleCarteiraAddForm: perf.toggleCarteiraAddForm,
  confirmarCarteiraAdd: perf.confirmarCarteiraAdd,
  removerCartaoCarteira: perf.removerCartaoCarteira,
});

club.initClubPwa();


/**
 * Fonte do bundle do portal do cliente.
 * Após alterar este ficheiro, regenere o script servido ao navegador:
 *   npm run build:portal
 * O browser carrega /js/portal-app.js (ES modules em public/js/modules/), não este ficheiro.
 */

// ===== NAVEGAÇÃO =====

async function navTo(view) {
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

  if (view === 'dashboard') await loadDashboard();
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

  if (typeof window.__lemonSplashShow === 'function') window.__lemonSplashShow();

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
    await navTo('dashboard');
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
    }, 2500);
    // Modal de boas-vindas no primeiro acesso
    if (res.primeiroAcesso) {
      const titulo = document.getElementById('bv-nome-title');
      if (titulo) titulo.textContent = `Bem-vindo, ${primeiroNome}! 🎉`;
      setTimeout(() => mostrarBoasVindas(), 800);
    }
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
    document.getElementById('login-error').classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = '<span>Entrar</span><i class="fa-solid fa-arrow-right"></i>';
  } finally {
    if (typeof window.__lemonSplashHide === 'function') window.__lemonSplashHide();
  }
});

// ===== LOGOUT =====

async function logout() {
  // Cancela intervalos pendentes antes de limpar o estado
  if (typeof S.connInterval !== 'undefined' && S.connInterval) {
    clearInterval(S.connInterval);
    S.connInterval = null;
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


initOnboardingFormListeners();
cham.initChamados();
perf.initPerfil();

app.navTo = navTo;
app.refreshFaturas = fat.forceReloadFaturas;
app.abrirFatura = fat.abrirFatura;

/** Handlers globais para onclick="" no index.html */
const portalGlobalHandlers = {
  ...onboardingWindowAPI,
  navTo,
  setClubSegment: club.setClubSegment,
  loadNotificacoes: notif.loadNotificacoes,
  setPushNotifPref: notif.setPushNotifPref,
  ativarPushNesteDispositivo: notif.ativarPushNesteDispositivo,
  desativarPushNesteDispositivo: notif.desativarPushNesteDispositivo,
  fecharModalInstalarApp: club.fecharModalInstalarApp,
  toggleSidebar,
  closeSidebarMobile,
  togglePass,
  logout,
  switchTab: fat.switchTab,
  abrirFatura: fat.abrirFatura,
  loadChamados: cham.loadChamados,
  abrirChamado: cham.abrirChamado,
  toggleCarteiraAddForm: perf.toggleCarteiraAddForm,
  confirmarCarteiraAdd: perf.confirmarCarteiraAdd,
  removerCartaoCarteira: perf.removerCartaoCarteira,
  closeModal,
  closeModalDirect,
  copiar,
  watchAtivarFree: watch.watchAtivarFree,
};
Object.assign(window, portalGlobalHandlers);

(async () => {
  try {
    const sess = await request('GET', `${API}/session`);
    if (sess.logado) {
      if (typeof window.__lemonSplashShow === 'function') window.__lemonSplashShow();
      document.getElementById('topbar-nome').textContent = sess.nome || '';
      document.getElementById('page-landing').classList.remove('active');
      document.getElementById('page-landing').classList.add('hidden');
      document.getElementById('page-portal').classList.remove('hidden');
      await navTo('dashboard');
      const open = new URLSearchParams(window.location.search).get('open');
      if (open === 'faturas') navTo('faturas');
      else if (open === 'notificacoes') navTo('notificacoes');
      if (typeof window.__lemonSplashHide === 'function') window.__lemonSplashHide();
    } else {
      if (typeof window.__lemonSplashScheduleGuestHide === 'function') window.__lemonSplashScheduleGuestHide();
    }
  } catch (_) {
    if (typeof window.__lemonSplashScheduleGuestHide === 'function') window.__lemonSplashScheduleGuestHide();
  }
})();
