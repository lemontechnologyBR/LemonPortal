/**
 * Portal do cliente — núcleo (navegação, dashboard, faturas, chamados, perfil).
 * MP, velocidade e Lemon Club: modules/.
 */
import { API, MP_LOGO_IMG, VIEW_TITLES } from './modules/constants.js';
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

const loadNotificacoes = notif.loadNotificacoes;

/** MP, conexão, Lemon Club — globais para onclick / HTML */
Object.assign(window, {
  gerarPixMP: mp.gerarPixMP,
  fecharFormAssinaturaMP: mp.fecharFormAssinaturaMP,
  abrirFormAssinaturaMP: mp.abrirFormAssinaturaMP,
  confirmarAssinaturaComToken: mp.confirmarAssinaturaComToken,
  assinaturaMercadoPagoHosted: mp.assinaturaMercadoPagoHosted,
  preencherCarteiraMpAviso: mp.preencherCarteiraMpAviso,
  _mpCriarCardToken: mp._mpCriarCardToken,
  loadConexao: conn.loadConexao,
  loadVelocidade: conn.loadVelocidade,
  iniciarSpeedTest: conn.iniciarSpeedTest,
  limparHistoricoSpeed: conn.limparHistoricoSpeed,
  navToVelocidade: conn.navToVelocidade,
  missaoVisita: club.missaoVisita,
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
});

conn.wireSpeedtestMissions((tipo, btn, sil) => club.completarMissao(tipo, btn, sil));
club.initClubPwa();


/**
 * Fonte do bundle do portal do cliente.
 * Após alterar este ficheiro, regenere o script servido ao navegador:
 *   npm run build:portal
 * O browser carrega /js/portal-app.js (ES modules em public/js/modules/), não este ficheiro.
 */

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

function _dashFirstImgFromHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i) || html.match(/<img[^>]+src=([^\s>]+)/i);
  if (!m) return '';
  let u = m[1].replace(/&amp;/g, '&').trim();
  if (!/^https?:\/\//i.test(u)) return '';
  return u;
}

function _dashImgFromXmlItem(item) {
  const enc = item.querySelector('enclosure');
  const u = enc?.getAttribute('url');
  if (u && /^https?:\/\//i.test(u)) return u;
  const desc = item.querySelector('description');
  const raw = desc?.textContent || desc?.innerHTML || '';
  const fromDesc = _dashFirstImgFromHtml(raw);
  if (fromDesc) return fromDesc;
  try {
    const blob = new XMLSerializer().serializeToString(item);
    const m = blob.match(/url=["'](https?:[^"']+)["']/i);
    if (m && /image|jpg|jpeg|png|webp/i.test(blob)) return m[1];
  } catch (_) {}
  return '';
}

function _dashRenderNewsCarousel(el, rows) {
  if (!rows.length) throw new Error('vazio');
  const dots = rows
    .map((_, i) => `<button type="button" class="dash-news-dot${i === 0 ? ' is-active' : ''}" data-i="${i}" aria-label="Notícia ${i + 1}"></button>`)
    .join('');
  const slides = rows
    .map(({ title, link, img }) => {
      const t = title || 'Sem título';
      const href = /^https?:\/\//i.test(link || '') ? link : '#';
      const safeImg = img && /^https?:\/\//i.test(img) ? _dashXmlEscAttr(img) : '';
      const media = safeImg
        ? `<div class="dash-news-slide-media"><img class="dash-news-slide-img" src="${safeImg}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling?.classList.add('is-on')" /><div class="dash-news-slide-ph" aria-hidden="true"><i class="fa-solid fa-image"></i></div></div>`
        : `<div class="dash-news-slide-media"><div class="dash-news-slide-ph is-on" aria-hidden="true"><i class="fa-solid fa-newspaper"></i></div></div>`;
      return `<a class="dash-news-slide" href="${_dashXmlEscAttr(href)}" target="_blank" rel="noopener noreferrer">${media}<div class="dash-news-slide-body"><span class="dash-news-src">G1</span><span class="dash-news-title">${_dashXmlEsc(t)}</span></div></a>`;
    })
    .join('');
  el.innerHTML = `
    <div class="dash-news-carousel">
      <div class="dash-news-viewport">
        <div class="dash-news-track">${slides}</div>
      </div>
      <div class="dash-news-dots">${dots}</div>
    </div>`;
  _dashNewsCarouselBind(el.querySelector('.dash-news-carousel'));
}

function _dashNewsCarouselBind(root) {
  if (!root) return;
  const vp = root.querySelector('.dash-news-viewport');
  const track = root.querySelector('.dash-news-track');
  if (!vp || !track) return;
  const slides = [...track.querySelectorAll('.dash-news-slide')];
  if (!slides.length) return;

  const setSlideWidths = () => {
    const w = Math.floor(vp.getBoundingClientRect().width);
    if (w < 60) return;
    slides.forEach((s) => {
      s.style.flex = `0 0 ${w}px`;
      s.style.width = `${w}px`;
      s.style.minWidth = `${w}px`;
    });
  };
  setSlideWidths();
  const onResize = () => setSlideWidths();
  window.addEventListener('resize', onResize);

  const syncDots = () => {
    const w = vp.clientWidth || 1;
    const i = Math.min(slides.length - 1, Math.max(0, Math.round(vp.scrollLeft / w)));
    root.querySelectorAll('.dash-news-dot').forEach((d, di) => d.classList.toggle('is-active', di === i));
  };

  const goDelta = (dir) => {
    const w = vp.clientWidth;
    const max = vp.scrollWidth - vp.clientWidth;
    if (dir > 0) {
      if (vp.scrollLeft >= max - 4) vp.scrollTo({ left: 0, behavior: 'smooth' });
      else vp.scrollBy({ left: w, behavior: 'smooth' });
    } else {
      if (vp.scrollLeft <= 4) vp.scrollTo({ left: max, behavior: 'smooth' });
      else vp.scrollBy({ left: -w, behavior: 'smooth' });
    }
  };

  root.querySelectorAll('.dash-news-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      const i = parseInt(dot.getAttribute('data-i'), 10) || 0;
      vp.scrollTo({ left: i * vp.clientWidth, behavior: 'smooth' });
    });
  });
  vp.addEventListener('scroll', syncDots, { passive: true });

  let paused = false;
  const tick = setInterval(() => {
    if (!root.isConnected) {
      clearInterval(tick);
      window.removeEventListener('resize', onResize);
      return;
    }
    if (!paused) goDelta(1);
  }, 6500);
  vp.addEventListener('mouseenter', () => {
    paused = true;
  });
  vp.addEventListener('mouseleave', () => {
    paused = false;
  });
  vp.addEventListener('touchstart', () => {
    paused = true;
  }, { passive: true });
  vp.addEventListener('touchend', () => {
    setTimeout(() => {
      paused = false;
    }, 3000);
  }, { passive: true });
}

