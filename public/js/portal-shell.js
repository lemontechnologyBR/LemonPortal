/**
 * Shell do portal: navegação, dashboard, faturas, chamados, perfil.
 * MP, velocidade e Lemon Club estão em modules/.
 */
import { API, VIEW_TITLES, MP_LOGO_IMG } from './modules/constants.js';
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
  fecharFormAssinaturaMP,
  abrirFormAssinaturaMP,
  confirmarAssinaturaComToken,
  assinaturaMercadoPagoHosted,
  preencherCarteiraMpAviso,
  _mpCriarCardToken,
} from './modules/mercadopago.js';
import {
  loadConexao,
  loadVelocidade,
  iniciarSpeedTest,
  limparHistoricoSpeed,
  navToVelocidade,
  wireSpeedtestMissions,
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
  if (view === 'indicacoes') { loadIndicacoes(); missaoVisita('ver_clube'); }
  if (view === 'perfil')     { loadPerfil();     missaoVisita('ver_perfil_sec'); }
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
  }
});

// ===== LOGOUT =====

async function logout() {
  try { await request('POST', `${API}/logout`); } catch (_) {}
  document.getElementById('page-portal').classList.add('hidden');
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-login').classList.add('hidden');
  document.getElementById('page-landing').classList.remove('hidden');
  document.getElementById('page-landing').classList.add('active');
  document.getElementById('cpf-input').value = '';
}

// ===== DASHBOARD =====

