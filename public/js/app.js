/**
 * Fonte do bundle do portal do cliente.
 * Após alterar este ficheiro, regenere o script servido ao navegador:
 *   npm run build:portal
 * O browser carrega /js/portal-app.js (ES modules em public/js/modules/), não este ficheiro.
 */

const API = '/portal';
/** Portal: secção Watch TV (espelhar `FEATURE_WATCH_TV` em `modules/constants.js` ao usar build:portal). */
const FEATURE_WATCH_TV = false;
/** Pagamento único fatura no cartão (MP Payments). */
const MP_API_FATURA_CARTAO = `${API}/pagamento/fatura/cartao`;
const _MP_SUB_FIELD_STYLE =
  'width:100%;min-width:0;box-sizing:border-box;margin:0;padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem;font-family:inherit;line-height:1.3;-webkit-appearance:none;appearance:none';
const _MP_SUB_EXPIRY_ROW_STYLE =
  'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr) minmax(0,1fr);gap:8px;margin-bottom:8px;width:100%;min-width:0;box-sizing:border-box;align-items:stretch';
let clienteData = null;

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

function fmt(str) {
  if (!str) return '--';
  return String(str);
}

function fmtData(str) {
  if (!str) return '--';
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString('pt-BR');
}

function fmtMoeda(val) {
  if (!val) return 'R$ 0,00';
  const n = parseFloat(val);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function showLoading() { document.getElementById('overlay-loading').classList.remove('hidden'); }
function hideLoading() { document.getElementById('overlay-loading').classList.add('hidden'); }

function showAlert(elId, msg, type = 'error') {
  const el = document.getElementById(elId);
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

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
  if (view !== 'conexao' && _connInterval) {
    clearInterval(_connInterval);
    _connInterval = null;
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
    // Prompt push: 4s após login se ainda não ativou
    setTimeout(() => _verificarEPedirPush(), 4000);
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
  if (typeof _connInterval !== 'undefined' && _connInterval) {
    clearInterval(_connInterval);
    _connInterval = null;
  }

  try { await request('POST', `${API}/logout`); } catch (_) {}

  // Reseta estado em memória
  clienteData = null;
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

function _dashMergeTitulosPortal(abertasS, vencidasS) {
  const merged = [];
  const seen = new Set();
  const pushList = (list) => {
    for (const t of list || []) {
      if (!t || typeof t !== 'object') continue;
      const id = String(t.uuid ?? t.id ?? '').trim();
      const key = id || `${t.datavenc}|${t.valor}|${t.tipo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
  };
  if (abertasS?.status === 'fulfilled') pushList(abertasS.value?.titulos);
  if (vencidasS?.status === 'fulfilled') pushList(vencidasS.value?.titulos);
  const fetchOk = abertasS?.status === 'fulfilled' || vencidasS?.status === 'fulfilled';
  return { titulos: merged, fetchOk };
}

function _dashBannerSettledMerged(abertasS, vencidasS) {
  const { titulos, fetchOk } = _dashMergeTitulosPortal(abertasS, vencidasS);
  if (!fetchOk) return abertasS?.status !== 'fulfilled' ? abertasS : vencidasS;
  return { status: 'fulfilled', value: { titulos } };
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
          <div class="dash-vencimento-title">Sem faturas pendentes</div>
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
          <div class="dash-vencimento-title">Faturas pendentes</div>
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
  const nome = (clienteData && (clienteData.nome_res || clienteData.nome)) || '';
  const plano = (clienteData && clienteData.plano) || (statusInfo && statusInfo.planoMk) || '';
  const login = (clienteData && clienteData.login) || '';

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
  const email = (clienteData && clienteData.email) || '';
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
  let rVencidas = null;
  let rAvisos = null;
  try {
    const [me, abertas, vencidas, clube, avisos] = await Promise.allSettled([
      request('GET', `${API}/me`),
      request('GET', `${API}/faturas/abertas`),
      request('GET', `${API}/faturas/vencidas`),
      request('GET', `${API}/clube/stats`),
      request('GET', `${API}/avisos`),
    ]);
    rAbertas = abertas;
    rVencidas = vencidas;
    rAvisos = avisos;

    if (me.status === 'fulfilled') {
      clienteData = me.value;
      const primeiroNome = (clienteData.nome_res || clienteData.nome || '').split(' ')[0];

      // Hero
      document.getElementById('dash-nome').textContent = primeiroNome;
      document.getElementById('topbar-nome').textContent = primeiroNome;

      // Avatar no topbar
      const initials = (clienteData.nome || '?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
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
      document.getElementById('dash-plano').textContent = clienteData.plano || '--';
      document.getElementById('dash-venc').textContent  = clienteData.venc ? `Dia ${clienteData.venc}` : '--';
    }

    const { titulos: titulosPendentes, fetchOk: fatFetchOk } = _dashMergeTitulosPortal(abertas, vencidas);
    if (fatFetchOk) {
      const count = titulosPendentes.length;
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
    renderDashProximoVencimento(_dashBannerSettledMerged(rAbertas, rVencidas));
    renderDashAvisos(rAvisos);
    await loadDashHeadlinesFromRss();
    await loadDashWeatherOpenMeteo();
    await loadDashCotacao();
    await loadDashFeriados();
  }
}

// ===== FATURAS =====

let faturasCarregadas = { abertas: false, vencidas: false, pagas: false };

async function _ensureClienteProfile() {
  if (clienteData) return;
  try {
    clienteData = await request('GET', `${API}/me`);
  } catch (_) {}
}

async function loadFaturas() {
  if (!faturasCarregadas.abertas) {
    loadFaturasAbertas();
  }
}

async function loadFaturasAbertas() {
  faturasCarregadas.abertas = true;
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
  if (faturasCarregadas.vencidas) return;
  faturasCarregadas.vencidas = true;
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
  if (faturasCarregadas.pagas) return;
  faturasCarregadas.pagas = true;
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

/** Lê montante repetido entre raiz, dados, data (MK pode aninhar). */
function _faturaMkMonetaryMax(t, campo) {
  const d = typeof t?.data === 'object' && t.data ? t.data : null;
  const vals = [
    _faturaNum(t?.[campo]),
    _faturaNum(t?.dados?.[campo]),
    _faturaNum(t?.titulo?.[campo]),
    _faturaNum(t?.titulo?.dados?.[campo]),
    d != null ? _faturaNum(d[campo]) : NaN,
    d?.dados != null ? _faturaNum(d.dados[campo]) : NaN,
  ].filter((n) => Number.isFinite(n));
  return vals.length ? Math.max(...vals) : 0;
}

/** Principal do título quando a raiz vem zerada ou em data.titulo. */
function _faturaMkPrincipal(t) {
  const d = typeof t?.data === 'object' && t.data ? t.data : null;
  let primeiroPos = NaN;
  let ultimo = NaN;
  for (const raw of [
    t?.valor,
    t?.dados?.valor,
    d?.valor,
    d?.dados?.valor,
    t?.titulo?.valor,
    t?.titulo?.dados?.valor,
  ]) {
    const n = _faturaNum(raw);
    if (!Number.isFinite(n)) continue;
    ultimo = n;
    if (n > 0.004 && !Number.isFinite(primeiroPos)) primeiroPos = n;
  }
  return Number.isFinite(primeiroPos) ? primeiroPos : ultimo;
}

/** Subtotal aberto antes do Lemon Club (= soma física igual ao servidor). */
function _faturaSubtotalAbertoSemCupomLista(t) {
  const p = _faturaMkPrincipal(t);
  const m = _faturaMkMonetaryMax(t, 'valormulta');
  const mo = _faturaMkMonetaryMax(t, 'valormora');
  const d = _faturaMkMonetaryMax(t, 'valordesc');
  return Math.round((p + m + mo - d) * 100) / 100;
}

/** Cupom Lemon: subtotal físico ± %; corrige valores da API quando soma não fecha. */
function faturaLemonCupomReconciliado(t, isPago) {
  if (
    isPago ||
    !t?.lemon_clube_desconto_resgatado ||
    t.lemon_clube_cupom_outra_fatura
  ) {
    return null;
  }
  const pct = Number(t.lemon_clube_desconto_percent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  const subAntesCupom = _faturaSubtotalAbertoSemCupomLista(t);
  if (!Number.isFinite(subAntesCupom) || subAntesCupom <= 0) return null;
  const descCalc = Math.round((subAntesCupom * pct) / 100 * 100) / 100;
  const pagarCalc = Math.max(0, Math.round((subAntesCupom - descCalc) * 100) / 100);
  const apiPag = Number(t.lemon_clube_valor_a_pagar);
  const apiDesc = Number(t.lemon_clube_valor_desconto);
  const apiFecha =
    Number.isFinite(apiPag) &&
    Number.isFinite(apiDesc) &&
    Math.abs(apiPag + apiDesc - subAntesCupom) <= 0.071;
  if (apiFecha) {
    return { subAntesCupom, valorDesconto: apiDesc, valorAPagar: apiPag };
  }
  return { subAntesCupom, valorDesconto: descCalc, valorAPagar: pagarCalc };
}

/** Valor cobrado no Mercado Pago (com desconto Lemon Club no título alvo, se houver). */
function faturaValorMercadoPago(t, isPago) {
  if (isPago) {
    const v0 = parseFloat(t?.valor);
    return Number.isFinite(v0) ? v0 : _faturaMkPrincipal(t);
  }
  if (!t?.lemon_clube_desconto_resgatado) return _faturaMkPrincipal(t);
  const lr = faturaLemonCupomReconciliado(t, isPago);
  if (lr != null) return lr.valorAPagar;
  const v = Number(t.lemon_clube_valor_a_pagar);
  const desc = Number(t.lemon_clube_valor_desconto);
  const cupomNoSubtotal = !!t.lemon_clube_cupom_sobre_subtotal;
  if (Number.isFinite(v) && cupomNoSubtotal) return v;
  if (Number.isFinite(v) && Number.isFinite(desc) && desc > 0.004) return v;
  return _faturaMkPrincipal(t);
}

/** Total a pagar no portal: com cupom já reflete multa/juros; sem cupom = principal + encargos − desconto MK. */
function faturaValorTotalCobrancaPortal(t, isPago) {
  if (isPago) {
    const vp = _faturaNum(t.valorpag);
    if (vp > 0.004) return Math.round(vp * 100) / 100;
    return Math.round((_faturaMkPrincipal(t) || _faturaNum(t.valor)) * 100) / 100;
  }
  const lr = faturaLemonCupomReconciliado(t, false);
  if (lr != null) return Math.round(lr.valorAPagar * 100) / 100;
  const base = _faturaMkPrincipal(t);
  const multa = _faturaMkMonetaryMax(t, 'valormulta');
  const mora = _faturaMkMonetaryMax(t, 'valormora');
  const desc = _faturaMkMonetaryMax(t, 'valordesc');
  return Math.round((base + multa + mora - desc) * 100) / 100;
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
  const c = typeof clienteData !== 'undefined' ? clienteData : null;
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
  const c = typeof clienteData !== 'undefined' ? clienteData : null;
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
  const extraFusion = _faturaMkMonetaryMax(t, 'valormulta') + _faturaMkMonetaryMax(t, 'valormora');
  const descMkFusion = _faturaMkMonetaryMax(t, 'valordesc');
  const principalFusion = _faturaMkPrincipal(t);
  const isPago = tipo === 'paga';
  const totalPagar = faturaValorTotalCobrancaPortal(t, isPago);
  const pct = t.lemon_clube_desconto_percent != null ? Number(t.lemon_clube_desconto_percent) : null;
  const temCupom =
    tipo !== 'paga' &&
    t.lemon_clube_desconto_resgatado &&
    (t.lemon_clube_cupom_sobre_subtotal ||
      (Number.isFinite(Number(t.lemon_clube_valor_desconto)) && Number(t.lemon_clube_valor_desconto) > 0.004));

  let html = '';
  if (temCupom) {
    const lrOpen = faturaLemonCupomReconciliado(t, false);
    const subAntesCupom = lrOpen ? lrOpen.subAntesCupom : _faturaSubtotalAbertoSemCupomLista(t);
    const econ = lrOpen ? lrOpen.valorDesconto : Math.max(0, Math.round((subAntesCupom - totalPagar) * 100) / 100);
    const pctTxt = pct != null && Number.isFinite(pct) ? `${pct}%` : '';
    const microParts = [`principal ${fmtMoeda(principalFusion)}`];
    if (extraFusion > 0.004) microParts.push(`multa/juros ${fmtMoeda(extraFusion)}`);
    if (descMkFusion > 0.004) microParts.push(`descontos MK −${fmtMoeda(descMkFusion)}`);

    html += `<div class="fatura-valor-cupom-wrap">`;
    html += `<div class="fatura-valor-cupom-kicker"><i class="fa-solid fa-lemon" aria-hidden="true"></i> Cupom Lemon Club${pctTxt ? ` ${pctTxt}` : ''}</div>`;
    html += `<div class="fatura-valor fatura-valor--cupom">${fmtMoeda(totalPagar)}</div>`;
    html += `<div class="fatura-valor-cupom-legend">Valor final no portal (PIX / cartão)</div>`;
    html += `<div class="fatura-valor-cupom-break">`;
    html += `<div class="fatura-valor-cupom-micro">${microParts.join(' · ')}</div>`;
    html += `<div class="fatura-valor-cupom-line"><span class="fatura-valor-cupom-label">Subtotal antes do cupom</span><span class="fatura-valor-cupom-num">${fmtMoeda(subAntesCupom)}</span></div>`;
    if (econ > 0.009) {
      html += `<div class="fatura-valor-cupom-line fatura-valor-cupom-line--save"><span class="fatura-valor-cupom-label">Desconto Lemon Club${pctTxt ? ` (${pctTxt.trim()})` : ''}</span><span class="fatura-valor-cupom-save">− ${fmtMoeda(econ)}</span></div>`;
    }
    html += `</div></div>`;
  } else {
    html += `<div class="fatura-valor">${fmtMoeda(totalPagar)}</div>`;
  }
  if (tipo !== 'paga' && extraFusion > 0.004 && !temCupom) {
    const bits = [`multa/juros ${fmtMoeda(extraFusion)}`];
    if (descMkFusion > 0.004) bits.push(`descontos MK −${fmtMoeda(descMkFusion)}`);
    html += `<div class="fatura-valor-extra"><span style="opacity:.92">Encargos e ajustes:</span> ${bits.join(' · ')}</div>`;
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
  const comCupomLemon =
    tipo !== 'paga' &&
    t.lemon_clube_desconto_resgatado &&
    (t.lemon_clube_cupom_sobre_subtotal ||
      (Number.isFinite(Number(t.lemon_clube_valor_desconto)) && Number(t.lemon_clube_valor_desconto) > 0.004));
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

function faturaModalVelocidadeBlockHtml() {
  const c = typeof clienteData !== 'undefined' ? clienteData : null;
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
  const totalPortalPagar = faturaValorTotalCobrancaPortal(t, isPago);
  const lr = faturaLemonCupomReconciliado(t, isPago);
  const valorMpBase = faturaValorMercadoPago(t, isPago);
  const lemonPct = t.lemon_clube_desconto_percent != null ? Number(t.lemon_clube_desconto_percent) : null;
  const lemonDesc =
    lr != null
      ? lr.valorDesconto
      : t.lemon_clube_valor_desconto != null
        ? Number(t.lemon_clube_valor_desconto)
        : null;
  const lemonLabel = t.lemon_clube_desconto_label ? String(t.lemon_clube_desconto_label) : '';

  const principalMk = _faturaMkPrincipal(t);
  const multaMk = _faturaMkMonetaryMax(t, 'valormulta');
  const moraMk = _faturaMkMonetaryMax(t, 'valormora');
  const descMk = _faturaMkMonetaryMax(t, 'valordesc');
  const totalMkAberto =
    !isPago ? Math.round(_faturaSubtotalAbertoSemCupomLista(t) * 100) / 100 : NaN;
  const totalMkHeroMostrar =
    !isPago &&
    Number.isFinite(totalMkAberto) &&
    totalMkAberto > 0.004 &&
    !(lr != null && lemonPct != null && lemonPct > 0);

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
      <div class="fatura-modal-valor">${fmtMoeda(totalPortalPagar)}</div>
      ${
        totalMkHeroMostrar
          ? `<div class="fatura-modal-subtipo" style="font-size:.76rem;opacity:.88;margin-top:4px">Total no MK-Auth (sistema / boleto): <strong>${fmtMoeda(totalMkAberto)}</strong></div>`
          : ''
      }
      ${
        !isPago && lr != null && lemonPct != null && lemonPct > 0
          ? `<div class="fatura-modal-subtipo" style="font-size:.78rem;opacity:.85">Subtotal antes do Lemon Club ${fmtMoeda(lr.subAntesCupom)} · cupom ${lemonPct}% (sobre multa/juros e principal)</div>`
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
    if (!isPago && valorMpBase != null && Number.isFinite(valorMpBase)) {
      html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-sack-dollar"></i> A pagar (portal)</span><span class="modal-detail-val" style="font-weight:700;color:#65a30d">${fmtMoeda(totalPortalPagar)}</span></div>`;
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

  if (principalMk > 0.004) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-coins"></i> Valor principal (MK)</span><span class="modal-detail-val">${fmtMoeda(principalMk)}</span></div>`;
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

  // Desconto / multa / juros — lê também em dados aninhados do MK
  if (descMk > 0.004) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-percent"></i> Desconto (MK)</span><span class="modal-detail-val" style="color:#4ade80">− ${fmtMoeda(descMk)}</span></div>`;
  }

  if (multaMk > 0.004) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-triangle-exclamation"></i> Multa</span><span class="modal-detail-val" style="color:#ef4444">+ ${fmtMoeda(multaMk)}</span></div>`;
  }
  if (moraMk > 0.004) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-clock"></i> Juros mora</span><span class="modal-detail-val" style="color:#ef4444">+ ${fmtMoeda(moraMk)}</span></div>`;
  }

  if (!isPago) {
    const vm = multaMk;
    const vj = moraMk;
    const vd = descMk;
    const totCupom = faturaValorTotalCobrancaPortal(t, false);
    if (vm > 0.004 || vj > 0.004 || vd > 0.004 || t.lemon_clube_desconto_resgatado) {
      html += `<div class="modal-detail-row" style="border-top:1px dashed var(--glass-border);margin-top:6px;padding-top:10px"><span class="modal-detail-label" style="font-weight:700"><i class="fa-solid fa-sack-dollar"></i> Total estimado</span><span class="modal-detail-val" style="font-weight:800;color:var(--lemon-dark)">${fmtMoeda(totCupom)}</span></div>`;
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
          onclick="void pagarPixFaturaComValorAtualizado('${uuid}', '${escDesc}')">
          <img src="https://http2.mlstatic.com/frontend-assets/ui-navigation/5.19.1/mercadopago/logo__large@2x.png" alt="Mercado Pago" style="height:22px;width:auto;object-fit:contain;display:block" loading="lazy">
          Pagar via PIX
        </button>
        <button type="button" id="btn-mp-sub" class="btn btn-mp-fatura-cartao"
          onclick="void abrirCartaoFaturaComValorAtualizado('${uuid}', '${escDesc}')">
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

// ===== MERCADO PAGO (PIX + cartão) =====

const _mpLogoImg = '<img src="https://http2.mlstatic.com/frontend-assets/ui-navigation/5.19.1/mercadopago/logo__large@2x.png" alt="MP" style="height:22px;width:auto;object-fit:contain;display:block" loading="lazy">';

let _mpPollingInterval = null;

async function gerarPixMP(tituloUuid, valor, descricao) {
  const btn  = document.getElementById('btn-mp-pix');
  const sub  = document.getElementById('btn-mp-sub');
  const area = document.getElementById('mp-pix-content');
  if (!btn || !area) return;

  btn.disabled = true;
  if (sub) sub.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;margin:0"></div> Gerando PIX...';
  area.innerHTML = '';

  try {
    const res = await request('POST', `${API}/pagamento/pix`, { tituloUuid, valor, descricao });

    // Cancela polling anterior se existir
    if (_mpPollingInterval) clearInterval(_mpPollingInterval);

    const expira = res.expira ? new Date(res.expira) : null;

    area.innerHTML = `
      <div style="background:linear-gradient(135deg,rgba(0,158,227,.1),rgba(0,122,184,.05));border:1px solid rgba(0,158,227,.28);border-radius:14px;padding:20px;text-align:center">
        <div style="font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:12px">
          <i class="fa-solid fa-circle-check" style="color:#009ee3;margin-right:4px"></i>PIX gerado com sucesso
        </div>

        <!-- QR Code -->
        ${res.qrBase64 ? `
          <div style="background:#fff;border-radius:12px;padding:12px;display:inline-block;margin-bottom:14px;box-shadow:0 2px 12px rgba(15,22,40,.08)">
            <img src="data:image/png;base64,${res.qrBase64}" alt="QR Code PIX" style="width:200px;height:200px;display:block" />
          </div>` : ''}

        <!-- Valor -->
        <div style="font-size:1.3rem;font-weight:800;color:#0077b6;margin-bottom:4px">
          R$ ${parseFloat(valor).toLocaleString('pt-BR', {minimumFractionDigits:2})}
        </div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:16px">
          ${expira ? `Expira em: ${expira.toLocaleString('pt-BR')}` : 'PIX válido por 10 minutos'}
        </div>

        <!-- Copia e Cola -->
        <textarea readonly onclick="this.select();this.setSelectionRange(0,this.value.length)" style="width:100%;background:#fff;border:1px solid var(--glass-border);border-radius:8px;padding:10px 12px;font-size:.72rem;font-family:monospace;color:var(--text);word-break:break-all;text-align:left;margin-bottom:10px;height:72px;resize:none;cursor:pointer" id="mp-pix-code">${res.qrCode || ''}</textarea>
        <button class="copy-btn" style="width:100%;justify-content:center;margin-bottom:12px"
          onclick="copiar('${(res.qrCode||'').replace(/'/g,"\\'")}', this)">
          <i class="fa-solid fa-copy"></i> Copiar PIX Copia e Cola
        </button>

        <!-- Status polling -->
        <div id="mp-status-badge" style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;font-size:.78rem;font-weight:600;background:rgba(251,191,36,.12);color:#b45309;border:1px solid rgba(251,191,36,.35)">
          <div class="spinner" style="width:10px;height:10px;border-width:1.5px;border-color:rgba(251,191,36,.3);border-top-color:#d97706"></div>
          Aguardando pagamento...
        </div>
        <div style="font-size:.68rem;color:var(--text-muted);margin-top:8px">Verificando automaticamente a cada 5 segundos</div>
      </div>
    `;

    // Poll de status a cada 5s
    const mpId = res.mpId;
    let tentativas = 0;
    _mpPollingInterval = setInterval(async () => {
      tentativas++;
      if (tentativas > 72) { clearInterval(_mpPollingInterval); return; } // max 6 min
      try {
        const st = await request('GET', `${API}/pagamento/status/${mpId}`);
        const badge = document.getElementById('mp-status-badge');
        if (!badge) { clearInterval(_mpPollingInterval); return; }

        if (st.status === 'approved') {
          clearInterval(_mpPollingInterval);
          badge.style.background = 'rgba(74,222,128,.15)';
          badge.style.color      = '#166534';
          badge.style.border     = '1px solid rgba(74,222,128,.35)';
          badge.innerHTML        = '<i class="fa-solid fa-circle-check"></i> Pagamento confirmado! Dando baixa...';

          // Garante baixa no MK-Auth mesmo sem webhook (rede local sem URL pública)
          try {
            await request('POST', `${API}/pagamento/baixa`, {
              mpId,
              tituloUuid: st.external_reference,
              valor:      st.valor,
            });
          } catch {}

          badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Pagamento confirmado! ✓';
          setTimeout(() => {
            closeModalDirect();
            if (typeof loadFaturas === 'function') loadFaturas();
          }, 2000);
        } else if (st.status === 'rejected' || st.status === 'cancelled') {
          clearInterval(_mpPollingInterval);
          badge.style.background = 'rgba(239,68,68,.12)';
          badge.style.color      = '#ef4444';
          badge.style.border     = '1px solid rgba(239,68,68,.25)';
          badge.innerHTML        = '<i class="fa-solid fa-circle-xmark"></i> Pagamento recusado';
        }
      } catch {}
    }, 5000);

    btn.style.display = 'none';
    if (sub) sub.style.display = 'none';
  } catch (e) {
    area.innerHTML = `<div style="color:#ef4444;font-size:.83rem;padding:10px;background:rgba(239,68,68,.08);border-radius:8px;border:1px solid rgba(239,68,68,.2)"><i class="fa-solid fa-circle-xmark"></i> ${e.message}</div>`;
    btn.disabled = false;
    btn.innerHTML = `${_mpLogoImg} Pagar via PIX`;
    if (sub) { sub.disabled = false; }
  }
}

let _mpSubCtx = null;

function _loadMercadoPagoSdk() {
  return new Promise((resolve, reject) => {
    if (window.MercadoPago) return resolve();
    const s = document.createElement('script');
    s.src = 'https://sdk.mercadopago.com/js/v2';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar SDK do Mercado Pago'));
    document.head.appendChild(s);
  });
}

/** Gera card_token_id no browser (PCI: número/CVV vão direto ao MP). */
async function _mpCriarCardToken(publicKey, dados) {
  await _loadMercadoPagoSdk();
  const MP = window.MercadoPago;
  if (!MP) throw new Error('MercadoPago SDK indisponível');
  const mp = new MP(publicKey, { locale: 'pt-BR' });
  const num = (dados.numero || '').replace(/\D/g, '');
  const cpf = (dados.cpf || '').replace(/\D/g, '');
  const mes = String(dados.mes || '').replace(/\D/g, '').padStart(2, '0');
  let ano = String(dados.ano || '').replace(/\D/g, '');
  if (ano.length === 2) ano = '20' + ano;
  const body = {
    cardNumber: num,
    cardholderName: (dados.nome || '').trim(),
    cardExpirationMonth: mes,
    cardExpirationYear: ano,
    securityCode: String(dados.cvv || '').replace(/\D/g, ''),
    identificationType: 'CPF',
    identificationNumber: cpf,
  };
  let out;
  try {
    if (typeof mp.createCardToken === 'function') {
      out = await mp.createCardToken(body);
    } else if (mp.fields && typeof mp.fields.createCardToken === 'function') {
      out = await mp.fields.createCardToken(body);
    }
  } catch (e1) {
    out = null;
  }
  let id = out && (out.id || out.token);
  if (id) return id;

  const anoN = parseInt(body.cardExpirationYear, 10);
  const mesN = parseInt(body.cardExpirationMonth, 10);
  const r = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(publicKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      card_number: body.cardNumber,
      security_code: body.securityCode,
      expiration_month: mesN,
      expiration_year: anoN,
      cardholder: {
        name: body.cardholderName,
        identification: { type: 'CPF', number: body.identificationNumber },
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || j.cause || 'Não foi possível tokenizar o cartão');
  if (!j.id) throw new Error('Resposta sem token do Mercado Pago');
  return j.id;
}

/** Aviso sandbox vs produção + chaves MP alinhadas (carteira e pagamento na fatura). */
function _mpPagamentoAvisoHtml(cfg) {
  if (!cfg || typeof cfg !== 'object') return '';
  if (cfg.chavesAlinhadas === false) {
    return `<div class="mp-ambiente-aviso mp-ambiente-aviso--erro">${fmt(cfg.dica)}</div>`;
  }
  if (cfg.ambiente === 'teste' && cfg.cartoesSandbox) {
    const s = cfg.cartoesSandbox;
    return `<div class="mp-ambiente-aviso mp-ambiente-aviso--sandbox"><strong>Sandbox</strong> — Cartão de teste: Master <code>${s.master}</code> ou Visa <code>${s.visa}</code> · CVV <code>${s.cvv}</code> · Titular <code>${s.titular}</code> · CPF <code>${s.cpf}</code></div>`;
  }
  if (cfg.ambiente === 'producao' && cfg.dica) {
    return `<div class="mp-ambiente-aviso mp-ambiente-aviso--prod">${fmt(cfg.dica)}</div>`;
  }
  return '';
}

async function preencherCarteiraMpAviso() {
  const wrap = document.getElementById('carteira-mp-ambiente');
  if (!wrap) return;
  wrap.innerHTML = '<div class="spinner" style="width:18px;height:18px;margin:6px 0"></div>';
  try {
    const cfg = await request('GET', `${API}/pagamento/config`);
    wrap.innerHTML = _mpPagamentoAvisoHtml(cfg) || '';
  } catch {
    wrap.innerHTML = '';
  }
}

function fecharFormAssinaturaMP() {
  const box = document.getElementById('mp-sub-content');
  const btn = document.getElementById('btn-mp-sub');
  const pix = document.getElementById('btn-mp-pix');
  try {
    if (_mpSubCtx && typeof _mpSubCtx._scUnmount === 'function') _mpSubCtx._scUnmount();
  } catch (_) {}
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  _mpSubCtx = null;
  if (btn) btn.disabled = false;
  if (pix) pix.disabled = false;
}

function _mpSubUnmountCvv() {
  if (_mpSubCtx && typeof _mpSubCtx._scUnmount === 'function') {
    try { _mpSubCtx._scUnmount(); } catch (_) {}
    _mpSubCtx._scUnmount = null;
  }
  const m = document.getElementById('mp-sub-cvv-mount');
  if (m) m.innerHTML = '';
}

async function _mpSubMountCvv(mp) {
  const mountId = 'mp-sub-cvv-mount';
  const el = document.getElementById(mountId);
  if (!el || !mp?.fields?.create) return;
  _mpSubUnmountCvv();
  try {
    const sc = mp.fields.create('securityCode', {
      placeholder: 'CVV',
      style: {
        color: '#141824',
        fontSize: '15px',
        fontWeight: '500',
        placeholderColor: '#64748b',
        height: '34px',
        paddingTop: '6px',
        paddingBottom: '6px',
        paddingLeft: '4px',
        paddingRight: '4px',
      },
    });
    sc.mount(mountId);
    _mpSubCtx._scUnmount = () => {
      try {
        if (typeof sc.unmount === 'function') sc.unmount();
      } catch (_) {}
    };
  } catch (e) {
    console.warn('[MP] Campo CVV (cartão salvo):', e);
  }
}

async function abrirFormAssinaturaMP(tituloUuid, valor, descricao) {
  const box = document.getElementById('mp-sub-content');
  const btn = document.getElementById('btn-mp-sub');
  const pix = document.getElementById('btn-mp-pix');
  if (!box) return;
  if (box.style.display === 'block' && tituloUuid && _mpSubCtx?.tituloUuid === tituloUuid) {
    fecharFormAssinaturaMP();
    return;
  }
  const cpfCliente = (clienteData && (clienteData.cpf_cnpj || '')) ? String(clienteData.cpf_cnpj).replace(/\D/g, '') : '';
  _mpSubCtx = { tituloUuid, valor, descricao };
  box.style.display = 'block';
  box.innerHTML = '<div style="padding:20px;text-align:center"><div class="spinner" style="margin:0 auto"></div><div style="font-size:.75rem;color:var(--text-muted);margin-top:10px">Carregando carteira...</div></div>';
  if (btn) btn.disabled = true;
  if (pix) pix.disabled = true;

  const prCart = request('GET', `${API}/carteira`).catch(() => ({ cards: [] }));
  const prCfg = request('GET', `${API}/pagamento/config`).catch(() => ({}));
  const [cr, mpCfg] = await Promise.all([prCart, prCfg]);
  const saved = cr.cards || [];
  const avisoTop = _mpPagamentoAvisoHtml(mpCfg);

  _mpSubCtx.savedCards = saved;

  const flowVal = saved.length ? 'saved' : 'novo';
  const savedRows = saved
    .map((c, i) => {
      const cid = String(c.mp_card_id || '').replace(/"/g, '');
      const last = fmt(c.last_four);
      const bl = _carteiraBrandLabel(c.payment_method_id);
      return `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border-radius:10px;border:1px solid var(--glass-border);background:#fff;box-shadow:0 1px 2px rgba(15,22,40,.04)">
        <input type="radio" name="mp-sub-card" value="${cid}" ${i === 0 ? 'checked' : ''} />
        <span style="font-size:.85rem;font-weight:600;color:var(--text)">${bl} · •••• ${last}</span>
      </label>`;
    })
    .join('');

  const savedBlock = saved.length
    ? `<div id="mp-sub-saved-block">
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:10px;line-height:1.45">
          Cartão da <strong style="color:var(--text)">sua carteira</strong>. Informe o <strong style="color:var(--text)">CVV</strong> (Mercado Pago exige de novo por segurança).
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">${savedRows}</div>
        <div style="font-size:.65rem;color:var(--text-muted);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Código de segurança (CVV)</div>
        <div id="mp-sub-cvv-mount" class="mp-sub-cvv-mount" style="margin-bottom:12px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;padding:2px 6px;max-width:140px"></div>
        <button type="button" id="mp-sub-show-novo" style="width:100%;background:transparent;border:none;color:var(--lemon-dark);font-size:.78rem;font-weight:600;cursor:pointer;margin-bottom:10px;text-decoration:underline">
          Usar outro cartão (digitar número completo)
        </button>
      </div>`
    : '';

  const novoBlock = `<div id="mp-sub-novo-block" style="display:${saved.length ? 'none' : 'block'}">
      <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:10px;line-height:1.45">Cobrança imediata do valor desta fatura no cartão (não é só verificação).</div>
      <input type="text" id="mp-sub-nome" placeholder="Nome impresso no cartão" autocomplete="cc-name" style="width:100%;margin-bottom:8px;padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem;box-sizing:border-box;-webkit-appearance:none;appearance:none" />
      <input type="text" id="mp-sub-num" placeholder="Número do cartão" inputmode="numeric" autocomplete="cc-number" style="width:100%;margin-bottom:8px;padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem;box-sizing:border-box;-webkit-appearance:none;appearance:none" />
      <div class="mp-sub-expiry-row" style="${_MP_SUB_EXPIRY_ROW_STYLE}">
        <input type="text" id="mp-sub-mes" placeholder="MM" maxlength="2" inputmode="numeric" autocomplete="cc-exp-month" style="${_MP_SUB_FIELD_STYLE}" />
        <input type="text" id="mp-sub-ano" placeholder="AAAA" maxlength="4" inputmode="numeric" autocomplete="cc-exp-year" style="${_MP_SUB_FIELD_STYLE}" />
        <input type="text" id="mp-sub-cvv" placeholder="CVV" maxlength="4" inputmode="numeric" autocomplete="cc-csc" style="${_MP_SUB_FIELD_STYLE}" />
      </div>
      <input type="text" id="mp-sub-cpf" placeholder="CPF do titular" value="${cpfCliente}" inputmode="numeric" style="width:100%;margin-bottom:12px;padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem;box-sizing:border-box;-webkit-appearance:none;appearance:none" />
      ${saved.length ? `<button type="button" id="mp-sub-show-saved" style="width:100%;background:transparent;border:none;color:var(--lemon-dark);font-size:.78rem;font-weight:600;cursor:pointer;margin-bottom:10px;text-decoration:underline">Voltar ao cartão da carteira</button>` : ''}
    </div>`;

  box.innerHTML = `
    <div class="mp-sub-panel" style="background:linear-gradient(180deg,rgba(0,158,227,.08) 0%,rgba(255,255,255,.95) 40%);border:1px solid rgba(0,158,227,.22);border-radius:12px;padding:14px;text-align:left">
      ${avisoTop}
      <input type="hidden" id="mp-sub-flow" value="${flowVal}" />
      ${savedBlock}
      ${novoBlock}
      <button type="button" id="mp-sub-confirm" class="btn btn-primary" style="width:100%;justify-content:center;background:linear-gradient(135deg,#009ee3,#007ab8);color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700">
        Pagar com cartão
      </button>
      <button type="button" onclick="fecharFormAssinaturaMP()" style="width:100%;margin-top:8px;background:transparent;border:none;color:var(--text-muted);font-size:.72rem;font-weight:600;cursor:pointer">Cancelar</button>
    </div>`;

  document.getElementById('mp-sub-confirm').onclick = () => confirmarAssinaturaComToken();

  if (saved.length) {
    document.getElementById('mp-sub-show-novo').onclick = () => {
      document.getElementById('mp-sub-flow').value = 'novo';
      document.getElementById('mp-sub-saved-block').style.display = 'none';
      document.getElementById('mp-sub-novo-block').style.display = 'block';
      _mpSubUnmountCvv();
    };
    const back = document.getElementById('mp-sub-show-saved');
    if (back) {
      back.onclick = async () => {
        document.getElementById('mp-sub-flow').value = 'saved';
        document.getElementById('mp-sub-saved-block').style.display = 'block';
        document.getElementById('mp-sub-novo-block').style.display = 'none';
        if (_mpSubCtx?.mp) await _mpSubMountCvv(_mpSubCtx.mp);
      };
    }
  }

  try {
    const cfg = await request('GET', `${API}/pagamento/config`);
    const pub = cfg.publicKey;
    if (!pub) throw new Error('Public Key do Mercado Pago não configurada no servidor.');
    await _loadMercadoPagoSdk();
    const MP = window.MercadoPago;
    if (!MP) throw new Error('MercadoPago SDK indisponível');
    const mp = new MP(pub, { locale: 'pt-BR' });
    _mpSubCtx.mp = mp;
    _mpSubCtx.publicKey = pub;
    if (saved.length) await _mpSubMountCvv(mp);
  } catch (e) {
    box.innerHTML = `<div style="color:#ef4444;font-size:.83rem;padding:12px;background:rgba(239,68,68,.08);border-radius:8px;border:1px solid rgba(239,68,68,.2)"><i class="fa-solid fa-circle-xmark"></i> ${e.message || 'Erro ao preparar pagamento'}</div>`;
    if (btn) btn.disabled = false;
    if (pix) pix.disabled = false;
    _mpSubCtx = null;
    return;
  }
}

const _mpBtnCartaoLabel = 'Pagar com cartão';

/** Após POST /pagamento/fatura/cartao: baixa no MK (polling se pendente). */
async function _mpFinalizarCartaoPortal(resposta, tituloUuid, valor, cbtn) {
  const { mpId, status, pollBaixa, valor: vServ } = resposta;
  const valorNum = vServ != null ? parseFloat(vServ) : parseFloat(valor);

  if (status === 'approved' && mpId) {
    try {
      await request('POST', `${API}/pagamento/baixa`, {
        mpId,
        tituloUuid,
        valor: valorNum,
      });
    } catch (e) {
      console.warn(e);
    }
    alert('Pagamento no cartão aprovado! Sua fatura foi baixada.');
    if (cbtn) {
      cbtn.disabled = false;
      cbtn.textContent = _mpBtnCartaoLabel;
    }
    closeModalDirect();
    if (typeof loadFaturas === 'function') loadFaturas();
    return;
  }

  if (pollBaixa && mpId) {
    if (cbtn) cbtn.textContent = 'Aguardando confirmação...';
    let tentativas = 0;
    const maxT = 90;
    const tick = async () => {
      tentativas += 1;
      if (tentativas > maxT) {
        if (cbtn) {
          cbtn.disabled = false;
          cbtn.textContent = _mpBtnCartaoLabel;
        }
        alert('O pagamento ainda está em análise. Atualize a lista de faturas em alguns minutos.');
        return;
      }
      try {
        const st = await request('GET', `${API}/pagamento/status/${mpId}`);
        if (st.status === 'approved') {
          try {
            await request('POST', `${API}/pagamento/baixa`, {
              mpId,
              tituloUuid: st.external_reference || tituloUuid,
              valor: st.valor != null ? st.valor : valorNum,
            });
          } catch (e) {
            console.warn(e);
          }
          alert('Pagamento no cartão aprovado! Sua fatura foi baixada.');
          if (cbtn) {
            cbtn.disabled = false;
            cbtn.textContent = _mpBtnCartaoLabel;
          }
          closeModalDirect();
          if (typeof loadFaturas === 'function') loadFaturas();
          return;
        }
        if (st.status === 'rejected' || st.status === 'cancelled') {
          if (cbtn) {
            cbtn.disabled = false;
            cbtn.textContent = _mpBtnCartaoLabel;
          }
          alert('Pagamento recusado ou cancelado.');
          return;
        }
      } catch (_) {}
      setTimeout(tick, 4000);
    };
    setTimeout(tick, 2000);
    return;
  }

  throw new Error('Resposta inesperada do servidor');
}

async function confirmarAssinaturaComToken() {
  if (!_mpSubCtx) return;
  const { tituloUuid, valor, descricao, mp, savedCards, publicKey } = _mpSubCtx;
  const flow = document.getElementById('mp-sub-flow')?.value || 'novo';
  const cbtn = document.getElementById('mp-sub-confirm');

  try {
    const cfgChk = await request('GET', `${API}/pagamento/config`);
    if (cfgChk.chavesAlinhadas === false) {
      alert(cfgChk.dica || 'Credenciais Mercado Pago inconsistentes.');
      return;
    }
  } catch (_) {}

  if (flow === 'saved' && savedCards?.length && mp?.fields?.createCardToken) {
    const sel = document.querySelector('input[name="mp-sub-card"]:checked');
    const cardId = sel?.value?.trim();
    if (!cardId) {
      alert('Selecione um cartão da carteira.');
      return;
    }
    const cardRow = (savedCards || []).find(c => String(c.mp_card_id) === cardId);
    const mpCustomerId = cardRow?.mp_customer_id ? String(cardRow.mp_customer_id).trim() : '';
    if (!mpCustomerId) {
      alert('Cartão sem vínculo ao cliente no Mercado Pago. Remova-o da carteira e cadastre de novo.');
      return;
    }
    if (cbtn) { cbtn.disabled = true; cbtn.textContent = 'Processando...'; }
    try {
      let tokenOut;
      try {
        tokenOut = await mp.fields.createCardToken({ cardId, customerId: mpCustomerId });
      } catch (e1) {
        try {
          tokenOut = await mp.fields.createCardToken({ cardId, customer_id: mpCustomerId });
        } catch (e2) {
          throw new Error((e1 && e1.message) || (e2 && e2.message) || 'Informe o CVV no campo acima e tente de novo.');
        }
      }
      const cardToken = tokenOut?.id || tokenOut?.token;
      if (!cardToken) throw new Error('Não foi possível gerar o token do cartão salvo.');
      const res = await request('POST', MP_API_FATURA_CARTAO, {
        tituloUuid,
        valor,
        descricao,
        cardToken,
        mpCustomerId,
      });
      if (res.ok && (res.modo === 'pagamento_cartao' || res.modo === 'pagamento_cartao_pendente')) {
        await _mpFinalizarCartaoPortal(res, tituloUuid, valor, cbtn);
        return;
      }
      throw new Error('Resposta inesperada do servidor');
    } catch (e) {
      alert(e.message || 'Não foi possível concluir o pagamento no cartão.');
      if (cbtn) { cbtn.disabled = false; cbtn.textContent = _mpBtnCartaoLabel; }
    }
    return;
  }

  const nome = document.getElementById('mp-sub-nome')?.value || '';
  const numero = document.getElementById('mp-sub-num')?.value || '';
  const mes = document.getElementById('mp-sub-mes')?.value || '';
  const ano = document.getElementById('mp-sub-ano')?.value || '';
  const cvv = document.getElementById('mp-sub-cvv')?.value || '';
  const cpf = document.getElementById('mp-sub-cpf')?.value || '';
  if (!nome || !numero || !mes || !ano || !cvv || cpf.length < 11) {
    alert('Preencha todos os campos do cartão e CPF (11 dígitos).');
    return;
  }
  if (cbtn) { cbtn.disabled = true; cbtn.textContent = 'Processando...'; }
  try {
    const pub = publicKey || (await request('GET', `${API}/pagamento/config`)).publicKey;
    if (!pub) throw new Error('Public Key do Mercado Pago não configurada no servidor.');
    const cardToken = await _mpCriarCardToken(pub, { nome, numero, mes, ano, cvv, cpf });
    const res = await request('POST', MP_API_FATURA_CARTAO, { tituloUuid, valor, descricao, cardToken });
    if (res.ok && (res.modo === 'pagamento_cartao' || res.modo === 'pagamento_cartao_pendente')) {
      await _mpFinalizarCartaoPortal(res, tituloUuid, valor, cbtn);
      return;
    }
    throw new Error('Resposta inesperada do servidor');
  } catch (e) {
    alert(e.message || 'Não foi possível concluir o pagamento no cartão.');
    if (cbtn) { cbtn.disabled = false; cbtn.textContent = _mpBtnCartaoLabel; }
  }
}

async function pagarPixFaturaComValorAtualizado(tituloUuid, descricao) {
  const uuid = String(tituloUuid || '').trim();
  if (!uuid) return;
  try {
    const t = await request('GET', `${API}/faturas/${encodeURIComponent(uuid)}`);
    const isPago = t.status === 'pago' || !!t.valorpag;
    if (isPago) {
      alert('Esta fatura já está paga.');
      return;
    }
    const valor = faturaValorTotalCobrancaPortal(t, false);
    if (!Number.isFinite(valor) || valor < 0) throw new Error('Valor da fatura indisponível. Atualize a lista.');
    await gerarPixMP(uuid, valor, descricao);
  } catch (e) {
    alert(e.message || 'Não foi possível iniciar o pagamento.');
  }
}

async function abrirCartaoFaturaComValorAtualizado(tituloUuid, descricao) {
  const uuid = String(tituloUuid || '').trim();
  if (!uuid) return;
  try {
    const t = await request('GET', `${API}/faturas/${encodeURIComponent(uuid)}`);
    const isPago = t.status === 'pago' || !!t.valorpag;
    if (isPago) {
      alert('Esta fatura já está paga.');
      return;
    }
    const valor = faturaValorTotalCobrancaPortal(t, false);
    if (!Number.isFinite(valor) || valor < 0) throw new Error('Valor da fatura indisponível. Atualize a lista.');
    await abrirFormAssinaturaMP(uuid, valor, descricao);
  } catch (e) {
    alert(e.message || 'Não foi possível abrir o pagamento.');
  }
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
    document.getElementById('chamado-mensagem').value = '';
    faturasCarregadas.abertas = false;
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
    const me = clienteData || await request('GET', `${API}/me`);
    clienteData = me;

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
    const cpf = (clienteData && (clienteData.cpf_cnpj || '')) ? String(clienteData.cpf_cnpj).replace(/\D/g, '') : '';
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
      clienteData = null;
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

// ===== MODAIS =====

function closeModal(e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
  }
}

function closeModalDirect() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
}

// ===== HELPERS =====

function emptyState(icon, msg) {
  return `<div class="empty-state"><i class="fa-solid ${icon}"></i><p>${msg}</p></div>`;
}

async function copiar(texto, btn) {
  const ok = await _copiarTexto(texto);
  const original = btn.innerHTML;
  if (ok) {
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = original; btn.classList.remove('copied'); }, 2500);
  } else {
    // Fallback visual: seleciona o texto em um campo temporário para o usuário copiar
    _abrirModalCopia(texto);
  }
}

async function _copiarTexto(texto) {
  // Método 1: Clipboard API moderna (HTTPS / páginas seguras)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {}
  }
  // Método 2: execCommand (funciona em HTTP e navegadores antigos)
  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length); // iOS
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {}
  return false;
}

function _abrirModalCopia(texto) {
  const existing = document.getElementById('_modal-copia-manual');
  if (existing) existing.remove();
  const m = document.createElement('div');
  m.id = '_modal-copia-manual';
  m.style.cssText = `position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px`;
  m.innerHTML = `
    <div style="background:#1a1a2e;border:1px solid rgba(163,230,53,.3);border-radius:16px;padding:24px;width:100%;max-width:420px">
      <div style="font-weight:700;font-size:1rem;margin-bottom:12px;color:#a3e635">📋 Copie o código PIX</div>
      <p style="font-size:.8rem;color:rgba(255,255,255,.6);margin-bottom:12px">Selecione todo o texto abaixo e copie:</p>
      <textarea id="_copia-ta" readonly style="width:100%;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-family:monospace;font-size:.72rem;padding:10px;resize:none;height:100px;word-break:break-all">${texto}</textarea>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button onclick="document.getElementById('_copia-ta').select();document.getElementById('_copia-ta').setSelectionRange(0,99999);document.execCommand('copy');this.textContent='✅ Copiado!'" style="flex:1;background:#a3e635;color:#000;border:none;border-radius:8px;padding:10px;font-weight:700;font-size:.85rem;cursor:pointer">Selecionar e Copiar</button>
        <button onclick="document.getElementById('_modal-copia-manual').remove()" style="background:rgba(255,255,255,.1);color:#fff;border:none;border-radius:8px;padding:10px 16px;cursor:pointer">Fechar</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  // Seleciona automaticamente
  setTimeout(() => {
    const ta = document.getElementById('_copia-ta');
    if (ta) { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); }
  }, 150);
}

// ===== INIT =====

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

// ===== CONEXÃO / MIKROTIK =====

let _connInterval = null;
let _connMaxDl = 1; // para escala da barra de consumo
let _connMaxUl = 1;

function fmtBps(bps) {
  bps = Number(bps) || 0;
  if (bps >= 1e9) return (bps / 1e9).toFixed(2) + ' Gbps';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' Kbps';
  return bps + ' bps';
}

function fmtBytes(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + ' TB';
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(2)  + ' GB';
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(1)  + ' MB';
  if (bytes >= 1e3)  return (bytes / 1e3).toFixed(0)  + ' KB';
  return bytes + ' B';
}

function fmtUptime(str) {
  if (!str) return '';
  // formato MikroTik: "2d19h58m3s" ou "58m3s" ou "3s"
  const d = str.match(/(\d+)d/)?.[1];
  const h = str.match(/(\d+)h/)?.[1];
  const m = str.match(/(\d+)m/)?.[1];
  const s = str.match(/(\d+)s/)?.[1];
  const parts = [];
  if (d) parts.push(`${d} dia${d !== '1' ? 's' : ''}`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !d && !h) parts.push(`${s}s`); // mostra segundos só quando menor que 1h
  return parts.join(' ') || str;
}

async function loadConexao() {
  // Para o interval anterior se houver
  if (_connInterval) clearInterval(_connInterval);
  await atualizarConexao();
  // Auto-refresh a cada 8 segundos
  _connInterval = setInterval(atualizarConexao, 3000);
}

async function atualizarConexao() {
  try {
    const d = await request('GET', `${API}/conexao`);
    const hero   = document.getElementById('conn-hero');
    const badge  = document.getElementById('conn-status-badge');
    const dot    = document.getElementById('conn-status-dot');
    const txt    = document.getElementById('conn-status-text');
    const navDot = document.getElementById('nav-conn-dot');

    if (d.online) {
      hero.className  = 'conn-hero online';
      badge.className = 'conn-status-badge online';
      txt.textContent = 'Conectado';
      navDot.style.display = 'block';

      document.getElementById('conn-uptime').innerHTML =
        `<i class="fa-solid fa-clock"></i> ${fmtUptime(d.uptime)} conectado`;
      document.getElementById('conn-ip').textContent    = d.ip    || '—';
      document.getElementById('conn-mac').textContent   = d.mac   || '—';
      document.getElementById('conn-login').textContent = d.login || '—';

      // Velocidade atual
      const dlRate = document.getElementById('conn-dl-rate');
      const ulRate = document.getElementById('conn-ul-rate');
      dlRate.textContent = fmtBps(d.dlRate);
      ulRate.textContent = fmtBps(d.ulRate);
      dlRate.style.color = d.dlRate > 0 ? '#818cf8' : 'var(--text-muted)';
      ulRate.style.color = d.ulRate > 0 ? 'var(--lemon)' : 'var(--text-muted)';

      // Max do plano
      document.getElementById('conn-dl-max').textContent = d.maxDl ? `/${fmtBps(d.maxDl)}` : '';
      document.getElementById('conn-ul-max').textContent = d.maxUl ? `/${fmtBps(d.maxUl)}` : '';
      document.getElementById('conn-plan-dl').textContent = d.maxDl ? fmtBps(d.maxDl) : '—';
      document.getElementById('conn-plan-ul').textContent = d.maxUl ? fmtBps(d.maxUl) : '—';

      // Consumo da sessão
      document.getElementById('conn-dl-bytes').textContent = fmtBytes(d.dlBytes);
      document.getElementById('conn-ul-bytes').textContent = fmtBytes(d.ulBytes);

      // Barra de consumo (relativo ao maior valor entre os dois)
      _connMaxDl = Math.max(_connMaxDl, d.dlBytes, 1);
      _connMaxUl = Math.max(_connMaxUl, d.ulBytes, 1);
      const dlPct = Math.min((d.dlBytes / _connMaxDl) * 100, 100);
      const ulPct = Math.min((d.ulBytes / _connMaxUl) * 100, 100);
      document.getElementById('conn-dl-bar').style.width = dlPct + '%';
      document.getElementById('conn-ul-bar').style.width = ulPct + '%';

      // Pacotes descartados
      const droppedWrap = document.getElementById('conn-dropped');
      if (d.dropped > 0) {
        droppedWrap.style.display = 'flex';
        document.getElementById('conn-dropped-val').textContent = d.dropped.toLocaleString('pt-BR');
      } else {
        droppedWrap.style.display = 'none';
      }

    } else {
      hero.className  = 'conn-hero offline';
      badge.className = 'conn-status-badge offline';
      txt.textContent = 'Offline';
      navDot.style.display = 'none';
      document.getElementById('conn-uptime').textContent = '';
      document.getElementById('conn-ip').textContent     = '—';
      document.getElementById('conn-mac').textContent    = '—';
      document.getElementById('conn-login').textContent  = '—';
      document.getElementById('conn-dl-rate').textContent = '—';
      document.getElementById('conn-ul-rate').textContent = '—';
      document.getElementById('conn-dl-bytes').textContent = '—';
      document.getElementById('conn-ul-bytes').textContent = '—';
      document.getElementById('conn-dropped').style.display = 'none';
    }
  } catch (e) {
    console.warn('Erro ao buscar conexão:', e.message);
  }
}

// Para o refresh quando sair da aba de conexão
const _origNavTo = typeof navTo === 'function' ? navTo : null;

// ===== VELOCIDADE / SPEED TEST =====

const PLAN_SPEEDS = {
  'lemon smart': 300, 'lemon plus': 500,
  'lemon max':   700, 'lemon x':   1000,
};
const GAUGE_LEN = 283;
let _speedTesting = false;
let _speedHistory = JSON.parse(localStorage.getItem('lemon_speed_hist') || '[]');
let _gaugeMax = 1000; // calibrado dinamicamente com o plano

function navToVelocidade() { loadVelocidade(); }

function loadVelocidade() {
  renderSpeedHistory();
  const planSpeed = getPlanSpeed();
  _gaugeMax = planSpeed ? Math.ceil(planSpeed * 1.2 / 100) * 100 : 1000;
  if (planSpeed) {
    document.getElementById('cmp-plano').textContent = `${planSpeed} Mbps`;
  }
}

function getPlanSpeed() {
  if (!clienteData) return null;
  const plano = (clienteData.plano || clienteData.plano_nome || '').toLowerCase();
  for (const [k, v] of Object.entries(PLAN_SPEEDS)) {
    if (plano.includes(k)) return v;
  }
  return null;
}

function setGauge(pct) {
  const arc = document.getElementById('gauge-arc');
  if (!arc) return;
  arc.style.strokeDashoffset = GAUGE_LEN * (1 - Math.min(Math.max(pct, 0), 1));
}

function animateSpeed(from, to, duration, onUpdate) {
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    onUpdate(from + (to - from) * ease);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Ping com jitter
async function medirPing(amostras = 8) {
  const tempos = [];
  for (let i = 0; i < amostras; i++) {
    const t0 = performance.now();
    await fetch('/speedtest/ping?t=' + Date.now(), { cache: 'no-store' });
    tempos.push(performance.now() - t0);
    await new Promise(r => setTimeout(r, 50));
  }
  const sorted = [...tempos].sort((a, b) => a - b);
  const ping = Math.round(sorted[Math.floor(sorted.length / 2)]);
  // Jitter = desvio médio entre amostras consecutivas
  let jitter = 0;
  for (let i = 1; i < tempos.length; i++) jitter += Math.abs(tempos[i] - tempos[i - 1]);
  jitter = Math.round(jitter / (tempos.length - 1));
  return { ping, jitter };
}

// Download com 4 streams paralelos + leitura em tempo real via ReadableStream
async function medirDownload(onRate) {
  const STREAMS = 4;
  const MB_EACH = 20; // 4×20MB = 80MB total
  let totalBytes = 0;
  const t0 = performance.now();
  let lastTs = t0, lastBytes = 0;

  function onChunk(size) {
    totalBytes += size;
    const now = performance.now();
    const dt = (now - lastTs) / 1000;
    if (dt >= 0.12) {
      const rate = ((totalBytes - lastBytes) * 8) / dt / 1e6;
      lastTs = now; lastBytes = totalBytes;
      onRate(Math.max(0, rate));
    }
  }

  async function doStream() {
    const res = await fetch(`/speedtest/download?mb=${MB_EACH}&t=${Date.now()}`, { cache: 'no-store' });
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(value.length);
    }
  }

  await Promise.all(Array.from({ length: STREAMS }, doStream));
  const elapsed = (performance.now() - t0) / 1000;
  return (totalBytes * 8) / elapsed / 1e6;
}

// Upload com XHR para ter progresso real via upload.onprogress
function xhrUploadStream(data, onRate) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const t0 = performance.now();
    let lastLoaded = 0, lastTs = t0;

    xhr.upload.onprogress = (e) => {
      const now = performance.now();
      const dt = (now - lastTs) / 1000;
      if (dt >= 0.15 && e.loaded > lastLoaded) {
        const rate = ((e.loaded - lastLoaded) * 8) / dt / 1e6;
        lastLoaded = e.loaded;
        lastTs = now;
        onRate(Math.max(0, rate));
      }
    };

    xhr.onload = () => {
      const elapsed = (performance.now() - t0) / 1000;
      resolve({ bytes: data.byteLength, elapsed });
    };
    xhr.onerror = reject;
    xhr.open('POST', '/speedtest/upload?t=' + Date.now());
    xhr.send(data);
  });
}

// 3 streams XHR paralelos — agrega progresso em tempo real
async function medirUpload(onRate) {
  const STREAMS = 3;
  const MB_EACH = 10;
  const chunk = new Uint8Array(MB_EACH * 1024 * 1024);

  // Acumulador de taxas dos streams ativos
  const rates = new Array(STREAMS).fill(0);
  function onStreamRate(idx, rate) {
    rates[idx] = rate;
    onRate(rates.reduce((a, b) => a + b, 0));
  }

  const t0 = performance.now();
  let totalBytes = 0;

  const results = await Promise.all(
    Array.from({ length: STREAMS }, (_, i) =>
      xhrUploadStream(chunk.slice(), rate => onStreamRate(i, rate))
        .then(r => { totalBytes += r.bytes; return r; })
    )
  );

  const elapsed = (performance.now() - t0) / 1000;
  return (totalBytes * 8) / elapsed / 1e6;
}

async function iniciarSpeedTest() {
  if (_speedTesting) return;
  _speedTesting = true;

  const btn   = document.getElementById('btn-speedtest');
  const gauge = document.querySelector('.speed-gauge');
  const phase = document.getElementById('speed-phase');
  const disp  = document.getElementById('speed-display');
  const unit  = document.getElementById('speed-unit');
  const pWrap = document.getElementById('speed-progress-wrap');
  const pFill = document.getElementById('speed-progress-fill');

  document.getElementById('speed-results').classList.add('hidden');
  document.getElementById('speed-compare').classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Testando...</span>';
  btn.classList.add('testing');
  gauge.classList.add('testing');
  pWrap.classList.remove('hidden');
  setGauge(0);
  unit.textContent = 'Mbps';

  let pingMs = 0, jitterMs = 0, dlMbps = 0, ulMbps = 0;

  try {
    // --- PING + JITTER ---
    phase.textContent = 'Medindo latência...';
    pFill.style.width = '5%';
    disp.textContent = '--';

    // Pulsa o gauge enquanto mede ping
    let pingPulse = 0, pingDir = 1;
    const pingAnim = setInterval(() => {
      pingPulse += 0.04 * pingDir;
      if (pingPulse >= 0.15 || pingPulse <= 0) pingDir *= -1;
      setGauge(pingPulse);
    }, 50);

    const pingResult = await medirPing(8);
    pingMs = pingResult.ping;
    jitterMs = pingResult.jitter;
    clearInterval(pingAnim);
    setGauge(0);

    document.getElementById('res-ping').textContent = pingMs;
    document.getElementById('res-jitter').textContent = jitterMs;
    pFill.style.width = '15%';

    // --- DOWNLOAD ---
    phase.textContent = 'Testando download... (4 streams)';
    unit.textContent = 'Mbps ↓';
    disp.textContent = '0.0';
    pFill.style.width = '20%';

    let peakDl = 0;
    dlMbps = await medirDownload(rate => {
      peakDl = Math.max(peakDl, rate);
      disp.textContent = rate.toFixed(1);
      setGauge(rate / _gaugeMax);
      // progresso de 20% → 65%
      const prog = 20 + Math.min((rate / _gaugeMax) * 45, 45);
      pFill.style.width = prog + '%';
    });

    // Anima para o resultado final
    await new Promise(r => {
      animateSpeed(parseFloat(disp.textContent) || dlMbps, dlMbps, 500, val => {
        disp.textContent = val.toFixed(1);
        setGauge(val / _gaugeMax);
      });
      setTimeout(r, 550);
    });
    document.getElementById('res-download').textContent = dlMbps.toFixed(1);
    pFill.style.width = '65%';

    await new Promise(r => setTimeout(r, 400));

    // --- UPLOAD ---
    phase.textContent = 'Testando upload... (3 streams)';
    unit.textContent = 'Mbps ↑';
    disp.textContent = '0.0';
    setGauge(0);
    pFill.style.width = '68%';

    ulMbps = await medirUpload(rate => {
      disp.textContent = rate.toFixed(1);
      setGauge(rate / _gaugeMax);
      const prog = 68 + Math.min((rate / _gaugeMax) * 27, 27);
      pFill.style.width = prog + '%';
    });

    await new Promise(r => {
      animateSpeed(parseFloat(disp.textContent) || ulMbps, ulMbps, 500, val => {
        disp.textContent = val.toFixed(1);
        setGauge(val / _gaugeMax);
      });
      setTimeout(r, 550);
    });
    document.getElementById('res-upload').textContent = ulMbps.toFixed(1);
    pFill.style.width = '100%';

    // --- FINALIZAR ---
    phase.textContent = '✓ Concluído';
    unit.textContent = 'Mbps';
    animateSpeed(ulMbps, dlMbps, 700, val => {
      disp.textContent = val.toFixed(1);
      setGauge(val / _gaugeMax);
    });

    setTimeout(async () => {
      document.getElementById('speed-results').classList.remove('hidden');
      exibirComparacao(dlMbps, ulMbps);
      salvarHistoricoSpeed(dlMbps, ulMbps, pingMs, jitterMs);
      renderSpeedHistory();
      // Enviar resultado real ao servidor — ele valida e concede missões automaticamente
      try {
        const stRes = await request('POST', `${API}/speedtest/registrar`, {
          dl: dlMbps, ul: ulMbps, ping: pingMs, planSpeed: getPlanSpeed() || 0
        });
        // Atualizar cache com missões novas concedidas pelo servidor
        if (stRes.missoesConcluidas) {
          stRes.missoesConcluidas.forEach(id => _cacheMissao(id));
        }
        // Notificar missões de speedtest recém completadas
        const missoesSpeedtest = ['speedtest','speedtest_3x','speedtest_5x','speedtest_10x',
                                   'speedtest_manha','speedtest_noite','speedtest_100','speedtest_excelente','speedtest_semana'];
        for (const id of missoesSpeedtest) {
          if (stRes.missoesConcluidas?.includes(id) && !_missaoCache.has(id + '_notified')) {
            _cacheMissao(id + '_notified');
            const m = { speedtest:'Primeiro teste!', speedtest_3x:'3 testes!', speedtest_5x:'5 testes!',
                        speedtest_10x:'10 testes!', speedtest_manha:'Teste matinal!', speedtest_noite:'Teste noturno!',
                        speedtest_100:'Velocidade máxima!', speedtest_excelente:'Velocidade excelente!', speedtest_semana:'Testador assíduo!' };
            if (m[id]) showToast(`+pts — Missão "${m[id]}" concluída! 🎯`, 'success');
          }
        }
        if (stRes.pontos) { _clubPontos = stRes.pontos; animarContador('ref-pontos', stRes.pontos); }
      } catch { /* silencioso se offline */ }
    }, 800);

  } catch (err) {
    phase.textContent = 'Erro no teste';
    disp.textContent = '--';
    console.error('SpeedTest erro:', err);
  } finally {
    _speedTesting = false;
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> <span>Testar novamente</span>';
    btn.classList.remove('testing');
    gauge.classList.remove('testing');
    setTimeout(() => pWrap.classList.add('hidden'), 1500);
  }
}

function exibirComparacao(dlMbps, ulMbps) {
  const planSpeed = getPlanSpeed();
  const section = document.getElementById('speed-compare');
  section.classList.remove('hidden');

  document.getElementById('cmp-medida').textContent = dlMbps.toFixed(1) + ' Mbps';

  const maxRef = planSpeed || _gaugeMax;
  const pct = Math.min(dlMbps / maxRef, 1.05); // permite leve overflow visual
  const barFill = document.getElementById('cmp-bar');
  setTimeout(() => { barFill.style.width = Math.min(pct * 100, 100) + '%'; }, 100);

  if (planSpeed) {
    document.getElementById('cmp-plano').textContent = planSpeed + ' Mbps';
    const marker = document.getElementById('cmp-plan-marker');
    marker.style.left = '100%';

    const ratio = dlMbps / planSpeed;
    const badge = document.getElementById('cmp-badge');
    let cls, icon, msg;
    if (ratio >= 1.0) {
      completarMissao('speedtest_100', null, false);
    }
    if (ratio >= 0.9) {
      cls = 'badge-excelente'; icon = 'fa-circle-check';
      msg = `Excelente! ${dlMbps.toFixed(0)} Mbps — dentro do esperado para seu plano.`;
      completarMissao('speedtest_excelente', null, false);
    } else if (ratio >= 0.7) {
      cls = 'badge-bom'; icon = 'fa-thumbs-up';
      msg = `Boa velocidade! ${Math.round(ratio * 100)}% do plano contratado.`;
    } else if (ratio >= 0.5) {
      cls = 'badge-regular'; icon = 'fa-triangle-exclamation';
      msg = `Abaixo do esperado (${Math.round(ratio * 100)}%). Verifique o roteador.`;
    } else {
      cls = 'badge-ruim'; icon = 'fa-circle-xmark';
      msg = `Velocidade muito baixa (${Math.round(ratio * 100)}%). Entre em contato com o suporte.`;
    }
    badge.className = `speed-status-badge ${cls}`;
    badge.innerHTML = `<i class="fa-solid ${icon}"></i> ${msg}`;
  } else {
    document.getElementById('cmp-plano').textContent = 'Não identificado';
    document.getElementById('cmp-badge').innerHTML = '';
  }
}

function salvarHistoricoSpeed(dl, ul, ping, jitter) {
  const now = new Date();
  _speedHistory.unshift({
    dl: dl.toFixed(1), ul: ul.toFixed(1), ping, jitter: jitter || 0,
    dt: now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  });
  _speedHistory = _speedHistory.slice(0, 10);
  localStorage.setItem('lemon_speed_hist', JSON.stringify(_speedHistory));
}

function renderSpeedHistory() {
  const list = document.getElementById('speed-history-list');
  if (!list) return;
  if (_speedHistory.length === 0) {
    list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-gauge"></i><p>Nenhum teste ainda</p></div>';
    return;
  }
  list.innerHTML = _speedHistory.map(h => `
    <div class="speed-history-item">
      <div class="speed-history-dt">${h.dt}</div>
      <div class="speed-history-vals">
        <span class="speed-history-val" style="color:#818cf8"><i class="fa-solid fa-arrow-down"></i>${h.dl} Mbps</span>
        <span class="speed-history-val" style="color:var(--lemon)"><i class="fa-solid fa-arrow-up"></i>${h.ul} Mbps</span>
        <span class="speed-history-val" style="color:#22d3ee"><i class="fa-solid fa-clock"></i>${h.ping}ms</span>
        ${h.jitter !== undefined ? `<span class="speed-history-val" style="color:#fb923c"><i class="fa-solid fa-wave-square"></i>${h.jitter}ms</span>` : ''}
      </div>
    </div>
  `).join('');
}

function limparHistoricoSpeed() {
  _speedHistory = [];
  localStorage.removeItem('lemon_speed_hist');
  renderSpeedHistory();
}

// ===== LEMON CLUB =====

let _refLink    = '';
let _clubPontos = 0;

// Cache local de missões já concluídas — evita chamadas repetidas ao servidor
const _missaoCache = new Set(JSON.parse(sessionStorage.getItem('lemon_miss') || '[]'));

function _cacheMissao(tipo) {
  _missaoCache.add(tipo);
  sessionStorage.setItem('lemon_miss', JSON.stringify([..._missaoCache]));
}

// Busca missões já completas do servidor e preenche o cache local
// Evita toasts e chamadas desnecessárias ao longo de toda a sessão
async function _prePopularCacheMissoes() {
  try {
    const data = await request('GET', `${API}/clube/stats`);
    (data.completedMissions || []).forEach(id => _cacheMissao(id));
  } catch { /* silencioso */ }
}

// Seções visitadas — agora rastreadas no servidor via /portal/visita
const _visitedViews = new Set(); // mantido para compatibilidade com lógica local

// Mapa: missão de visita → nome da seção para o servidor
const _secaoMap = {
  ver_fatura:        'faturas',
  ver_conexao:       'conexao',
  ver_velocidade_sec:'velocidade',
  ver_perfil_sec:    'perfil',
  ver_suporte_sec:   'suporte',
  ver_clube:         'indicacoes',
  /** Alinhado a server.js secaoMissao (desafios / historico ≠ indicacoes). */
  ver_desafios:      'desafios',
  ver_historico:     'historico',
};

// Acionada ao navegar — registra visita no servidor (prova real)
async function missaoVisita(tipo) {
  if (_missaoCache.has(tipo)) return;
  const secao = _secaoMap[tipo] || tipo.replace('ver_', '');
  try {
    const r = await request('POST', `${API}/visita`, { secao });
    if (r.ok) {
      // Só cacheia se o servidor confirmou esta missão (evita marcar "feito" sem conceder).
      if (r.missao === tipo) _cacheMissao(tipo);
      // Se ganhou pontos, notifica e atualiza
      if (r.novosPts > 0) {
        showToast(`+${r.novosPts} pts — "${r.label}" concluída! 🎯`, 'success');
        _clubPontos = r.pontos;
        animarContador('ref-pontos', r.pontos);
        atualizarBotoesResgate(r.pontos);
      }
    }
  } catch { /* silencioso */ }
}

const LEVEL_COLORS = {
  bronze:   '#cd7f32',
  prata:    '#94a3b8',
  ouro:     '#f59e0b',
  diamante: '#818cf8',
};

async function loadIndicacoes() {
  // Sincroniza faturas ANTES de buscar stats, para não pegar dados velhos
  try { await request('POST', `${API}/clube/sincronizar`); } catch {}

  try {
    const data = await request('GET', `${API}/clube/stats`);
    _clubPontos = data.pontos;
    _refLink    = data.link;

    // Popula o cache local com missões já completas vindas do servidor
    (data.completedMissions || []).forEach(id => _cacheMissao(id));

    // Contadores animados
    animarContador('ref-pontos', data.pontos);
    animarContador('ref-total', data.totalIndicados);
    animarContador('ref-resgates', data.resgates?.length || 0);
    animarContador('club-total-earned', data.totalEarned);
    animarContador('club-streak', data.streak || 0);

    // Badge no menu
    const badge = document.getElementById('nav-pontos');
    if (data.pontos > 0) { badge.textContent = data.pontos + ' pts'; badge.style.display = ''; }
    else badge.style.display = 'none';

    // Nível
    if (data.nivel) {
      const nv = data.nivel;
      document.getElementById('club-level-icon').textContent = nv.icon;
      document.getElementById('club-level-name').textContent = nv.label;
      document.getElementById('club-level-name').style.color = LEVEL_COLORS[nv.id] || 'var(--lemon)';
      if (data.proximoNivel) {
        const total = data.proximoNivel.min - (nv.min || 0);
        const atual = (data.totalEarned || 0) - (nv.min || 0);
        const pct   = Math.min(Math.max(atual / total, 0), 1);
        setTimeout(() => {
          document.getElementById('club-level-bar').style.width = (pct * 100) + '%';
          const ratioEl2 = document.getElementById('club-level-bar-ratio');
          if (ratioEl2) ratioEl2.textContent = `${data.totalEarned || 0} / ${data.proximoNivel.min} pts`;
          document.getElementById('club-level-progress-label').textContent =
            `${data.ptsFaltamProx} pts para ${data.proximoNivel.icon} ${data.proximoNivel.label}`;
        }, 300);
      } else {
        document.getElementById('club-level-bar').style.width = '100%';
        const ratioEl2 = document.getElementById('club-level-bar-ratio');
        if (ratioEl2) ratioEl2.textContent = `${data.totalEarned || 0} pts`;
        document.getElementById('club-level-progress-label').textContent = '🏆 Nível máximo atingido!';
      }
    }

    // Link
    document.getElementById('ref-link-text').textContent = data.link;

    // Botões de resgate
    atualizarBotoesResgate(data.pontos);

    // Missões
    renderMissions(data.missoes || [], data.completedMissions || []);
    missaoVisita('ver_desafios');

    // Log de pontos
    renderClubLog(data.log || []);
    missaoVisita('ver_historico');

  } catch (e) {
    console.error(e);
  }
}

function animarContador(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const dur = 700;
  const t0 = performance.now();
  function step(now) {
    const p = Math.min((now - t0) / dur, 1);
    el.textContent = Math.round(start + (target - start) * (1 - Math.pow(1-p,3)));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function atualizarBotoesResgate(pontos) {
  const resgates = [
    { id: 'reward-desconto',              pts: 100  },
    { id: 'reward-desconto_20',           pts: 180  },
    { id: 'reward-desconto_30',           pts: 260  },
    { id: 'reward-desconto_40',           pts: 340  },
    { id: 'reward-desconto_50',           pts: 420  },
    { id: 'reward-desconto_80',           pts: 650  },
    { id: 'reward-velocidade_dobro_7d',   pts: 220  },
    { id: 'reward-upgrade',               pts: 300  },
    { id: 'reward-plano_up_7d',           pts: 370  },
    { id: 'reward-indicacao_dobro',       pts: 350  },
    { id: 'reward-plano_up_15d',          pts: 470  },
    { id: 'reward-ponto_extra_15d',       pts: 500  },
    { id: 'reward-roteador_wifi6',        pts: 560  },
    { id: 'reward-ponto_extra_30d',       pts: 620  },
    { id: 'reward-mes_gratis',            pts: 800  },
    { id: 'reward-upgrade_90d',           pts: 850  },
    { id: 'reward-plano_up_30d',          pts: 950  },
    { id: 'reward-desconto_100',          pts: 1050 },
    { id: 'reward-plano_up_60d',          pts: 1300 },
    { id: 'reward-dois_meses',            pts: 1500 },
    { id: 'reward-tres_meses',            pts: 1800 },
    { id: 'reward-cliente_vip',           pts: 2000 },
  ];
  resgates.forEach(({ id, pts }) => {
    const card = document.getElementById(id);
    const btn  = card?.querySelector('.club-reward-btn');
    if (!btn) return;
    btn.disabled = pontos < pts;
    card.classList.toggle('reward-locked', pontos < pts);
  });
  // Atualiza saldo no header da seção
  const disp = document.getElementById('club-pontos-disp');
  if (disp) disp.textContent = pontos + ' pts disponíveis';
}

// Botão "Ir fazer" vs "automático": vem do campo `auto` em GET /portal/clube/stats (MISSIONS no servidor).

// Ação de cada missão ao clicar "Ir fazer"
function irFazerMissao(id) {
  const NAV = {
    // ── Exploração ──────────────────────────────────────────────────
    primeiro_login:      () => completarMissao('primeiro_login', null, false),
    ver_fatura:          () => navTo('faturas'),
    ver_conexao:         () => navTo('conexao'),
    ver_velocidade_sec:  () => navTo('velocidade'),
    ver_perfil_sec:      () => navTo('perfil'),
    ver_suporte_sec:     () => navTo('suporte'),
    ver_clube:           () => navTo('indicacoes'),
    ver_desafios:        () => navTo('indicacoes'),
    ver_historico:       () => navTo('indicacoes'),
    explorador:          () => { navTo('dashboard'); showToast('Visite todas as seções do portal para concluir 🧭', 'info'); },
    acesso_noturno:      () => showToast('Acesse o portal após as 22h para concluir 🌙', 'info'),
    // ── App & Perfil ────────────────────────────────────────────────
    perfil_completo:     () => navTo('perfil'),
    instalar_app:        () => instalarPWA(),
    compartilhar_link:   () => copiarLinkRef(),
    ativar_notif:        () => ativarNotificacoes(),
    mudar_dados:         () => navTo('perfil'),
    indicar_whatsapp:    () => {
      compartilharWhats();
      showToast('Missão do perfil: envie seu link de indicação pelo WhatsApp.', 'info');
    },
    login_3x:            () => showToast('Acesse o portal em 3 sessões diferentes para concluir 📲', 'info'),
    uso_semanal:         () => showToast('Acesse o portal em 3 dias diferentes para concluir 📅', 'info'),
    // ── Velocidade ──────────────────────────────────────────────────
    speedtest:           () => navTo('velocidade'),
    speedtest_3x:        () => navTo('velocidade'),
    speedtest_5x:        () => navTo('velocidade'),
    speedtest_10x:       () => navTo('velocidade'),
    speedtest_manha:     () => { navTo('velocidade'); showToast('Faça o teste entre 6h e 12h ☀️', 'info'); },
    speedtest_noite:     () => { navTo('velocidade'); showToast('Faça o teste entre 20h e 23h 🌙', 'info'); },
    speedtest_100:       () => navTo('velocidade'),
    speedtest_excelente: () => navTo('velocidade'),
    speedtest_semana:    () => { navTo('velocidade'); showToast('Faça testes em 3 dias diferentes 📅', 'info'); },
    // ── Indicações ──────────────────────────────────────────────────
    embaixador:          () => {
      compartilharWhats();
      showToast('Missão do clube: divulgue o portal ou seu link a partir das indicações.', 'info');
    },
    indicar_1:           () => navTo('indicacoes'),
    indicar_2:           () => navTo('indicacoes'),
    indicar_3:           () => navTo('indicacoes'),
    indicar_5:           () => navTo('indicacoes'),
    indicar_7:           () => navTo('indicacoes'),
    indicar_10:          () => navTo('indicacoes'),
    indicar_15:          () => navTo('indicacoes'),
    indicar_20:          () => navTo('indicacoes'),
    // ── Fidelidade ──────────────────────────────────────────────────
    pagamento_1:         () => navTo('faturas'),
    pagamento_5:         () => navTo('faturas'),
    pagamento_10:        () => navTo('faturas'),
    streak_3:            () => { navTo('faturas'); showToast('Acumule 3 faturas pagas até o vencimento (contadas no clube) 🔥', 'info'); },
    streak_6:            () => { navTo('faturas'); showToast('Acumule 6 faturas pagas até o vencimento (contadas no clube) 🔥', 'info'); },
    streak_9:            () => { navTo('faturas'); showToast('Acumule 9 faturas pagas até o vencimento (contadas no clube) 🔥', 'info'); },
    streak_12:           () => { navTo('faturas'); showToast('Acumule 12 faturas pagas até o vencimento (contadas no clube) 👑', 'info'); },
    streak_18:           () => { navTo('faturas'); showToast('Acumule 18 faturas pagas até o vencimento (contadas no clube) 💎', 'info'); },
    streak_24:           () => { navTo('faturas'); showToast('Acumule 24 faturas pagas até o vencimento (contadas no clube) 🏆', 'info'); },
    maratonista:         () => { navTo('faturas'); showToast('Acumule 15 faturas pagas até o vencimento (contadas no clube) 🏅', 'info'); },
    // ── Conquistas ──────────────────────────────────────────────────
    clube_prata:         () => showToast('Acumule 500 pts no total para alcançar o Prata 🥈', 'info'),
    clube_ouro:          () => showToast('Acumule 1500 pts no total para alcançar o Ouro 🥇', 'info'),
    clube_diamante:      () => showToast('Acumule 3000 pts no total para alcançar o Diamante 💎', 'info'),
    missoes_5:           () => showToast('Complete 5 missões para ganhar este bônus ✅', 'info'),
    missoes_10:          () => showToast('Complete 10 missões para ganhar este bônus ✅', 'info'),
    missoes_15:          () => showToast('Complete 15 missões para ganhar este bônus ✅', 'info'),
    missoes_20:          () => showToast('Complete 20 missões para ganhar este bônus ✅', 'info'),
    resgatar_1:          () => navTo('indicacoes'),
    colecionador:        () => navTo('indicacoes'),
  };
  const acao = NAV[id];
  if (acao) { acao(); return; }
  // Fallback: tenta completar diretamente
  completarMissao(id, null, false);
}

function renderMissions(missoes, completadas) {
  const lista = document.getElementById('missions-list');
  if (!lista) return;

  const total = missoes.length;
  const done  = missoes.filter(m => m.completa).length;
  const counter = document.getElementById('missions-counter');
  if (counter) counter.textContent = `${done}/${total}`;

  if (!missoes.length) {
    lista.innerHTML = '<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>Sem desafios no momento</p></div>';
    return;
  }

  // Agrupar por categoria
  const grupos = {};
  for (const m of missoes) {
    const cat = m.categoria || 'Outros';
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(m);
  }

  const catIcons = {
    'Exploração':  'fa-compass',
    'App & Perfil':'fa-mobile-screen',
    'Velocidade':  'fa-gauge-high',
    'Fidelidade':  'fa-fire',
    'Indicações':  'fa-user-plus',
    'Conquistas':  'fa-trophy',
  };

  const gruposEntries = Object.entries(grupos);
  let openIdx = gruposEntries.findIndex(([, it]) => it.some(m => !m.completa));
  if (openIdx < 0) openIdx = 0;

  lista.innerHTML = gruposEntries.map(([cat, items], idx) => {
    const catDone  = items.filter(m => m.completa).length;
    const catTotal = items.length;
    const catPct   = Math.round((catDone / catTotal) * 100);
    const catIcon  = catIcons[cat] || 'fa-star';

    const itemsHtml = items.map(m => `
      <div class="mission-item ${m.completa ? 'mission-done' : ''}">
        <div class="mission-icon" style="background:${m.completa ? 'rgba(34,197,94,0.15)' : hexToRgba(m.cor, 0.1)};border-color:${m.completa ? 'rgba(34,197,94,0.3)' : hexToRgba(m.cor, 0.25)}">
          <i class="fa-solid ${m.completa ? 'fa-check' : m.icon}" style="color:${m.completa ? '#4ade80' : m.cor}"></i>
        </div>
        <div class="mission-info">
          <div class="mission-title">${m.label}</div>
          <div class="mission-desc">${m.desc}</div>
        </div>
        <div class="mission-pts-wrap">
          ${m.completa
            ? '<span class="mission-done-badge"><i class="fa-solid fa-check"></i> Feito</span>'
            : `<span class="mission-pts">+${m.pts} pts</span>
               ${m.auto === true
                 ? '<span class="mission-auto-badge">automático</span>'
                 : `<button class="mission-claim-btn" onclick="irFazerMissao('${m.id}')">Ir fazer</button>`
               }`
          }
        </div>
      </div>`).join('');

    return `
      <details class="mission-group" name="club-mission-groups"${idx === openIdx ? ' open' : ''}>
        <summary class="mission-group-header">
          <span class="mission-group-chev" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i></span>
          <div class="mission-group-title">
            <i class="fa-solid ${catIcon}"></i> ${cat}
          </div>
          <div class="mission-group-progress">
            <span class="mission-group-count">${catDone}/${catTotal}</span>
            <div class="mission-group-bar">
              <div class="mission-group-bar-fill" style="width:${catPct}%"></div>
            </div>
          </div>
        </summary>
        <div class="mission-group-items">${itemsHtml}</div>
      </details>`;
  }).join('');
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// silencioso=true → sem toast (triggers automáticos)
// silencioso=false → mostra toast de conclusão apenas quando o usuário clica "Ir fazer"
async function completarMissao(tipo, btn, silencioso = false) {
  // Verificação de cache local — nunca vai ao servidor se já sabe que está completa
  if (_missaoCache.has(tipo)) {
    if (btn) { btn.disabled = false; btn.textContent = 'Ir fazer'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    const r = await request('POST', `${API}/clube/missao`, { tipo });

    if (r.jaCompleta) {
      // Servidor confirmou que já está completa → só atualiza cache, sem toast
      _cacheMissao(tipo);
      if (btn) { btn.disabled = false; btn.textContent = 'Ir fazer'; }
      return;
    }

    // Missão recém completada
    _cacheMissao(tipo);
    if (!silencioso) {
      showToast(`+${r.pts} pts — "${r.label}" concluída! 🎯`, 'success');
    }
    _clubPontos = r.pontos;
    animarContador('ref-pontos', r.pontos);
    atualizarBotoesResgate(r.pontos);
    const badge = document.getElementById('nav-pontos');
    if (badge) { badge.textContent = r.pontos + ' pts'; badge.style.display = ''; }
    if (!silencioso) setTimeout(loadIndicacoes, 800);

  } catch (e) {
    if (!silencioso) {
      const msg = e.message || '';
      // Mensagens de "já concluída" ou missão inválida → silencioso
      if (!msg.includes('inválida') && !msg.includes('concluída') && !msg.includes('já')) {
        // Mostra a mensagem real do servidor (ex: "Faça login pelo menos 3 vezes.")
        showToast(msg || 'Não foi possível registrar a missão.', 'error');
      }
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Ir fazer'; }
    // Só adiciona ao cache se for erro de "já concluída" — outros erros permitem retentativa
    const msg = e.message || '';
    if (msg.includes('concluída') || msg.includes('já') || msg.includes('inválida')) {
      _cacheMissao(tipo);
    }
  }
}

function showToast(msg, tipo = 'success') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.innerHTML = msg;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-show'));
  setTimeout(() => {
    t.classList.remove('toast-show');
    setTimeout(() => t.remove(), 350);
  }, 3500);
}

function renderClubLog(log) {
  const lista = document.getElementById('ref-historico-list');
  if (!lista) return;
  if (!log.length) {
    lista.innerHTML = emptyState('fa-star', 'Nenhum ponto ganho ainda. Comece indicando um amigo!');
    return;
  }

  const tipoConfig = {
    indicacao: { icon: 'fa-user-plus',           bg: 'rgba(182,195,63,0.1)',  color: '#b6c33f' },
    pagamento: { icon: 'fa-file-invoice-dollar', bg: 'rgba(34,197,94,0.1)',   color: '#4ade80' },
    resgate:   { icon: 'fa-ticket',              bg: 'rgba(99,102,241,0.1)',  color: '#818cf8' },
    streak:    { icon: 'fa-fire',                bg: 'rgba(251,146,60,0.1)',  color: '#fb923c' },
    missao:    { icon: 'fa-list-check',          bg: 'rgba(129,140,248,0.1)', color: '#818cf8' },
    conquista: { icon: 'fa-trophy',              bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b' },
  };

  lista.innerHTML = log.map(item => {
    const cfg = tipoConfig[item.tipo] || { icon: 'fa-star', bg: 'rgba(255,255,255,0.05)', color: 'var(--lemon)' };
    const pos = item.pontos > 0;
    return `
      <div class="club-log-item">
        <div class="club-log-icon" style="background:${cfg.bg}">
          <i class="fa-solid ${cfg.icon}" style="color:${cfg.color}"></i>
        </div>
        <div class="club-log-info">
          <div class="club-log-desc">${item.descricao}</div>
          <div class="club-log-date">${new Date(item.data).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
        </div>
        <div class="club-log-pts ${pos ? 'positivo' : 'negativo'}">${pos ? '+' : ''}${item.pontos} pts</div>
      </div>`;
  }).join('');
}

function copiarLinkRef(btn) {
  if (!_refLink) return;
  navigator.clipboard.writeText(_refLink).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2200);
    completarMissao('compartilhar_link', null, false);
  });
}

function compartilharWhats() {
  if (!_refLink) return;
  const txt = encodeURIComponent(`Oi! Assina a Lemon Technology pelo meu link — sua solução em tecnologia 🍋: ${_refLink}`);
  window.open(`https://wa.me/?text=${txt}`, '_blank');
  completarMissao('indicar_whatsapp', null, false);
  completarMissao('embaixador', null, false);
}

function compartilharNativo() {
  if (!_refLink) return;
  if (navigator.share) {
    navigator.share({ title: 'Lemon Technology', text: 'Contrate com a Lemon Technology pelo meu link — sua solução em tecnologia!', url: _refLink }).catch(() => {});
  } else {
    copiarLinkRef(document.querySelector('.copy-btn'));
  }
}

async function resgatarBeneficio(tipo, btn) {
  const msg = document.getElementById('club-reward-msg');
  msg.innerHTML = '';
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;margin:0"></div>';
  try {
    const r = await request('POST', `${API}/clube/resgatar`, { tipo });
    _clubPontos = r.pontosRestantes;
    animarContador('ref-pontos', r.pontosRestantes);
    atualizarBotoesResgate(r.pontosRestantes);
    const badge = document.getElementById('nav-pontos');
    if (r.pontosRestantes > 0) { badge.textContent = r.pontosRestantes + ' pts'; badge.style.display = ''; }
    else badge.style.display = 'none';
    msg.innerHTML = `<div class="alert alert-success"><i class="fa-solid fa-check-circle"></i> <strong>${r.label}</strong> solicitado! Nossa equipe aplicará em breve. Pontos restantes: <strong>${r.pontosRestantes}</strong></div>`;
    // Recarrega o log
    loadIndicacoes();
  } catch (e) {
    msg.innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-xmark"></i> ${e.message || 'Erro ao resgatar.'}</div>`;
    btn.disabled = false;
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Resgatar';
  }
}

// ===== PWA =====

let _pwaPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaPrompt = e;
  const wrap = document.getElementById('pwa-install-wrap');
  if (wrap) wrap.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  const wrap = document.getElementById('pwa-install-wrap');
  if (wrap) wrap.classList.add('hidden');
  _pwaPrompt = null;
});

async function instalarApp() {
  if (!_pwaPrompt) return;
  _pwaPrompt.prompt();
  const { outcome } = await _pwaPrompt.userChoice;
  if (outcome === 'accepted') {
    _pwaPrompt = null;
    completarMissao('instalar_app', null, false);
    // Pedir permissão de notificação após instalar
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') completarMissao('ativar_notif', null, false);
      });
    }
  }
}