/** RSS G1 no browser. rss2json primeiro (thumbnails); fallback allorigins. */
async function loadDashHeadlinesFromRss() {
  const el = document.getElementById('dash-noticias');
  if (!el) return;
  el.innerHTML = '<div class="spinner" style="margin:16px auto"></div>';
  const rssUrl = 'https://g1.globo.com/rss/g1/';

  const viaRss2Json = async () => {
    const u = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl);
    const res = await fetch(u, { credentials: 'omit' });
    if (!res.ok) throw new Error('rede2');
    const j = await res.json();
    if (j.status !== 'ok' || !Array.isArray(j.items)) throw new Error('json');
    const rows = j.items.slice(0, 8).map((it) => {
      const title = (it.title || '').replace(/<[^>]+>/g, '').trim();
      const link = (it.link || '').trim();
      let img = (it.thumbnail && String(it.thumbnail).trim()) || '';
      const enc = it.enclosure;
      if (!img && enc && typeof enc === 'object') {
        const l = (enc.link || enc.url || '').trim();
        const typ = String(enc.type || '');
        if (l && /^https?:\/\//i.test(l) && (!typ || /image/i.test(typ))) img = l;
      }
      if (!img) img = _dashFirstImgFromHtml(it.description || '');
      return { title, link, img: /^https?:\/\//i.test(img) ? img : '' };
    });
    _dashRenderNewsCarousel(el, rows);
  };

  const viaAllorigins = async () => {
    const proxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(rssUrl);
    const res = await fetch(proxy, { credentials: 'omit' });
    if (!res.ok) throw new Error('rede');
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('xml');
    const ch = doc.querySelector('channel');
    const nodes = ch ? [...ch.querySelectorAll('item')].slice(0, 8) : [...doc.querySelectorAll('item')].slice(0, 8);
    const rows = nodes.map((item) => {
      const title = item.querySelector('title')?.textContent?.trim() || '';
      const le = item.querySelector('link');
      const link = (le?.textContent || le?.getAttribute?.('href') || '').trim();
      const img = _dashImgFromXmlItem(item);
      return { title, link, img };
    });
    _dashRenderNewsCarousel(el, rows);
  };

  try {
    await viaRss2Json();
  } catch (_) {
    try {
      await viaAllorigins();
    } catch (__) {
      el.innerHTML =
        '<div class="dash-news-empty">Notícias indisponíveis (rede ou bloqueio HTTP/3). Tente outro browser, desligar VPN ou em Chrome: <code>chrome://flags/#enable-quic</code> → Disabled.</div>';
    }
  }
}

/** WMO weathercode → ícone FA + rótulo PT (Open-Meteo). */
function _dashWeatherCodeInfo(code) {
  const c = Number(code);
  if (Number.isNaN(c)) return { icon: 'fa-cloud', label: 'Indefinido' };
  if (c === 0) return { icon: 'fa-sun', label: 'Céu limpo' };
  if (c === 1) return { icon: 'fa-cloud-sun', label: 'Predominantemente limpo' };
  if (c === 2) return { icon: 'fa-cloud-sun', label: 'Parcialmente nublado' };
  if (c === 3) return { icon: 'fa-cloud', label: 'Nublado' };
  if (c === 45 || c === 48) return { icon: 'fa-smog', label: 'Nevoeiro' };
  if (c === 51 || c === 53 || c === 55) return { icon: 'fa-cloud-rain', label: 'Garoa' };
  if (c === 56 || c === 57) return { icon: 'fa-cloud-rain', label: 'Garoa gelada' };
  if (c === 61 || c === 63 || c === 65) return { icon: 'fa-cloud-showers-heavy', label: 'Chuva' };
  if (c === 66 || c === 67) return { icon: 'fa-cloud-showers-heavy', label: 'Chuva gelada' };
  if (c >= 71 && c <= 77) return { icon: 'fa-snowflake', label: 'Neve' };
  if (c === 80 || c === 81 || c === 82) return { icon: 'fa-cloud-sun-rain', label: 'Pancadas de chuva' };
  if (c === 85 || c === 86) return { icon: 'fa-snowflake', label: 'Pancadas de neve' };
  if (c >= 95 && c <= 99) {
    const granizo = c === 96 || c === 99;
    return { icon: 'fa-cloud-bolt', label: granizo ? 'Trovoada com granizo' : 'Trovoada' };
  }
  return { icon: 'fa-cloud', label: 'Tempo variável' };
}

function _dashWindDirRose(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return '';
  const d = ((Number(deg) % 360) + 360) % 360;
  const roses = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const i = Math.round(d / 22.5) % 16;
  return roses[i] || '';
}

/**
 * Nome legível da cidade/região a partir de coordenadas (só para o rótulo no ecrã).
 * Open-Meteo não devolve cidade — usa Nominatim (OSM), política de uso: 1 pedido ao abrir o clima.
 */
async function _dashReverseGeocodePt(lat, lon) {
  try {
    const url =
      'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' +
      encodeURIComponent(lat) +
      '&lon=' +
      encodeURIComponent(lon) +
      '&accept-language=pt-BR';
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) return null;
    const j = await res.json();
    const a = j.address || {};
    const city =
      a.city ||
      a.town ||
      a.village ||
      a.municipality ||
      a.county ||
      a.city_district ||
      a.suburb;
    const estado = a.state;
    if (city && estado) return `${city} — ${estado}`;
    if (city) return city;
    if (j.display_name) return String(j.display_name).split(',').slice(0, 3).join(',').trim().slice(0, 88);
    return null;
  } catch (_) {
    return null;
  }
}