function _dashXmlEsc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function _dashXmlEscAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** RSS público (G1) via proxy CORS — só no browser; zero Node, zero chave, zero nginx. */
async function loadDashHeadlinesFromRss() {
  const el = document.getElementById('dash-noticias');
  if (!el) return;
  el.innerHTML = '<div class="spinner" style="margin:16px auto"></div>';
  const rssUrl = 'https://g1.globo.com/rss/g1/';
  const proxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(rssUrl);
  try {
    const res = await fetch(proxy, { credentials: 'omit' });
    if (!res.ok) throw new Error('rede');
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('xml');
    const ch = doc.querySelector('channel');
    const items = ch ? [...ch.querySelectorAll('item')].slice(0, 8) : [...doc.querySelectorAll('item')].slice(0, 8);
    if (!items.length) throw new Error('vazio');
    el.innerHTML = items
      .map((item) => {
        const title = item.querySelector('title')?.textContent?.trim() || 'Sem título';
        const le = item.querySelector('link');
        let link = (le?.textContent || le?.getAttribute?.('href') || '').trim();
        if (!/^https?:\/\//i.test(link)) link = '#';
        return `<a class="dash-news-item" href="${_dashXmlEscAttr(link)}" target="_blank" rel="noopener noreferrer"><div class="dash-news-body"><span class="dash-news-src">G1</span><span class="dash-news-title">${_dashXmlEsc(title)}</span></div></a>`;
      })
      .join('');
  } catch (_) {
    el.innerHTML = '<div class="dash-news-empty">Notícias indisponíveis neste momento.</div>';
  }
}

async function loadWatchBrasil() {
  const alertEl = document.getElementById('watch-brasil-alert');
  const bodyEl = document.getElementById('watch-brasil-body');
  if (alertEl) {
    alertEl.classList.add('hidden');
    alertEl.textContent = '';
  }
  if (!bodyEl) return;
  bodyEl.innerHTML = '<p style="color:var(--text-muted)">Carregando…</p>';
  try {
    const st = await request('GET', `${API}/watch/status`);
    if (!st.ok) {
      const blocos = [];
      if (st.reason === 'disabled') {
        blocos.push('<p><strong>Integração desligada</strong> no servidor (<code>WATCH_ENABLED=0</code> ou sem credenciais).</p>');
      } else {
        if (!st.hasToken) {
          blocos.push(
            `<p><strong>1. Falta o token da API Watch</strong> no servidor (nada disto é configurado pelo cliente no telemóvel).</p>
            <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.5">A <a href="https://apiweb.watch.tv.br/" target="_blank" rel="noopener noreferrer">documentação oficial</a> descreve o OAuth: recebes <code>WATCH_CLIENT_ID</code> e <code>WATCH_CLIENT_SECRET</code> da Watch (integração). O <strong>access token</strong> não é um texto que se “copia da home” da doc — vem da resposta após autorização (<code>code</code> → troca em <code>/oauth/token</code>), ou podes colá-lo no servidor se o obtiveres já pronto (Postman, webhook, etc.).</p>
            <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.5;margin-top:8px"><strong>No portal:</strong> login em <strong>/admin</strong> → abrir <code style="font-size:0.8rem">${location.origin}/admin/watch/oauth-form</code> (o <code>WATCH_REDIRECT_URI</code> no <code>.env</code> tem de coincidir com o URL registado na Watch). Se o redirect for um webhook (ex.: n8n), define <code>WATCH_CODE_EXCHANGE_SECRET</code> no <code>.env</code>, reinicia o Node, e o n8n chama <code>POST ${location.origin}/portal/watch/oauth/exchange-code</code> com header <code>X-Watch-Code-Secret</code> e body <code>{"code":"…"}</code>. Alternativas: <code>POST /admin/watch/token</code> com <code>{"accessToken":"…"}</code> ou <code>WATCH_ACCESS_TOKEN</code> no <code>.env</code> + reiniciar o Node.</p>`
          );
        }
        if (!st.pacoteResolvido) {
          blocos.push(
            `<p><strong>2. Não foi possível escolher o pacote Watch</strong> para a tua conta.</p>
            <p style="font-size:0.88rem;color:var(--text-muted);line-height:1.5">Plano MK na sessão: <strong>${fmt(st.planoMk) || '— (faz logout e login outra vez)'}</strong>. No servidor: define <code>WATCH_PACOTE_ID</code> no <code>.env</code> (um ID para todos) ou ajusta o mapa em <code>lib/watch-pacotes.js</code> / <code>WATCH_PACOTE_MAP_JSON</code>.</p>`
          );
        }
      }
      bodyEl.innerHTML = `${blocos.join('')}
        <p style="font-size:0.85rem;color:var(--text-muted);margin-top:14px">Se já configuraste tudo, faz <strong>logout</strong> e <strong>login</strong> de novo e atualiza a página.</p>`;
      return;
    }
    const r = await request('GET', `${API}/watch/ticket`);
    const payload = r.data !== undefined ? r.data : r;
    const pre = document.createElement('pre');
    pre.style.cssText =
      'white-space:pre-wrap;word-break:break-word;font-size:0.82rem;background:var(--dark-3);padding:14px;border-radius:12px;overflow:auto;max-height:55vh;border:1px solid var(--glass-border)';
    pre.textContent = JSON.stringify(payload, null, 2);
    bodyEl.innerHTML = '';
    bodyEl.appendChild(pre);
  } catch (e) {
    const msg = e.message || 'Erro ao consultar Watch.';
    if (alertEl) {
      alertEl.textContent = msg;
      alertEl.classList.remove('hidden');
    }
    bodyEl.innerHTML =
      '<p style="color:var(--text-muted)">Não foi possível obter os dados da Watch Brasil neste momento.</p>';
  }
}

async function loadDashboard() {
  try {
    const [me, abertas, clube] = await Promise.allSettled([
      request('GET', `${API}/me`),
      request('GET', `${API}/faturas/abertas`),
      request('GET', `${API}/clube/stats`),
    ]);

    if (me.status === 'fulfilled') {
      S.clienteData = me.value;
      const primeiroNome = (S.clienteData.nome_res || S.clienteData.nome || '').split(' ')[0];

      // Hero
      document.getElementById('dash-nome').textContent = primeiroNome;
      document.getElementById('topbar-nome').textContent = primeiroNome;

      // Avatar no topbar
      const initials = (S.clienteData.nome || '?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
      const avatarEl = document.getElementById('topbar-avatar');
      if (avatarEl) avatarEl.textContent = initials;

      // Status pill
      const isOnline = !S.clienteData.bloq || S.clienteData.bloq === '0' || S.clienteData.bloq === 'desbloqueado';
      const statusTxt = document.getElementById('dash-status');
      const statusDot = document.getElementById('dash-status-dot');
      if (statusTxt) statusTxt.textContent = isOnline ? 'Online' : 'Bloqueado';
      if (statusDot) { statusDot.classList.toggle('online', isOnline); statusDot.classList.toggle('offline', !isOnline); }

      // Stat cards
      document.getElementById('dash-plano').textContent = S.clienteData.plano || '--';
      document.getElementById('dash-venc').textContent  = S.clienteData.venc ? `Dia ${S.clienteData.venc}` : '--';
    }

    if (abertas.status === 'fulfilled') {
      const titulos = abertas.value.titulos || [];
      const count = titulos.length;
      document.getElementById('dash-faturas').textContent = count;
      // Badge no tile
      const badge = document.getElementById('tile-badge-faturas');
      const bnavBadge = document.getElementById('bnav-badge-faturas');
      if (badge) { badge.textContent = count; badge.classList.toggle('hidden', count === 0); }
      if (bnavBadge) { bnavBadge.textContent = count; bnavBadge.classList.toggle('hidden', count === 0); }
    } else {
      const dashFat = document.getElementById('dash-faturas');
      if (dashFat) dashFat.textContent = '—';
      const badge = document.getElementById('tile-badge-faturas');
      const bnavBadge = document.getElementById('bnav-badge-faturas');
      if (badge) badge.classList.add('hidden');
      if (bnavBadge) bnavBadge.classList.add('hidden');
    }

    if (clube.status === 'fulfilled') {
      const pts = clube.value.pontos || 0;
      const ptsStat = document.getElementById('dash-pontos-stat');
      if (ptsStat) ptsStat.textContent = pts + ' pts';
      const tilePts = document.getElementById('tile-pts');
      const bnavPts = document.getElementById('nav-pontos');
      if (tilePts) { tilePts.textContent = pts + ' pts'; tilePts.classList.toggle('hidden', pts === 0); }
      if (bnavPts) { bnavPts.textContent = pts + ' pts'; bnavPts.classList.toggle('hidden', pts === 0); }
    }
  } catch (err) {
    console.error('Erro no dashboard:', err);
  } finally {
    await loadDashHeadlinesFromRss();
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _dashLocalMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function _dashDaysUntilVenc(datavencStr) {
  if (!datavencStr) return null;
  const due = new Date(datavencStr);
  if (isNaN(due.getTime())) return null;
  const dueDay = _dashLocalMidnight(due);
  const today = _dashLocalMidnight(new Date());
  return Math.round((dueDay - today) / 86400000);
}

// ===== FATURAS =====

// faturas: usar S.faturasCarregadas

async function _ensureClienteProfile() {
  if (S.clienteData) return;
  try {
    S.clienteData = await request('GET', `${API}/me`);
  } catch (_) {}
}

async function loadFaturas() {
  if (!S.faturasCarregadas.abertas) {
    loadFaturasAbertas();
  }
}

async function loadFaturasAbertas() {
  S.faturasCarregadas.abertas = true;
  const container = document.getElementById('lista-abertas');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    await _ensureClienteProfile();
    const res = await request('GET', `${API}/faturas/abertas`);
    const titulos = res.titulos || [];
    if (!titulos.length) {
      container.innerHTML = emptyState('fa-circle-check', 'Nenhuma fatura em aberto. Tudo em dia!');
    } else {
      container.innerHTML = titulos.map(t => faturaItemHtml(t)).join('');
    }
  } catch {
    container.innerHTML = emptyState('fa-triangle-exclamation', 'Erro ao carregar faturas');
  }
}

async function loadFaturasVencidas() {
  if (S.faturasCarregadas.vencidas) return;
  S.faturasCarregadas.vencidas = true;
  const container = document.getElementById('lista-vencidas');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    await _ensureClienteProfile();
    const res = await request('GET', `${API}/faturas/vencidas`);
    const titulos = res.titulos || [];
    if (!titulos.length) {
      container.innerHTML = emptyState('fa-circle-check', 'Nenhuma fatura vencida!');
    } else {
      container.innerHTML = titulos.map(t => faturaItemHtml(t, 'vencida')).join('');
    }
  } catch {
    container.innerHTML = emptyState('fa-triangle-exclamation', 'Erro ao carregar faturas vencidas');
  }
}

async function loadFaturasPagas() {
  if (S.faturasCarregadas.pagas) return;
  S.faturasCarregadas.pagas = true;
  const container = document.getElementById('lista-pagas');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    await _ensureClienteProfile();
    const res = await request('GET', `${API}/faturas/pagas`);
    const titulos = res.titulos || [];
    if (!titulos.length) {
      container.innerHTML = emptyState('fa-receipt', 'Nenhuma fatura paga encontrada');
    } else {
      container.innerHTML = titulos.map(t => faturaItemHtml(t, 'paga')).join('');
    }
  } catch {
    container.innerHTML = emptyState('fa-triangle-exclamation', 'Erro ao carregar histórico');
  }
}

function switchTab(btn, tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => {
    t.classList.remove('active');
    t.classList.add('hidden');
  });
  btn.classList.add('active');
  const content = document.getElementById(`tab-${tab}`);
  content.classList.remove('hidden');
  content.classList.add('active');

  if (tab === 'vencidas') loadFaturasVencidas();
  if (tab === 'pagas') loadFaturasPagas();
}