async function ativarNotificacoes() {
  if (!('Notification' in window)) return showToast('Seu navegador não suporta notificações.', 'warning');
  if (Notification.permission === 'granted') {
    completarMissao('ativar_notif', null, false);
    return showToast('Notificações já estão ativas!', 'success');
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') completarMissao('ativar_notif', null, false);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Exibe banner de indicação na landing se vier com ?ref=
(function () {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (!ref) return;
  // Guarda no sessionStorage para usar no cadastro mesmo após navegação
  sessionStorage.setItem('lemon_ref', ref);
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;
    background:linear-gradient(135deg,rgba(182,195,63,0.12),rgba(26,93,119,0.08));
    border-bottom:1px solid rgba(182,195,63,0.25);padding:10px 20px;
    display:flex;align-items:center;gap:10px;font-size:0.82rem;backdrop-filter:blur(12px);`;
  wrap.innerHTML = `<i class="fa-solid fa-gift" style="color:#b6c33f"></i>
    <span>Você foi indicado por <strong style="color:#41710b">${ref}</strong> — cadastre-se e aproveite!</span>
    <button onclick="this.parentElement.remove()" style="margin-left:auto;color:#7a80a0;font-size:1rem;background:none;border:none;cursor:pointer">✕</button>`;
  document.body.prepend(wrap);
})();

// ===== MODAL BOAS-VINDAS =====

async function _verificarEPedirPush() {
  try {
    if (!('Notification' in window) || !('PushManager' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') return;
    const visto = localStorage.getItem('lemon_push_prompt_ts');
    if (visto && Date.now() - Number(visto) < 24 * 60 * 60 * 1000) return;
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
    document.getElementById('btn-push-depois').onclick = () => modal.classList.add('hidden');
  } catch (_) {}
}

function mostrarBoasVindas() {
  const modal = document.getElementById('modal-boas-vindas');
  if (!modal) return;
  modal.classList.remove('hidden');
  // Anima entrada
  const box = modal.querySelector('.modal');
  if (box) {
    box.style.transform = 'scale(.88) translateY(20px)';
    box.style.opacity   = '0';
    box.style.transition = 'transform .4s cubic-bezier(.16,1,.3,1), opacity .3s';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        box.style.transform = 'scale(1) translateY(0)';
        box.style.opacity   = '1';
      });
    });
  }
}

function fecharBoasVindas(irParaClube = false) {
  const modal = document.getElementById('modal-boas-vindas');
  if (!modal) return;
  const box = modal.querySelector('.modal');
  if (box) {
    box.style.transform = 'scale(.92) translateY(10px)';
    box.style.opacity   = '0';
    setTimeout(() => modal.classList.add('hidden'), 280);
  } else {
    modal.classList.add('hidden');
  }
  if (irParaClube) {
    setTimeout(() => navTo('clube'), 300);
  }
}