/** Recorta série horária (passo 3 h) a partir do instante atual. */
function _dashSliceHourlyForecast(hourly) {
  const timeArr = hourly?.time || [];
  const t2 = hourly?.temperature_2m || [];
  const pr = hourly?.precipitation_probability || [];
  const ws = hourly?.wind_speed_10m || [];
  const now = Date.now();
  let start = 0;
  for (let i = 0; i < timeArr.length; i++) {
    if (new Date(timeArr[i]).getTime() >= now - 30 * 60 * 1000) {
      start = i;
      break;
    }
  }
  const step = 3;
  const count = 8;
  const labels = [];
  const temp = [];
  const rain = [];
  const wind = [];
  for (let k = 0; k < count; k++) {
    const i = start + k * step;
    if (i >= timeArr.length) break;
    const d = new Date(timeArr[i]);
    labels.push(d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    temp.push(Number(t2[i]));
    rain.push(pr[i] != null ? Number(pr[i]) : 0);
    wind.push(ws[i] != null ? Number(ws[i]) : 0);
  }
  return { labels, temp, rain, wind, startIdx: start };
}

/** Gráfico SVG simples (temperatura / chuva % / vento). */
function _dashWeatherBuildChartSvg(values, labels, mode) {
  const n = values.length;
  if (!n || !labels.length) {
    return '<p style="text-align:center;font-size:.75rem;color:var(--text-muted);padding:14px 8px">Sem dados horários suficientes.</p>';
  }
  const W = 340;
  const H = 108;
  const padT = 20;
  const padB = 18;
  const padX = 10;
  const innerW = W - padX * 2;
  const innerH = H - padT - padB;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const pad = mode === 'temp' ? 1.5 : mode === 'rain' ? 6 : Math.max(1.5, (maxV - minV) * 0.12);
  const lo = minV - pad;
  const hi = maxV + pad;
  const span = Math.max(0.001, hi - lo);
  const pts = values.map((v, i) => {
    const x = padX + innerW * (n <= 1 ? 0.5 : i / (n - 1));
    const y = padT + innerH * (1 - (v - lo) / span);
    return [x, y];
  });
  const stroke = mode === 'temp' ? '#ea580c' : mode === 'rain' ? '#0284c7' : '#6366f1';
  const fill =
    mode === 'temp' ? 'rgba(234,88,12,0.16)' : mode === 'rain' ? 'rgba(2,132,199,0.14)' : 'rgba(99,102,241,0.14)';
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const first = pts[0];
  const yb = (padT + innerH).toFixed(1);
  const areaD = `${lineD} L ${last[0].toFixed(1)} ${yb} L ${first[0].toFixed(1)} ${yb} Z`;
  let texts = '';
  pts.forEach((p, i) => {
    const val = values[i];
    const disp =
      mode === 'temp' ? String(Math.round(val)) : mode === 'rain' ? `${Math.round(val)}%` : `${Math.round(val)}`;
    texts += `<text x="${p[0].toFixed(1)}" y="${(p[1] - 6).toFixed(1)}" text-anchor="middle" fill="#141824" font-size="9" font-weight="700">${disp}</text>`;
  });
  let labs = '';
  labels.forEach((lb, i) => {
    if (i >= pts.length) return;
    labs += `<text x="${pts[i][0].toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" fill="#5c6478" font-size="8" font-weight="600">${lb}</text>`;
  });
  return `<svg class="dash-clima-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gráfico horário">
    <path d="${areaD}" fill="${fill}" stroke="none"/>
    <path d="${lineD}" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    ${texts}
    ${labs}
  </svg>`;
}

function _dashWeatherBindWidget(root, payload) {
  if (!root || !payload) return;
  const chart = root.querySelector('[data-clima-chart]');
  const tabs = [...root.querySelectorAll('.dash-clima-tab')];
  const hint = root.querySelector('[data-clima-day-hint]');
  const dayBtns = [...root.querySelectorAll('.dash-clima-day')];

  const renderChart = (mode) => {
    const series =
      mode === 'rain' ? payload.hourly.rain : mode === 'wind' ? payload.hourly.wind : payload.hourly.temp;
    if (chart) chart.innerHTML = _dashWeatherBuildChartSvg(series, payload.hourly.labels, mode);
    tabs.forEach((t) => t.classList.toggle('is-active', t.getAttribute('data-chart') === mode));
  };

  tabs.forEach((t) => {
    t.addEventListener('click', () => renderChart(t.getAttribute('data-chart')));
  });

  dayBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      dayBtns.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const i = parseInt(btn.getAttribute('data-day-i'), 10);
      const d = payload.daily[i];
      if (d && hint) {
        hint.textContent = `${d.dateLong} · ${d.label} · máx ${d.tmax}° · mín ${d.tmin}°`;
      }
    });
  });

  renderChart('temp');
}

/** Dólar e euro (AwesomeAPI) — só no browser. */
async function loadDashCotacao() {
  const el = document.getElementById('dash-cotacao');
  if (!el) return;
  el.innerHTML = '<div class="spinner" style="margin:14px auto"></div>';
  const specs = [
    { key: 'USDBRL', label: 'USD', crypto: false },
    { key: 'EURBRL', label: 'EUR', crypto: false },
    { key: 'BTCBRL', label: 'BTC', crypto: true },
    { key: 'ETHBRL', label: 'ETH', crypto: true },
  ];
  try {
    const res = await fetch(
      'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,BTC-BRL,ETH-BRL',
      { credentials: 'omit' }
    );
    if (!res.ok) throw new Error('http');
    const j = await res.json();
    const fmtBrl = (bid, crypto) => {
      if (!Number.isFinite(bid)) return '—';
      if (crypto) {
        return bid.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          maximumFractionDigits: bid >= 100_000 ? 0 : bid >= 1000 ? 1 : 2,
        });
      }
      return bid.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };
    const row = (pair, label, crypto) => {
      if (!pair) return '';
      const bid = parseFloat(pair.bid);
      const pct = parseFloat(pair.pctChange);
      const pctOk = Number.isFinite(pct);
      const cls = pctOk ? (pct >= 0 ? 'up' : 'down') : '';
      const sign = pctOk && pct > 0 ? '+' : '';
      const brl = fmtBrl(bid, crypto);
      const varTxt = pctOk ? `${sign}${pct.toFixed(2)}%` : '';
      return `<div class="dash-cotacao-pair">
        <span class="dash-cotacao-label">${label}</span>
        <div style="text-align:right">
          <div class="dash-cotacao-val">${brl}</div>
          ${varTxt ? `<div class="dash-cotacao-var ${cls}">${varTxt}</div>` : ''}
        </div>
      </div>`;
    };
    const rows = specs.map((s) => row(j[s.key], s.label, s.crypto)).join('');
    el.innerHTML = `<div class="dash-cotacao-inner">
      ${rows}
      <div class="dash-cotacao-foot">Moedas e cripto em BRL (AwesomeAPI). Referência de mercado.</div>
    </div>`;
  } catch (_) {
    el.innerHTML = '<div class="dash-cotacao-empty">Cotação indisponível neste momento.</div>';
  }
}