function _faturaNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function faturaValorMercadoPago(t, isPago) {
  const v0 = parseFloat(t?.valor);
  const base = Number.isFinite(v0) ? v0 : 0;
  if (isPago || !t?.lemon_clube_desconto_resgatado) return base;
  const v = Number(t.lemon_clube_valor_a_pagar);
  const desc = Number(t.lemon_clube_valor_desconto);
  if (Number.isFinite(v) && Number.isFinite(desc) && desc > 0.004) return v;
  return base;
}

function faturaTipoTitulo(t) {
  const raw = String(t.tipo || 'mensalidade').trim() || 'mensalidade';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function faturaListaMetaPrazo(t, tipo) {
  if (tipo === 'paga') {
    if (t.datapag) {
      return `<span class="fatura-meta-prazo fatura-meta-prazo--ok"><i class="fa-solid fa-circle-check"></i> Pago em ${fmtData(t.datapag)}</span>`;
    }
    return '';
  }
  const days = _dashDaysUntilVenc(t.datavenc);
  const atrasada = tipo === 'vencida' || (days !== null && days < 0);
  if (atrasada) {
    if (days === null) {
      return `<span class="fatura-meta-prazo fatura-meta-prazo--late"><i class="fa-solid fa-triangle-exclamation"></i> Em atraso</span>`;
    }
    const n = Math.abs(days);
    const frag = n === 0 ? 'Vence hoje — em atraso' : `${n} dia${n !== 1 ? 's' : ''} em atraso`;
    return `<span class="fatura-meta-prazo fatura-meta-prazo--late"><i class="fa-solid fa-triangle-exclamation"></i> ${frag}</span>`;
  }
  if (days === null) return '';
  if (days === 0) {
    return `<span class="fatura-meta-prazo fatura-meta-prazo--soon"><i class="fa-solid fa-clock"></i> Vence hoje</span>`;
  }
  if (days === 1) {
    return `<span class="fatura-meta-prazo fatura-meta-prazo--soon"><i class="fa-solid fa-clock"></i> Falta 1 dia</span>`;
  }
  const muted = days > 7 ? ' fatura-meta-prazo--muted' : '';
  const soon = days <= 7 ? ' fatura-meta-prazo--soon' : '';
  return `<span class="fatura-meta-prazo${soon}${muted}"><i class="fa-solid fa-clock"></i> Faltam ${days} dias</span>`;
}

function faturaListaCompetenciaHtml(datavencStr) {
  if (!datavencStr) return '';
  const d = new Date(datavencStr);
  if (isNaN(d.getTime())) return '';
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const raw = prev.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const cap = raw.charAt(0).toUpperCase() + raw.slice(1);
  return `<div class="fatura-desc fatura-desc--cycle" title="Referência típica do período cobrado (mês anterior à data de vencimento)."><i class="fa-solid fa-layer-group"></i> Serviço ref. <strong>${escHtml(cap)}</strong></div>`;
}

function faturaListaClienteCtxHtml() {
  const c = S.clienteData;
  if (!c) return '';
  const plano = (c.plano || c.plano_nome || '').trim();
  const dia = c.venc != null && String(c.venc).trim() !== '' ? String(c.venc).trim() : '';
  if (!plano && !dia) return '';
  const bits = [];
  if (plano) bits.push(`<span><i class="fa-solid fa-gauge-high" aria-hidden="true"></i>${escHtml(plano)}</span>`);
  if (dia) bits.push(`<span><i class="fa-solid fa-rotate" aria-hidden="true"></i>Venc. mensal: dia ${escHtml(dia)}</span>`);
  return `<div class="fatura-cliente-meta">${bits.join('<span class="fatura-meta-dot" aria-hidden="true">·</span>')}</div>`;
}

function faturaListaIdTituloHtml(t) {
  const id = t.numero ?? t.id ?? t.codigo ?? t.nosso_numero;
  if (id == null || String(id).trim() === '') return '';
  return `<div class="fatura-desc fatura-desc--id"><i class="fa-solid fa-fingerprint"></i> Título <strong>${escHtml(String(id))}</strong></div>`;
}

function faturaListaVelocidadePlanoHtml() {
  const c = S.clienteData;
  if (!c) return '';
  const dl = Number(c.plano_download_mbps);
  if (!Number.isFinite(dl) || dl <= 0) return '';
  return `<div class="fatura-vel-plano">
    <div class="fatura-vel-plano-icon" aria-hidden="true"><i class="fa-solid fa-bolt"></i></div>
    <div class="fatura-vel-plano-body">
      <span class="fatura-vel-plano-label">Velocidade do plano</span>
      <span class="fatura-vel-plano-val"><strong>${dl}</strong><span class="fatura-vel-plano-unit"> Mbps</span></span>
    </div>
  </div>`;
}

function faturaListaExtrasHtml(t, tipo) {
  const parts = [];
  parts.push(faturaListaCompetenciaHtml(t.datavenc));
  parts.push(faturaListaClienteCtxHtml());
  parts.push(faturaListaIdTituloHtml(t));
  if (t.referencia) {
    parts.push(
      `<div class="fatura-desc fatura-desc--ref"><i class="fa-solid fa-tag"></i> Ref. ${escHtml(String(t.referencia))}</div>`
    );
  }
  if (t.obs) {
    const o = String(t.obs).replace(/\s+/g, ' ').trim();
    const truncated = o.length > 100 ? `${o.slice(0, 97)}…` : o;
    parts.push(`<div class="fatura-desc">${escHtml(truncated)}</div>`);
  }
  if (t.formapag) {
    parts.push(
      `<div class="fatura-desc"><i class="fa-solid fa-credit-card"></i> ${escHtml(String(t.formapag))}</div>`
    );
  }
  if (_faturaNum(t.valordesc) > 0.004) {
    parts.push(
      `<div class="fatura-desc fatura-desc--desc"><i class="fa-solid fa-tags"></i> Desconto na cobrança: <strong>${fmtMoeda(t.valordesc)}</strong></div>`
    );
  }
  const chips = [];
  if (t.pix) chips.push('<span class="fatura-chip fatura-chip--pix"><i class="fa-brands fa-pix"></i> PIX</span>');
  if (t.linhadig) chips.push('<span class="fatura-chip fatura-chip--bol"><i class="fa-solid fa-barcode"></i> Boleto</span>');
  if (chips.length) parts.push(`<div class="fatura-chips">${chips.join('')}</div>`);
  if (tipo !== 'paga' && t.lemon_clube_cupom_outra_fatura) {
    const r0 = String(t.lemon_clube_cupom_alvo_resumo || '').trim();
    const t0 = String(t.lemon_clube_cupom_alvo_texto || '').trim();
    const linha1 = r0 || t0;
    const linha2 = r0 && t0 && t0 !== r0 ? t0 : '';
    if (linha1) {
      parts.push(
        `<div class="fatura-cupom-outra" role="note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><div class="fatura-cupom-outra__body"><strong class="fatura-cupom-outra__resumo">${escHtml(linha1)}</strong>${linha2 ? `<span class="fatura-cupom-outra__det">${escHtml(linha2)}</span>` : ''}</div></div>`
      );
    }
  }
  parts.push(faturaListaVelocidadePlanoHtml());
  return parts.filter(Boolean).join('');
}

function faturaListaValorCol(t, tipo) {
  const base = _faturaNum(t.valor);
  const extra = _faturaNum(t.valormulta) + _faturaNum(t.valormora);
  const total = base + extra;
  const isPago = tipo === 'paga';
  const vMp = faturaValorMercadoPago(t, isPago);
  const pct = t.lemon_clube_desconto_percent != null ? Number(t.lemon_clube_desconto_percent) : null;
  const descVal = t.lemon_clube_valor_desconto != null ? Number(t.lemon_clube_valor_desconto) : null;
  const temCupom =
    tipo !== 'paga' && t.lemon_clube_desconto_resgatado && Math.abs(vMp - base) > 0.02;

  let html = '';
  if (temCupom) {
    const pctTxt = pct != null && Number.isFinite(pct) ? `${pct}%` : '';
    html += `<div class="fatura-valor-cupom-wrap">`;
    html += `<div class="fatura-valor-cupom-kicker"><i class="fa-solid fa-lemon" aria-hidden="true"></i> Cupom Lemon Club${pctTxt ? ` ${pctTxt}` : ''}</div>`;
    html += `<div class="fatura-valor fatura-valor--cupom">${fmtMoeda(vMp)}</div>`;
    html += `<div class="fatura-valor-cupom-legend">Total a pagar no portal (PIX ou cartão)</div>`;
    html += `<div class="fatura-valor-cupom-break">`;
    html += `<div class="fatura-valor-cupom-line"><span class="fatura-valor-cupom-label">Valor da fatura</span><span class="fatura-valor-cupom-de">${fmtMoeda(t.valor)}</span></div>`;
    if (descVal != null && Number.isFinite(descVal) && descVal > 0.004) {
      html += `<div class="fatura-valor-cupom-line fatura-valor-cupom-line--save"><span class="fatura-valor-cupom-label">Desconto do cupom</span><span class="fatura-valor-cupom-save">− ${fmtMoeda(descVal)}</span></div>`;
    }
    html += `</div></div>`;
  } else {
    html += `<div class="fatura-valor">${fmtMoeda(vMp)}</div>`;
  }
  if (tipo !== 'paga' && extra > 0.004) {
    html += `<div class="fatura-valor-extra">Total c/ multa e juros <strong>${fmtMoeda(total)}</strong></div>`;
  }
  html += `<div class="fatura-valor-hint"><span>Ver Fatura</span><i class="fa-solid fa-angle-right" aria-hidden="true"></i></div>`;
  return html;
}

function faturaItemHtml(t, tipo) {
  const statusClass = tipo === 'paga' ? 'badge-green' : tipo === 'vencida' ? 'badge-red' : 'badge-orange';
  const statusText = tipo === 'paga' ? 'Paga' : tipo === 'vencida' ? 'Vencida' : 'Aberta';
  const titulo = escHtml(faturaTipoTitulo(t));
  const prazo = faturaListaMetaPrazo(t, tipo);
  const extras = faturaListaExtrasHtml(t, tipo);
  const valorCol = faturaListaValorCol(t, tipo);
  const base = _faturaNum(t.valor);
  const vMp = faturaValorMercadoPago(t, tipo === 'paga');
  const comCupomLemon =
    tipo !== 'paga' && t.lemon_clube_desconto_resgatado && Math.abs(vMp - base) > 0.02;
  return `
    <div class="fatura-item${comCupomLemon ? ' fatura-item--cupom-lemon' : ''}" role="button" tabindex="0" onclick="abrirFatura('${t.uuid}', ${JSON.stringify(t).replace(/"/g, '&quot;')})">
      <div class="fatura-item-body">
        <div class="fatura-item-main">
          <div class="fatura-titulo-row">
            <span class="fatura-titulo-text">${titulo}</span>
            <span class="badge ${statusClass}">${statusText}</span>
          </div>
          <div class="fatura-meta-row">
            <span class="fatura-venc"><i class="fa-solid fa-calendar-days"></i>Vence ${fmtData(t.datavenc)}</span>
            ${prazo}
          </div>
          ${extras}
        </div>
        <div class="fatura-valor-col">${valorCol}</div>
      </div>
    </div>
  `;
}

function faturaTipocobLabel(v) {
  const k = String(v || '').toLowerCase();
  const map = { fat: 'Fatura', car: 'Carnê', con: 'Contrato', bol: 'Boleto', rec: 'Recibo', tit: 'Título' };
  return map[k] || (v ? String(v) : '');
}

function clienteEnderecoResumo(c) {
  if (!c || typeof c !== 'object') return '';
  const linha1 = [c.endereco, c.numero, c.complemento].filter(Boolean).map((x) => String(x).trim()).filter(Boolean).join(', ');
  const linha2 = [c.bairro, c.cep].filter(Boolean).map((x) => String(x).trim()).filter(Boolean).join(' — ');
  return [linha1, linha2].filter(Boolean).join(' · ');
}

function faturaModalVelocidadeBlockHtml() {
  const c = S.clienteData;
  if (!c) return '';
  const dl = Number(c.plano_download_mbps);
  if (!Number.isFinite(dl) || dl <= 0) return '';
  const nome = String(c.plano || c.plano_nome || '').trim();
  return `<div class="fatura-modal-vel">
    <div class="fatura-modal-vel-icon" aria-hidden="true"><i class="fa-solid fa-bolt"></i></div>
    <div class="fatura-modal-vel-body">
      <span class="fatura-modal-vel-kicker">Velocidade do plano</span>
      <span class="fatura-modal-vel-num"><strong>${dl}</strong><span class="fatura-modal-vel-unit"> Mbps</span></span>
      ${nome ? `<span class="fatura-modal-vel-plano">${escHtml(nome)}</span>` : ''}
    </div>
  </div>`;
}

async function abrirFatura(uuid, dataInline) {
  const modal   = document.getElementById('modal-fatura');
  const content = document.getElementById('modal-fatura-content');

  // Mostra loading enquanto busca dados completos
  content.innerHTML = `<div style="text-align:center;padding:32px 0"><div class="spinner"></div><p style="color:var(--text-muted);margin-top:12px;font-size:.85rem">Carregando fatura...</p></div>`;
  modal.classList.remove('hidden');

  await _ensureClienteProfile();

  let t;
  try {
    t = await request('GET', `${API}/faturas/${uuid}`);
  } catch {
    // fallback para dados inline se a chamada falhar
    t = typeof dataInline === 'string' ? JSON.parse(dataInline) : (dataInline || {});
  }

  const isPago    = t.status === 'pago' || !!t.valorpag;
  const isVencida = !isPago && t.datavenc && new Date(t.datavenc) < new Date();
  const valorMpCobrar = faturaValorMercadoPago(t, isPago);
  const lemonPct = t.lemon_clube_desconto_percent != null ? Number(t.lemon_clube_desconto_percent) : null;
  const lemonDesc = t.lemon_clube_valor_desconto != null ? Number(t.lemon_clube_valor_desconto) : null;
  const lemonLabel = t.lemon_clube_desconto_label ? String(t.lemon_clube_desconto_label) : '';

  const statusColor = isPago ? '#4ade80' : isVencida ? '#ef4444' : '#fb923c';
  const statusLabel = isPago ? 'Pago' : isVencida ? 'Vencida' : 'Em Aberto';
  const statusIcon  = isPago ? 'fa-circle-check' : isVencida ? 'fa-circle-exclamation' : 'fa-clock';
  const heroBg      = isPago
    ? 'linear-gradient(135deg,rgba(34,197,94,.12),rgba(34,197,94,.04))'
    : isVencida
      ? 'linear-gradient(135deg,rgba(239,68,68,.12),rgba(239,68,68,.04))'
      : 'linear-gradient(135deg,rgba(251,146,60,.12),rgba(251,146,60,.04))';

  const tipo = (t.tipo || 'mensalidade').charAt(0).toUpperCase() + (t.tipo || 'mensalidade').slice(1);

  const avisoCupomOutra = (() => {
    if (isPago || !t.lemon_clube_cupom_outra_fatura) return '';
    const r0 = String(t.lemon_clube_cupom_alvo_resumo || '').trim();
    const t0 = String(t.lemon_clube_cupom_alvo_texto || '').trim();
    const linha1 = r0 || t0;
    const linha2 = r0 && t0 && t0 !== r0 ? t0 : '';
    if (!linha1) return '';
    return `<div class="fatura-modal-cupom-outra" role="alert"><i class="fa-solid fa-ticket" aria-hidden="true"></i><div class="fatura-cupom-outra__body"><strong class="fatura-cupom-outra__resumo">${escHtml(linha1)}</strong>${linha2 ? `<span class="fatura-cupom-outra__det">${escHtml(linha2)}</span>` : ''}</div></div>`;
  })();

  let html = `
    <!-- Hero -->
    <div class="fatura-modal-hero" style="background:${heroBg};border-color:${statusColor}22">
      <div class="fatura-modal-valor">${fmtMoeda(!isPago ? valorMpCobrar : t.valor)}</div>
      ${
        !isPago && t.lemon_clube_desconto_resgatado && lemonPct != null && Math.abs(valorMpCobrar - _faturaNum(t.valor)) > 0.02
          ? `<div class="fatura-modal-subtipo" style="font-size:.78rem;opacity:.85">Valor da fatura ${fmtMoeda(t.valor)} · cupom Lemon Club ${lemonPct}%</div>`
          : ''
      }
      <div class="fatura-modal-subtipo">${tipo}${t.referencia ? ' · ' + escHtml(String(t.referencia)) : ''}</div>
      <div class="fatura-modal-status" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44">
        <i class="fa-solid ${statusIcon}"></i> ${statusLabel}
      </div>
    </div>
    ${avisoCupomOutra}
    ${faturaModalVelocidadeBlockHtml()}

    <!-- Detalhes -->
    <div class="fatura-modal-section">
  `;

  // Linha vencimento
  html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-calendar-days"></i> Vencimento</span><span class="modal-detail-val">${fmtData(t.datavenc)}</span></div>`;

  if (t.lemon_clube_desconto_resgatado && lemonPct != null && lemonPct > 0) {
    html += `<div class="modal-detail-row" style="background:rgba(163,230,53,.08);border-radius:10px;padding:8px 10px;margin:4px 0"><span class="modal-detail-label"><i class="fa-solid fa-lemon"></i> Lemon Club</span><span class="modal-detail-val" style="text-align:right;font-size:.8rem">${escHtml(lemonLabel || `Desconto ${lemonPct}%`)}</span></div>`;
    if (lemonDesc != null && lemonDesc > 0.004) {
      html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-percent"></i> Desconto (resgate)</span><span class="modal-detail-val" style="color:#84cc16">− ${fmtMoeda(lemonDesc)}</span></div>`;
    }
    if (!isPago && valorMpCobrar != null && Number.isFinite(valorMpCobrar)) {
      html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-sack-dollar"></i> A pagar (portal)</span><span class="modal-detail-val" style="font-weight:700;color:#65a30d">${fmtMoeda(valorMpCobrar)}</span></div>`;
    }
  }

  if (t.processamento && String(t.processamento).trim() !== '') {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-gear"></i> Processamento</span><span class="modal-detail-val" style="font-size:.8rem">${fmtData(t.processamento)}</span></div>`;
  }

  const nosso = (t.nossonum != null && String(t.nossonum).trim() !== '') ? String(t.nossonum).trim() : (t.gwt_numero || t.id);
  if (nosso != null && String(nosso).trim() !== '') {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-hashtag"></i> Nosso número</span><span class="modal-detail-val" style="font-family:ui-monospace,monospace;font-size:.8rem">${escHtml(String(nosso))}</span></div>`;
  }

  if (t.tipocob) {
    const tc = faturaTipocobLabel(t.tipocob);
    if (tc) {
      html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-file-lines"></i> Tipo</span><span class="modal-detail-val">${escHtml(tc)}</span></div>`;
    }
  }

  // Referência
  if (t.referencia) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-tag"></i> Referência</span><span class="modal-detail-val">${escHtml(String(t.referencia))}</span></div>`;
  }

  // Observação (plano / descrição)
  if (t.obs) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-circle-info"></i> Descrição</span><span class="modal-detail-val" style="font-size:.82rem;color:var(--text-muted)">${escHtml(String(t.obs))}</span></div>`;
  }

  const pctM = _faturaNum(t.percmulta);
  const pctJ = _faturaNum(t.percmora);
  const pctD = _faturaNum(t.percdesc);
  if (pctM > 0) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-percent"></i> Multa (contrato)</span><span class="modal-detail-val">${pctM.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span></div>`;
  }
  if (pctJ > 0) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-percent"></i> Juros (contrato)</span><span class="modal-detail-val">${pctJ.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span></div>`;
  }
  if (pctD > 0) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-percent"></i> Desconto (contrato)</span><span class="modal-detail-val">${pctD.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span></div>`;
  }

  // Data de pagamento
  if (t.datapag) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-check"></i> Data Pag.</span><span class="modal-detail-val" style="color:#4ade80">${fmtData(t.datapag)}</span></div>`;
  }

  // Valor pago
  if (t.valorpag) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-money-bill-wave"></i> Valor Pago</span><span class="modal-detail-val" style="color:#4ade80">${fmtMoeda(t.valorpag)}</span></div>`;
  }

  // Forma de pagamento
  if (t.formapag) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-credit-card"></i> Forma Pag.</span><span class="modal-detail-val">${escHtml(String(t.formapag))}</span></div>`;
  }

  // Desconto
  if (t.valordesc && parseFloat(t.valordesc) > 0) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-percent"></i> Desconto</span><span class="modal-detail-val" style="color:#4ade80">- ${fmtMoeda(t.valordesc)}</span></div>`;
  }

  // Multa / juros
  if (t.valormulta && parseFloat(t.valormulta) > 0) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-triangle-exclamation"></i> Multa</span><span class="modal-detail-val" style="color:#ef4444">+ ${fmtMoeda(t.valormulta)}</span></div>`;
  }
  if (t.valormora && parseFloat(t.valormora) > 0) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-clock"></i> Juros mora</span><span class="modal-detail-val" style="color:#ef4444">+ ${fmtMoeda(t.valormora)}</span></div>`;
  }

  if (!isPago) {
    const vb = _faturaNum(t.valor);
    const vm = _faturaNum(t.valormulta);
    const vj = _faturaNum(t.valormora);
    const vd = _faturaNum(t.valordesc);
    const tot = vb + vm + vj - vd;
    if (vm > 0.004 || vj > 0.004 || vd > 0.004) {
      html += `<div class="modal-detail-row" style="border-top:1px dashed var(--glass-border);margin-top:6px;padding-top:10px"><span class="modal-detail-label" style="font-weight:700"><i class="fa-solid fa-sack-dollar"></i> Total estimado</span><span class="modal-detail-val" style="font-weight:800;color:var(--lemon-dark)">${fmtMoeda(tot)}</span></div>`;
    }
  }

  {
    const endTxt = clienteEnderecoResumo(S.clienteData);
    if (endTxt) {
      html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-location-dot"></i> Endereço</span><span class="modal-detail-val" style="font-size:.82rem;color:var(--text-muted);text-align:right">${escHtml(endTxt)}</span></div>`;
    }
  }

  html += `</div>`; // fecha fatura-modal-section

  // PIX do MK-Auth (se existir)
  if (t.pix && !isPago) {
    html += `
      <div class="pix-section">
        <h4><i class="fa-solid fa-qrcode"></i> Pagar com PIX</h4>
        ${t.pix_qr ? `<div class="pix-qr"><img src="${t.pix_qr}" alt="QR Code PIX" /></div>` : ''}
        ${t.pix_link ? `<a href="${t.pix_link}" target="_blank" class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:10px;font-size:.82rem"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir link PIX</a>` : ''}
        <div class="fatura-code-label">Pix Copia e Cola</div>
        <div class="barcode-line">${t.pix}</div>
        <button class="copy-btn" style="width:100%;justify-content:center" onclick="copiar('${t.pix.replace(/'/g,"\\'")}', this)">
          <i class="fa-solid fa-copy"></i> Copiar chave PIX
        </button>
      </div>`;
  }

  // Boleto
  if (t.linhadig && !isPago) {
    html += `
      <div class="boleto-section">
        <h4><i class="fa-solid fa-barcode"></i> Boleto Bancário</h4>
        <div class="fatura-code-label">Linha digitável</div>
        <div class="barcode-line">${t.linhadig}</div>
        <button class="copy-btn" style="width:100%;justify-content:center" onclick="copiar('${t.linhadig.replace(/'/g,"\\'")}', this)">
          <i class="fa-solid fa-copy"></i> Copiar linha digitável
        </button>
      </div>`;
  }

  // Mercado Pago: PIX + cartão (cobrança imediata desta fatura)
  if (!isPago) {
    const descMP = `Mensalidade Internet${t.referencia ? ' - ' + t.referencia : ''}`;
    const escDesc = descMP.replace(/'/g, "\\'");
    html += `
      <div id="mp-pix-area" style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
        <button type="button" id="btn-mp-pix" class="btn btn-primary" style="width:100%;justify-content:center;background:linear-gradient(135deg,#009ee3,#007ab8);gap:10px;font-size:.9rem;padding:14px;color:#fff;border:none;box-shadow:0 4px 14px rgba(0,158,227,.35)"
          onclick="gerarPixMP('${uuid}', ${valorMpCobrar}, '${escDesc}')">
          <img src="https://http2.mlstatic.com/frontend-assets/ui-navigation/5.19.1/mercadopago/logo__large@2x.png" alt="Mercado Pago" style="height:22px;width:auto;object-fit:contain;display:block" loading="lazy">
          Pagar via PIX
        </button>
        <button type="button" id="btn-mp-sub" class="btn" style="width:100%;justify-content:center;gap:10px;font-size:.85rem;padding:12px 14px;color:#fff;background:rgba(255,255,255,.06);border:1px solid rgba(0,158,227,.45);border-radius:12px"
          onclick="void abrirFormAssinaturaMP('${uuid}', ${valorMpCobrar}, '${escDesc}')">
          <i class="fa-solid fa-credit-card" style="color:#7dd3fc"></i>
          Pagar fatura no cartão
        </button>
        <p style="font-size:.68rem;color:rgba(255,255,255,.45);margin:0;line-height:1.35">Cobrança imediata do valor da fatura no cartão. Os dados são tokenizados pelo Mercado Pago no navegador. A baixa ocorre quando o pagamento for aprovado.</p>
        <div id="mp-sub-content" style="display:none;margin-top:10px"></div>
        <div id="mp-pix-content" style="margin-top:4px"></div>
      </div>`;
  }

  content.innerHTML = html;
}

// ===== CHAMADOS =====

async function loadChamados() {
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

async function abrirChamado(id) {
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

document.getElementById('form-chamado').addEventListener('submit', async (e) => {
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
    completarMissao('abrir_chamado', null);
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

// ===== PERFIL =====

async function loadPerfil() {
  const container = document.getElementById('perfil-dados');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    const me = S.clienteData || await request('GET', `${API}/me`);
    S.clienteData = me;

    // Avatar com iniciais
    const initials = (me.nome || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const avatarEl = document.getElementById('perfil-avatar-initials');
    if (avatarEl) avatarEl.textContent = initials;

    // Hero
    const nomeEl = document.getElementById('perfil-hero-name');
    if (nomeEl) nomeEl.textContent = me.nome || '—';
    const loginEl = document.getElementById('perfil-hero-login');
    if (loginEl) loginEl.textContent = '@' + (me.login || '');

    // Plano nas stats
    const planEl = document.getElementById('perfil-stat-plano');
    if (planEl) planEl.textContent = me.plano || me.contrato || '—';
    const desdeEl = document.getElementById('perfil-stat-desde');
    if (desdeEl) desdeEl.textContent = fmtData(me.cadastro) || '—';

    // Dados pessoais
    container.innerHTML = `
      ${perfilRow('fa-user',           'Nome Completo', me.nome)}
      ${perfilRow('fa-id-badge',       'Login',         me.login)}
      ${perfilRow('fa-id-card',        'CPF / CNPJ',    me.cpf_cnpj)}
      ${perfilRow('fa-envelope',       'E-mail',        me.email)}
      ${perfilRow('fa-phone',          'Telefone',      me.fone || me.telefone)}
      ${perfilRow('fa-mobile-screen',  'Celular',       me.celular)}
      ${perfilRow('fa-location-dot',   'Endereço',      [me.endereco, me.numero, me.complemento].filter(Boolean).join(', '))}
      ${perfilRow('fa-map-pin',        'Bairro / CEP',  [me.bairro, me.cep].filter(Boolean).join(' — '))}
      ${perfilRow('fa-city',           'Cidade / UF',   [me.cidade, me.estado].filter(Boolean).join(' - '))}
      ${perfilRow('fa-calendar',       'Cliente desde', fmtData(me.cadastro))}
      ${perfilRow('fa-circle-check',   'Status',        me.status || 'Ativo')}
    `;

    // Formulário
    document.getElementById('perfil-email').value       = me.email       || '';
    document.getElementById('perfil-telefone').value    = me.fone        || me.telefone || '';
    document.getElementById('perfil-celular').value     = me.celular     || '';
    document.getElementById('perfil-endereco').value    = me.endereco    || '';
    document.getElementById('perfil-numero').value      = me.numero      || '';
    document.getElementById('perfil-cep').value         = me.cep         || '';
    document.getElementById('perfil-complemento').value = me.complemento || '';
    document.getElementById('perfil-bairro').value      = me.bairro      || '';
    document.getElementById('perfil-cidade').value      = me.cidade      || '';

    // Carregar dados do clube para preencher nível / pontos
    _carregarPerfilClube();
    loadCarteira();
  } catch {
    container.innerHTML = emptyState('fa-triangle-exclamation', 'Erro ao carregar perfil');
  }
}

function _carteiraBrandClass(pmId) {
  const id = String(pmId || '').toLowerCase();
  if (id.includes('visa')) return 'carteira-row-card--visa';
  if (id.includes('master') || id === 'debmaster') return 'carteira-row-card--master';
  if (id.includes('elo')) return 'carteira-row-card--elo';
  if (id.includes('amex')) return 'carteira-row-card--amex';
  return 'carteira-row-card--default';
}

function _carteiraBrandLabel(pmId) {
  const id = String(pmId || '').toUpperCase();
  if (!id) return 'Cartão';
  if (id.includes('VISA')) return 'Visa';
  if (id.includes('MASTER')) return 'Mastercard';
  if (id.includes('ELO')) return 'Elo';
  if (id.includes('AMEX')) return 'Amex';
  return id.slice(0, 12);
}

/** Logos de bandeira. Mastercard: SVG (2 círculos) — fa-cc-mastercard costuma ser Pro / some no FA free. */
function _carteiraBrandMark(pmId) {
  const id = String(pmId || '').toLowerCase();
  if (id.includes('master') || id === 'debmaster') {
    const svg =
      '<svg class="carteira-svg-mc" viewBox="0 0 44 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" shape-rendering="geometricPrecision">' +
      '<circle cx="15" cy="12" r="10.5" fill="#EB001B"/>' +
      '<circle cx="29" cy="12" r="10.5" fill="#F79E1B"/>' +
      '</svg>';
    return `<span class="carteira-brand-mark" aria-label="Mastercard">${svg}</span>`;
  }
  if (id.includes('visa')) {
    return '<span class="carteira-brand-mark" aria-label="Visa"><i class="fa-brands fa-cc-visa"></i></span>';
  }
  if (id.includes('amex')) {
    return '<span class="carteira-brand-mark" aria-label="American Express"><i class="fa-brands fa-cc-amex"></i></span>';
  }
  return '';
}

function toggleCarteiraAddForm(forceClose) {
  const panel = document.getElementById('carteira-add-panel');
  const btn = document.getElementById('btn-carteira-toggle');
  if (!panel) return;
  if (forceClose) {
    panel.classList.add('hidden');
    if (btn) btn.disabled = false;
    return;
  }
  const open = panel.classList.toggle('hidden');
  if (!open) {
    const cpf = (S.clienteData && (S.clienteData.cpf_cnpj || '')) ? String(S.clienteData.cpf_cnpj).replace(/\D/g, '') : '';
    const el = document.getElementById('carteira-cpf');
    if (el && !el.value) el.value = cpf;
    void preencherCarteiraMpAviso();
  }
  if (btn) btn.disabled = !panel.classList.contains('hidden');
}

async function loadCarteira() {
  const el = document.getElementById('carteira-lista');
  if (!el) return;
  el.innerHTML = '<div class="spinner" style="margin:20px auto"></div>';
  try {
    const res = await request('GET', `${API}/carteira`);
    const cards = res.cards || [];
    if (!cards.length) {
      el.innerHTML = '<div class="carteira-empty"><i class="fa-regular fa-credit-card"></i><span>Nenhum cartão salvo. Use &quot;Adicionar cartão&quot; para guardar um cartão com segurança.</span></div>';
      return;
    }
    el.innerHTML = `<div class="carteira-lista">${cards.map((c) => {
      const brand = _carteiraBrandClass(c.payment_method_id);
      const label = _carteiraBrandLabel(c.payment_method_id);
      const mark = _carteiraBrandMark(c.payment_method_id);
      const topBrand = mark || `<span class="carteira-row-brand">${label}</span>`;
      const last = fmt(c.last_four);
      const holder = c.holder_name ? `<span class="carteira-row-holder">${fmt(c.holder_name)}</span>` : '';
      return `
        <div class="carteira-row">
          <div class="carteira-row-card ${brand}">
            <div class="carteira-row-card-top">${topBrand}</div>
            <span class="carteira-row-pan">•••• ${last}</span>
          </div>
          <div class="carteira-row-meta">
            ${holder}
            <button type="button" class="btn btn-ghost btn-sm carteira-row-remove" onclick="removerCartaoCarteira(${c.id})" title="Remover cartão">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>`;
    }).join('')}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="carteira-err"><i class="fa-solid fa-triangle-exclamation"></i> ${fmt(e.message)}</div>`;
  }
}

async function confirmarCarteiraAdd() {
  const nome = document.getElementById('carteira-nome')?.value || '';
  const numero = document.getElementById('carteira-num')?.value || '';
  const mes = document.getElementById('carteira-mes')?.value || '';
  const ano = document.getElementById('carteira-ano')?.value || '';
  const cvv = document.getElementById('carteira-cvv')?.value || '';
  const cpf = document.getElementById('carteira-cpf')?.value || '';
  if (!nome || !numero || !mes || !ano || !cvv || cpf.length < 11) {
    alert('Preencha todos os campos do cartão e CPF (11 dígitos).');
    return;
  }
  const sbtn = document.getElementById('btn-carteira-salvar');
  if (sbtn) { sbtn.disabled = true; sbtn.innerHTML = '<div class="spinner" style="width:16px;height:16px;margin:0"></div> Salvando...'; }
  try {
    const cfg = await request('GET', `${API}/pagamento/config`);
    if (cfg.chavesAlinhadas === false) {
      throw new Error(cfg.dica || 'Credenciais Mercado Pago inconsistentes no servidor.');
    }
    const pub = cfg.publicKey;
    if (!pub) throw new Error('Public Key do Mercado Pago não configurada no servidor.');
    const cardToken = await _mpCriarCardToken(pub, { nome, numero, mes, ano, cvv, cpf });
    await request('POST', `${API}/carteira/cartao`, { cardToken });
    document.getElementById('carteira-nome').value = '';
    document.getElementById('carteira-num').value = '';
    document.getElementById('carteira-mes').value = '';
    document.getElementById('carteira-ano').value = '';
    document.getElementById('carteira-cvv').value = '';
    toggleCarteiraAddForm(true);
    await loadCarteira();
  } catch (e) {
    alert(e.message || 'Não foi possível salvar o cartão.');
  } finally {
    if (sbtn) { sbtn.disabled = false; sbtn.innerHTML = '<i class="fa-solid fa-lock"></i> Salvar na carteira'; }
  }
}

async function removerCartaoCarteira(id) {
  if (!confirm('Remover este cartão da sua carteira?')) return;
  try {
    await request('DELETE', `${API}/carteira/cartao/${id}`);
    loadCarteira();
  } catch (e) {
    alert(e.message || 'Não foi possível remover o cartão.');
  }
}

async function _carregarPerfilClube() {
  try {
    const stats = await request('GET', `${API}/clube/stats`);

    // Badge de nível
    const nv = stats.nivel || {};
    const nivelEl = document.getElementById('perfil-badge-nivel');
    if (nivelEl) {
      nivelEl.textContent = (nv.icon || '') + ' ' + (nv.label || '');
      nivelEl.style.color = nv.color || 'var(--lemon)';
      nivelEl.style.borderColor = (nv.color || 'var(--lemon)') + '44';
      nivelEl.style.background  = (nv.color || 'var(--lemon)') + '11';
    }
    // Pontos no badge
    const ptsEl = document.getElementById('perfil-badge-pts');
    if (ptsEl) ptsEl.textContent = (stats.pontos || 0) + ' pts';

    // Stats rápidos
    const streakEl = document.getElementById('perfil-stat-streak');
    if (streakEl) streakEl.textContent = stats.streak || 0;
    const missoesEl = document.getElementById('perfil-stat-missoes');
    if (missoesEl) missoesEl.textContent = (stats.completedMissions || []).length;

    // Card do clube
    const clubNivelEl = document.getElementById('perfil-clube-nivel-label');
    if (clubNivelEl) {
      clubNivelEl.textContent = (nv.icon || '') + ' ' + (nv.label || '');
      clubNivelEl.style.color = nv.color || 'var(--lemon)';
    }
    const clubPtsEl = document.getElementById('perfil-clube-pts');
    if (clubPtsEl) clubPtsEl.textContent = stats.pontos || 0;

    // Barra de progresso de nível
    const barFill    = document.getElementById('perfil-clube-bar-fill');
    const progressTxt = document.getElementById('perfil-clube-progress-txt');
    const ratioEl    = document.getElementById('perfil-clube-bar-ratio');
    if (barFill && stats.proximoNivel) {
      const total = stats.proximoNivel.min - (nv.min || 0);
      const atual = (stats.totalEarned || 0) - (nv.min || 0);
      const pct   = Math.min(Math.max(atual / total, 0), 1) * 100;
      setTimeout(() => { barFill.style.width = pct + '%'; }, 300);
      if (ratioEl) ratioEl.textContent = `${stats.totalEarned || 0} / ${stats.proximoNivel.min} pts`;
      if (progressTxt) progressTxt.textContent = `${stats.ptsFaltamProx} pts para ${stats.proximoNivel.icon} ${stats.proximoNivel.label}`;
    } else if (barFill) {
      setTimeout(() => { barFill.style.width = '100%'; }, 300);
      if (ratioEl) ratioEl.textContent = `${stats.totalEarned || 0} pts`;
      if (progressTxt) progressTxt.textContent = '🏆 Nível máximo — Diamante!';
    }
  } catch { /* silencioso */ }
}

function perfilRow(icon, label, value) {
  return `
    <div class="perfil-row">
      <div class="perfil-row-icon"><i class="fa-solid ${icon}"></i></div>
      <div>
        <div class="perfil-label">${label}</div>
        <div class="perfil-val">${fmt(value)}</div>
      </div>
    </div>
  `;
}

document.getElementById('form-perfil').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;margin:0"></div> Salvando...';

  try {
    const res = await request('PUT', `${API}/perfil`, {
      email: document.getElementById('perfil-email').value,
      telefone: document.getElementById('perfil-telefone').value,
      celular: document.getElementById('perfil-celular').value,
      endereco: document.getElementById('perfil-endereco').value,
      numero: document.getElementById('perfil-numero').value,
      cep: document.getElementById('perfil-cep').value,
      complemento: document.getElementById('perfil-complemento').value,
      bairro: document.getElementById('perfil-bairro').value,
      cidade: document.getElementById('perfil-cidade').value,
    });

    if (res.modo === 'chamado') {
      showAlert('perfil-feedback', res.aviso, 'success');
    } else {
      showAlert('perfil-feedback', 'Dados atualizados com sucesso!', 'success');
      S.clienteData = null;
      loadPerfil();
    }
    completarMissao('mudar_dados', null, false);
  } catch (err) {
    showAlert('perfil-feedback', err.message || 'Erro ao salvar dados.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Alterações';
  }
});