/** Próximos feriados nacionais (Nager.Date / Brasil). */
async function loadDashFeriados() {
  const el = document.getElementById('dash-feriados');
  if (!el) return;
  el.innerHTML = '<div class="spinner" style="margin:14px auto"></div>';
  const y = new Date().getFullYear();
  try {
    const fetches = [fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/BR`, { credentials: 'omit' })];
    if (new Date().getMonth() >= 10) {
      fetches.push(fetch(`https://date.nager.at/api/v3/PublicHolidays/${y + 1}/BR`, { credentials: 'omit' }));
    }
    const parts = await Promise.all(fetches);
    const lists = await Promise.all(parts.map((r) => (r.ok ? r.json() : [])));
    const merged = ([]).concat(...lists).filter((h) => h && h.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = merged
      .map((h) => {
        const d = new Date(`${h.date}T12:00:00`);
        return { d, name: h.localName || h.name || 'Feriado', dateStr: h.date };
      })
      .filter((h) => !isNaN(h.d.getTime()) && h.d >= today)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    if (!upcoming.length) {
      el.innerHTML = '<div class="dash-feriados-empty">Sem feriados futuros na lista.</div>';
      return;
    }
    const items = upcoming
      .map(
        (h) => `<li><span class="dash-feriados-date">${h.d.toLocaleDateString('pt-BR', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
        })}</span><span class="dash-feriados-name">${escHtml(h.name)}</span></li>`
      )
      .join('');
    el.innerHTML = `<div class="dash-feriados-title">Brasil — próximos</div><ul class="dash-feriados-list">${items}</ul>`;
  } catch (_) {
    el.innerHTML = '<div class="dash-feriados-empty">Feriados indisponíveis neste momento.</div>';
  }
}

/** Clima (Open-Meteo v1): atual + horas + 8 dias — estilo card com gráfico e abas. */
async function loadDashWeatherOpenMeteo() {
  const el = document.getElementById('dash-clima');
  if (!el) return;
  el.innerHTML = '<div class="spinner" style="margin:16px auto"></div>';

  const fallback = { lat: -23.55052, lon: -46.633308, label: 'São Paulo (referência)' };
  let lat = fallback.lat;
  let lon = fallback.lon;
  let locLabel = fallback.label;

  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 9000,
          maximumAge: 600000,
        });
      });
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
      const nome = await _dashReverseGeocodePt(lat, lon);
      locLabel = nome || 'Na tua localização (GPS)';
    } catch (_) {
      /* mantém referência SP */
    }
  }

  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation',
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    wind_speed_unit: 'kmh',
    timezone: 'America/Sao_Paulo',
    forecast_days: '8',
  });
  const url = `https://api.open-meteo.com/v1/forecast?${qs.toString()}`;

  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error('http');
    const j = await res.json();
    const cur = j.current;
    if (!cur || cur.temperature_2m == null) throw new Error('payload');

    const hourly = j.hourly || {};
    const slice = _dashSliceHourlyForecast(hourly);
    const rainProbNow =
      slice.rain.length && hourly.precipitation_probability
        ? Math.round(Number(slice.rain[0]))
        : 0;
    const precipMm = cur.precipitation != null ? Number(cur.precipitation) : 0;
    const chuvaTxt = precipMm > 0.02 ? `${precipMm.toFixed(1)} mm` : `${rainProbNow}% prob.`;

    const temp = Math.round(Number(cur.temperature_2m));
    const feels = cur.apparent_temperature != null ? Math.round(Number(cur.apparent_temperature)) : temp;
    const hum = cur.relative_humidity_2m != null ? Math.round(Number(cur.relative_humidity_2m)) : '—';
    const windKmh = cur.wind_speed_10m != null ? Math.round(Number(cur.wind_speed_10m)) : null;
    const windRose = _dashWindDirRose(cur.wind_direction_10m);
    const { icon, label } = _dashWeatherCodeInfo(cur.weather_code);

    const windLine =
      windKmh == null ? '—' : `${windKmh} km/h${windRose ? ` ${windRose}` : ''}`;

    const nowD = new Date();
    const nowLine = `${nowD.toLocaleDateString('pt-BR', { weekday: 'long' })}, ${nowD.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

    const dTimes = j.daily?.time || [];
    const dMax = j.daily?.temperature_2m_max || [];
    const dMin = j.daily?.temperature_2m_min || [];
    const dCode = j.daily?.weather_code || [];
    const daily = [];
    let daysHtml = '';
    const nDay = Math.min(8, dTimes.length);
    for (let i = 0; i < nDay; i++) {
      const dt = new Date(dTimes[i]);
      const wdShort = dt.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      const inf = _dashWeatherCodeInfo(dCode[i]);
      const tMx = Math.round(Number(dMax[i]));
      const tMn = Math.round(Number(dMin[i]));
      const dateLong = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
      daily.push({ dateLong, label: inf.label, tmax: tMx, tmin: tMn });
      const active = i === 0 ? ' is-active' : '';
      daysHtml += `<button type="button" class="dash-clima-day${active}" data-day-i="${i}">
        <span class="dash-clima-day-name">${wdShort}</span>
        <i class="fa-solid ${inf.icon} dash-clima-day-ic" aria-hidden="true"></i>
        <span class="dash-clima-day-temps">${tMx}° <span class="dash-clima-tmin">${tMn}°</span></span>
      </button>`;
    }

    const firstDayHint =
      daily.length > 0
        ? `${daily[0].dateLong} · ${daily[0].label} · máx ${daily[0].tmax}° · mín ${daily[0].tmin}°`
        : '';

    const payload = {
      hourly: slice,
      daily,
    };

    el.innerHTML = `
      <div class="dash-clima-widget">
        <div class="dash-clima-top">
          <div class="dash-clima-top-left">
            <div class="dash-clima-big-icon" aria-hidden="true"><i class="fa-solid ${icon}"></i></div>
            <div class="dash-clima-big-temp">${temp}°C</div>
            <div class="dash-clima-top-stats">
              <span>Chuva <strong>${chuvaTxt}</strong></span>
              <span>Umidade <strong>${hum}%</strong></span>
              <span>Vento <strong>${windLine}</strong></span>
            </div>
          </div>
          <div class="dash-clima-top-right">
            <div class="dash-clima-widget-title">Clima</div>
            <div class="dash-clima-nowline">${nowLine}</div>
            <div class="dash-clima-desc-lg">${label}</div>
            <div class="dash-clima-loc-sm"><i class="fa-solid fa-location-dot"></i> ${locLabel}</div>
          </div>
        </div>
        <div class="dash-clima-tabs" role="tablist">
          <button type="button" class="dash-clima-tab is-active" data-chart="temp">Temperatura</button>
          <button type="button" class="dash-clima-tab" data-chart="rain">Chuva</button>
          <button type="button" class="dash-clima-tab" data-chart="wind">Vento</button>
        </div>
        <div class="dash-clima-chart-wrap" data-clima-chart></div>
        <div class="dash-clima-day-hint" data-clima-day-hint">${_dashXmlEsc(firstDayHint)}</div>
        <div class="dash-clima-days">${daysHtml}</div>
      </div>`;

    _dashWeatherBindWidget(el.querySelector('.dash-clima-widget'), payload);
  } catch (_) {
    el.innerHTML = '<div class="dash-clima-empty">Não foi possível carregar o clima agora. Verifica a ligação à internet e tenta de novo mais tarde.</div>';
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

function renderDashProximoVencimento(abertasSettled) {
  const el = document.getElementById('dash-vencimento-banner');
  if (!el) return;

  if (!abertasSettled || abertasSettled.status !== 'fulfilled') {
    el.className = 'dash-vencimento-banner dash-vencimento-banner--soon';
    el.innerHTML = `
      <div class="dash-vencimento-inner">
        <div class="dash-vencimento-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="dash-vencimento-text">
          <div class="dash-vencimento-title">Faturas</div>
          <div class="dash-vencimento-sub">Não foi possível carregar o vencimento agora. Abre <strong>Minhas Faturas</strong> para veres os detalhes.</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm dash-vencimento-cta" onclick="navTo('faturas')">Ver faturas</button>
      </div>`;
    return;
  }

  const titulos = abertasSettled.value.titulos || [];
  if (!titulos.length) {
    el.className = 'dash-vencimento-banner dash-vencimento-banner--ok';
    el.innerHTML = `
      <div class="dash-vencimento-inner">
        <div class="dash-vencimento-icon"><i class="fa-solid fa-circle-check"></i></div>
        <div class="dash-vencimento-text">
          <div class="dash-vencimento-title">Sem faturas em aberto</div>
          <div class="dash-vencimento-sub">Estás em dia. Consulta o histórico em <strong>Minhas Faturas</strong> quando precisares.</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm dash-vencimento-cta" onclick="navTo('faturas')">Ver faturas</button>
      </div>`;
    return;
  }

  const sorted = [...titulos]
    .filter((t) => t && t.datavenc)
    .sort((a, b) => new Date(a.datavenc) - new Date(b.datavenc));
  const next = sorted[0];
  if (!next) {
    el.className = 'dash-vencimento-banner dash-vencimento-banner--ok';
    el.innerHTML = `
      <div class="dash-vencimento-inner">
        <div class="dash-vencimento-icon"><i class="fa-solid fa-receipt"></i></div>
        <div class="dash-vencimento-text">
          <div class="dash-vencimento-title">Faturas em aberto</div>
          <div class="dash-vencimento-sub">Abre <strong>Minhas Faturas</strong> para veres valores e datas.</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm dash-vencimento-cta" onclick="navTo('faturas')">Ver faturas</button>
      </div>`;
    return;
  }

  const days = _dashDaysUntilVenc(next.datavenc);
  const dataFmt = fmtData(next.datavenc);
  const tipo = fmt(next.tipo || 'Mensalidade');
  const valor = fmtMoeda(next.valor);

  let tone = 'soon';
  let title = 'Próximo vencimento';
  let sub = '';
  const tLabel = escHtml(tipo);

  if (days === null) {
    sub = `${tLabel} · ${valor} · vencimento: ${escHtml(dataFmt)}`;
  } else if (days < 0) {
    tone = 'danger';
    title = 'Fatura em atraso';
    sub = `${tLabel} · ${valor} · venceu em <strong>${escHtml(dataFmt)}</strong> — regulariza em Minhas Faturas.`;
  } else if (days === 0) {
    tone = 'urgent';
    title = 'Vence hoje';
    sub = `${tLabel} · <strong>${valor}</strong> · não deixes para depois.`;
  } else if (days === 1) {
    tone = 'urgent';
    title = 'Vence amanhã';
    sub = `${tLabel} · ${valor} · <strong>${escHtml(dataFmt)}</strong>.`;
  } else {
    sub = `${tLabel} · ${valor} · <strong>${escHtml(dataFmt)}</strong> · faltam <strong>${days} dias</strong>.`;
    if (days > 14) tone = 'ok';
    else if (days <= 7) tone = 'urgent';
  }

  el.className = `dash-vencimento-banner dash-vencimento-banner--${tone}`;
  el.innerHTML = `
    <div class="dash-vencimento-inner">
      <div class="dash-vencimento-icon"><i class="fa-solid fa-calendar-days"></i></div>
      <div class="dash-vencimento-text">
        <div class="dash-vencimento-title">${escHtml(title)}</div>
        <div class="dash-vencimento-sub">${sub}</div>
      </div>
      <button type="button" class="btn btn-primary btn-sm dash-vencimento-cta" onclick="navTo('faturas')">Pagar / detalhes</button>
    </div>`;
}

function renderDashAvisos(avisosSettled) {
  const wrap = document.getElementById('dash-avisos');
  if (!wrap) return;

  let list = [];
  if (avisosSettled && avisosSettled.status === 'fulfilled' && Array.isArray(avisosSettled.value.avisos)) {
    list = avisosSettled.value.avisos;
  }

  if (!list.length) {
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
    return;
  }

  wrap.classList.remove('hidden');
  wrap.innerHTML = list
    .map((a) => {
      const tipoClass = ['info', 'success', 'warning'].includes(a.tipo) ? a.tipo : 'info';
      const link =
        a.linkHref && a.linkText
          ? ` <a href="${escHtml(a.linkHref)}" target="_blank" rel="noopener noreferrer">${escHtml(a.linkText)}</a>`
          : '';
      return `<div class="dash-aviso dash-aviso--${tipoClass}">${escHtml(a.mensagem)}${link}</div>`;
    })
    .join('');
}

function watchFormatDate(d) {
  if (!d) return '';
  const parts = d.split(/[\s-T]/);
  if (parts.length >= 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
  return d;
}

function watchRenderTickets(list, statusInfo, pacotesMap) {
  pacotesMap = pacotesMap || {};
  const nome = (S.clienteData && (S.clienteData.nome_res || S.clienteData.nome)) || '';
  const plano = (S.clienteData && S.clienteData.plano) || (statusInfo && statusInfo.planoMk) || '';
  const login = (S.clienteData && S.clienteData.login) || '';

  if (!list || !list.length) {
    return `
      <div style="text-align:center;padding:32px 16px">
        <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,rgba(var(--lemon-rgb),.12),rgba(var(--lemon-rgb),.04));display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px">
          <i class="fa-solid fa-tv" style="font-size:1.6rem;color:var(--lemon)"></i>
        </div>
        <p style="font-size:1.05rem;font-weight:700;margin-bottom:6px">Nenhuma assinatura encontrada</p>
        <p style="font-size:.86rem;color:var(--text-muted);line-height:1.6;max-width:340px;margin:0 auto">
          ${nome ? '<strong>' + nome.split(' ')[0] + '</strong>, você' : 'Você'} ainda não possui um plano Watch TV ativo.
          Ative agora gratuitamente o Watch Free!
        </p>
        ${plano ? '<div style="margin-top:12px;display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:20px;background:rgba(var(--lemon-rgb),.08);font-size:.8rem;font-weight:600;color:var(--lemon-dark)"><i class="fa-solid fa-wifi" style="font-size:.7rem"></i> ' + plano + '</div>' : ''}
        <div style="margin-top:20px">
          <button onclick="watchAtivarFree()" id="btn-watch-free" style="display:inline-flex;align-items:center;gap:8px;padding:12px 32px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--lemon),var(--lemon-dark));color:#fff;font-size:.92rem;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 16px rgba(var(--lemon-rgb),.3);transition:all .2s">
            <i class="fa-solid fa-play"></i> Ativar Watch Free
          </button>
        </div>
      </div>`;
  }

  let html = '';

  if (nome || plano) {
    html += '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--glass-border)">';
    html += '<div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--lemon),var(--lemon-dark));display:flex;align-items:center;justify-content:center;flex-shrink:0">';
    const initials = nome ? nome.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase() : '?';
    html += '<span style="font-size:.9rem;font-weight:800;color:#fff">' + initials + '</span>';
    html += '</div><div>';
    if (nome) html += '<div style="font-weight:700;font-size:.95rem">' + nome + '</div>';
    if (plano) html += '<div style="font-size:.8rem;color:var(--text-muted);margin-top:2px"><i class="fa-solid fa-wifi" style="font-size:.65rem;margin-right:4px"></i>' + plano + '</div>';
    html += '</div></div>';
  }

  html += list.map(t => {
    const ativo = t.Status === true || t.Status === 'true' || t.status === true;
    const statusBadge = ativo
      ? '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 14px;border-radius:20px;font-size:.75rem;font-weight:700;background:rgba(22,163,74,.1);color:var(--green)"><i class="fa-solid fa-circle" style="font-size:.4rem"></i> Ativo</span>'
      : '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 14px;border-radius:20px;font-size:.75rem;font-weight:700;background:rgba(220,38,38,.1);color:var(--red)"><i class="fa-solid fa-circle" style="font-size:.4rem"></i> Inativo</span>';

    const ticket = t.Ticket || t.ticket || '';
    const email = t.EmailUsuario || t.Email || t.email || '';
    const phone = t.telefone || t.Phone || t.phone || t.Telefone || '';
    const pacoteId = t.Pacote || t.pPacote || '';
    const tipo = t.Type || t.type || '';
    const idInteg = t.IDIntegracaoAssinante || t.AssinanteIDIntegracao || t.pAssinanteIDIntegracao || '';
    const dataCriacao = t.DataCriacao || t.dataCriacao || '';
    const dataCriacaoUser = t.DataCriacaoUsuario || '';
    const emailEnviado = t.EmailEnviado;

    const fields = [];
    const pacoteNome = pacotesMap[String(pacoteId)] || '';
    if (pacoteId) fields.push({ icon: 'fa-box-open', label: 'Pacote', value: pacoteNome ? pacoteNome + ' <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">#' + pacoteId + '</span>' : String(pacoteId), color: 'var(--lemon-dark)' });
    if (tipo) fields.push({ icon: 'fa-tag', label: 'Tipo', value: tipo, color: '#6366f1' });
    if (ticket) fields.push({ icon: 'fa-ticket', label: 'Ticket', value: ticket, color: 'var(--blue,#1a5d77)' });
    if (email) fields.push({ icon: 'fa-envelope', label: 'E-mail', value: email, color: '#0891b2' });
    if (phone) {
      let phoneFormatted = phone;
      const digits = phone.replace(/\D/g, '');
      if (digits.length === 13) phoneFormatted = '+' + digits.slice(0,2) + ' (' + digits.slice(2,4) + ') ' + digits.slice(4,9) + '-' + digits.slice(9);
      else if (digits.length === 11) phoneFormatted = '(' + digits.slice(0,2) + ') ' + digits.slice(2,7) + '-' + digits.slice(7);
      fields.push({ icon: 'fa-phone', label: 'Telefone', value: phoneFormatted, color: 'var(--green)' });
    }
    if (idInteg) fields.push({ icon: 'fa-id-badge', label: 'ID Integração', value: idInteg, color: 'var(--orange,#ea580c)' });

    const rows = fields.map(f =>
      '<div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid rgba(15,18,28,.05)">' +
        '<div style="width:28px;height:28px;border-radius:7px;background:' + f.color + '12;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<i class="fa-solid ' + f.icon + '" style="font-size:.68rem;color:' + f.color + '"></i>' +
        '</div>' +
        '<span style="font-size:.78rem;color:var(--text-muted);min-width:95px">' + f.label + '</span>' +
        '<span style="font-size:.86rem;font-weight:600;word-break:break-all;margin-left:auto;text-align:right">' + f.value + '</span>' +
      '</div>'
    ).join('');

    const extraBadges = '';

    return '<div style="background:var(--glass);border:1px solid var(--glass-border);border-radius:16px;overflow:hidden;margin-bottom:14px">' +
      '<div style="background:linear-gradient(135deg,rgba(var(--lemon-rgb),.08),rgba(var(--lemon-rgb),.02));padding:18px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--glass-border)">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,rgba(var(--lemon-rgb),.2),rgba(var(--lemon-rgb),.08));display:flex;align-items:center;justify-content:center">' +
            '<i class="fa-solid fa-tv" style="font-size:.9rem;color:var(--lemon-dark)"></i>' +
          '</div>' +
          '<div>' +
            '<div style="font-weight:700;font-size:.95rem">Watch TV</div>' +
            (dataCriacaoUser ? '<div style="font-size:.72rem;color:var(--text-muted)">Desde ' + watchFormatDate(dataCriacaoUser) + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + extraBadges + statusBadge + '</div>' +
      '</div>' +
      '<div style="padding:4px 20px 8px">' + rows + '</div>' +
    '</div>';
  }).join('');

  return html;
}

async function watchAtivarFree() {
  const btn = document.getElementById('btn-watch-free');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div style="width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite"></div> Ativando…'; }
  try {
    const r = await request('POST', `${API}/watch/ativar-free`);
    if (r.jaAtivo) {
      showToast('Você já possui Watch Free ativo!', 'info');
    } else {
      watchShowEmailModal();
    }
    loadWatchBrasil();
  } catch (e) {
    showToast(e.message || 'Erro ao ativar Watch Free.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-play"></i> Ativar Watch Free'; }
  }
}

function watchShowEmailModal() {
  const email = (S.clienteData && S.clienteData.email) || '';
  const masked = email ? email.replace(/^(.{2})(.*)(@.*)$/, (m, a, b, c) => a + b.replace(/./g, '*') + c) : '';
  let overlay = document.getElementById('modal-watch-email');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-watch-email';
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.classList.add('hidden'); };
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px;text-align:center;padding:36px 28px">
        <button class="modal-close" onclick="document.getElementById('modal-watch-email').classList.add('hidden')">
          <i class="fa-solid fa-xmark"></i>
        </button>
        <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,rgba(22,163,74,.12),rgba(22,163,74,.04));display:inline-flex;align-items:center;justify-content:center;margin-bottom:18px">
          <i class="fa-solid fa-envelope-circle-check" style="font-size:1.6rem;color:var(--green)"></i>
        </div>
        <h3 style="font-size:1.1rem;font-weight:800;margin-bottom:8px">Watch Free Ativado!</h3>
        <p style="font-size:.9rem;color:var(--text-muted);line-height:1.6;margin-bottom:16px">
          Sua assinatura <strong>Watch Free</strong> foi ativada com sucesso!
          Um e-mail com seus dados de acesso será enviado para:
        </p>
        <div style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;background:rgba(var(--lemon-rgb),.08);font-size:.88rem;font-weight:600;color:var(--lemon-dark);margin-bottom:18px">
          <i class="fa-solid fa-envelope" style="font-size:.8rem"></i>
          <span id="watch-modal-email">${masked}</span>
        </div>
        <p style="font-size:.82rem;color:var(--text-muted);line-height:1.5;margin-bottom:22px">
          Verifique sua <strong>caixa de entrada</strong> e a pasta de <strong>spam</strong>.
          O e-mail contém seu login e senha para acessar o app Watch TV.
        </p>
        <button onclick="document.getElementById('modal-watch-email').classList.add('hidden')" style="display:inline-flex;align-items:center;gap:8px;padding:12px 36px;border:none;border-radius:10px;background:linear-gradient(135deg,var(--lemon),var(--lemon-dark));color:#fff;font-size:.9rem;font-weight:700;cursor:pointer;font-family:inherit">
          <i class="fa-solid fa-check"></i> Entendi
        </button>
      </div>`;
    document.body.appendChild(overlay);
  } else {
    const emailEl = overlay.querySelector('#watch-modal-email');
    if (emailEl) emailEl.textContent = masked;
  }
  overlay.classList.remove('hidden');
}

async function loadWatchBrasil() {
  const alertEl = document.getElementById('watch-brasil-alert');
  const bodyEl = document.getElementById('watch-brasil-body');
  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:24px;color:var(--text-muted)"><div style="width:18px;height:18px;border:2px solid var(--glass-border);border-top-color:var(--lemon);border-radius:50%;animation:spin .7s linear infinite"></div><span style="font-size:.88rem">Consultando Watch TV…</span></div>';
  try {
    const st = await request('GET', `${API}/watch/status`);
    if (!st.ok) {
      if (st.reason === 'disabled') {
        bodyEl.innerHTML = '<div style="text-align:center;padding:32px 16px"><i class="fa-solid fa-plug-circle-xmark" style="font-size:2rem;color:var(--text-muted);margin-bottom:12px;display:block"></i><p style="font-size:.92rem;font-weight:600;margin-bottom:6px">Integração indisponível</p><p style="font-size:.85rem;color:var(--text-muted)">A integração com Watch TV está temporariamente desativada.</p></div>';
      } else if (!st.hasToken) {
        bodyEl.innerHTML = '<div style="text-align:center;padding:32px 16px"><i class="fa-solid fa-key" style="font-size:2rem;color:var(--text-muted);margin-bottom:12px;display:block"></i><p style="font-size:.92rem;font-weight:600;margin-bottom:6px">Configuração pendente</p><p style="font-size:.85rem;color:var(--text-muted);line-height:1.5">A integração com Watch TV está sendo configurada.<br>Tente novamente em alguns minutos.</p></div>';
      } else {
        bodyEl.innerHTML = '<div style="text-align:center;padding:32px 16px"><i class="fa-solid fa-circle-exclamation" style="font-size:2rem;color:var(--text-muted);margin-bottom:12px;display:block"></i><p style="font-size:.92rem;font-weight:600;margin-bottom:6px">Configuração incompleta</p><p style="font-size:.85rem;color:var(--text-muted);line-height:1.5">Entre em contato com o suporte Lemon para vincular seu plano Watch TV.</p></div>';
      }
      return;
    }
    const r = await request('GET', `${API}/watch/ticket`);
    const payload = r.data !== undefined ? r.data : r;
    const pMap = r.pacotesMap || payload.pacotesMap || {};
    const result = payload.Result || payload.result || payload;
    const list = Array.isArray(result) ? result : (result && result.list ? result.list : (Array.isArray(payload) ? payload : []));
    bodyEl.innerHTML = watchRenderTickets(list, st, pMap);
  } catch (e) {
    const msg = e.message || 'Erro ao consultar Watch.';
    if (alertEl) { alertEl.textContent = msg; alertEl.classList.remove('hidden'); }
    bodyEl.innerHTML = '<div style="text-align:center;padding:24px 16px"><i class="fa-solid fa-triangle-exclamation" style="font-size:1.6rem;color:var(--red);margin-bottom:10px;display:block"></i><p style="font-size:.88rem;color:var(--text-muted)">Não foi possível obter os dados da Watch TV neste momento.</p></div>';
  }
}

async function loadDashboard() {
  let rAbertas = null;
  let rAvisos = null;
  try {
    const [me, abertas, clube, avisos] = await Promise.allSettled([
      request('GET', `${API}/me`),
      request('GET', `${API}/faturas/abertas`),
      request('GET', `${API}/clube/stats`),
      request('GET', `${API}/avisos`),
    ]);
    rAbertas = abertas;
    rAvisos = avisos;

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
      const statusTxt = document.getElementById('dash-status');
      const statusDot = document.getElementById('dash-status-dot');
      try {
        const wst = await request('GET', `${API}/watch/status`);
        if (wst.ok && wst.hasToken) {
          const wr = await request('GET', `${API}/watch/ticket`);
          const wp = wr.data !== undefined ? wr.data : wr;
          const wResult = wp.Result || wp.result || wp;
          const wList = Array.isArray(wResult) ? wResult : (wResult && wResult.list ? wResult.list : []);
          const hasActive = wList.some(t => t.Status === true || t.Status === 'true');
          if (statusTxt) statusTxt.textContent = hasActive ? 'Watch Ativo' : 'Sem Watch';
          if (statusDot) { statusDot.classList.toggle('online', hasActive); statusDot.classList.toggle('offline', !hasActive); }
        } else {
          if (statusTxt) statusTxt.textContent = 'Sem Watch';
          if (statusDot) { statusDot.classList.remove('online'); statusDot.classList.add('offline'); }
        }
      } catch {
        if (statusTxt) statusTxt.textContent = 'Sem Watch';
        if (statusDot) { statusDot.classList.remove('online'); statusDot.classList.add('offline'); }
      }

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
    renderDashProximoVencimento(rAbertas);
    renderDashAvisos(rAvisos);
    await loadDashHeadlinesFromRss();
    await loadDashWeatherOpenMeteo();
    await loadDashCotacao();
    await loadDashFeriados();
  }
}

// ===== FATURAS =====



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

/** Valor cobrado no Mercado Pago (com desconto Lemon Club no título alvo, se houver). */
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

/** Pílula de prazo na lista (aberta / vencida / paga). */
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

/** Mês/ano anterior ao vencimento (heurística comum em mensalidades). */
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
  const c = typeof S.clienteData !== 'undefined' ? S.clienteData : null;
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

/** Velocidade de download do plano (Mbps) via /portal/me — plano_download_mbps. */
function faturaListaVelocidadePlanoHtml() {
  const c = typeof S.clienteData !== 'undefined' ? S.clienteData : null;
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

/** Uma linha para o modal de fatura (mesma lógica do perfil). */
function clienteEnderecoResumo(c) {
  if (!c || typeof c !== 'object') return '';
  const linha1 = [c.endereco, c.numero, c.complemento].filter(Boolean).map((x) => String(x).trim()).filter(Boolean).join(', ');
  const linha2 = [c.bairro, c.cep].filter(Boolean).map((x) => String(x).trim()).filter(Boolean).join(' — ');
  return [linha1, linha2].filter(Boolean).join(' · ');
}

function faturaModalVelocidadeBlockHtml() {
  const c = typeof S.clienteData !== 'undefined' ? S.clienteData : null;
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
        <button type="button" id="btn-mp-sub" class="btn btn-mp-fatura-cartao"
          onclick="void abrirFormAssinaturaMP('${uuid}', ${valorMpCobrar}, '${escDesc}')">
          <i class="fa-solid fa-credit-card"></i>
          Pagar fatura no cartão
        </button>
        <p class="mp-fatura-cartao-hint">Cobrança imediata do valor da fatura no cartão. Os dados são tokenizados pelo Mercado Pago no navegador. A baixa ocorre quando o pagamento for aprovado.</p>
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


initOnboardingFormListeners();

app.navTo = navTo;
app.refreshFaturas = loadFaturas;

/** Handlers globais para onclick="" no index.html */
const portalGlobalHandlers = {
  ...onboardingWindowAPI,
  navTo,
  loadNotificacoes: notif.loadNotificacoes,
  setPushNotifPref: notif.setPushNotifPref,
  ativarPushNesteDispositivo: notif.ativarPushNesteDispositivo,
  desativarPushNesteDispositivo: notif.desativarPushNesteDispositivo,
  fecharModalInstalarApp: club.fecharModalInstalarApp,
  toggleSidebar,
  closeSidebarMobile,
  togglePass,
  logout,
  switchTab,
  abrirFatura,
  loadChamados,
  abrirChamado,
  toggleCarteiraAddForm,
  confirmarCarteiraAdd,
  removerCartaoCarteira,
  closeModal,
  closeModalDirect,
  copiar,
  watchAtivarFree,
};
Object.assign(window, portalGlobalHandlers);

(async () => {
  try {
    const sess = await request('GET', `${API}/session`);
    if (sess.logado) {
      document.getElementById('topbar-nome').textContent = sess.nome || '';
      document.getElementById('page-landing').classList.remove('active');
      document.getElementById('page-landing').classList.add('hidden');
      document.getElementById('page-portal').classList.remove('hidden');
      navTo('dashboard');
      const open = new URLSearchParams(window.location.search).get('open');
      if (open === 'faturas') navTo('faturas');
      else if (open === 'notificacoes') navTo('notificacoes');
    }
  } catch (_) {}
})();
