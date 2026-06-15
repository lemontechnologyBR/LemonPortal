/**
 * Seção Dashboard: notícias RSS, clima, cotação, feriados, banner de vencimento, avisos.
 */
import { API, FEATURE_WATCH_TV } from './constants.js';
import { S } from './state.js';
import { request } from './http.js';
import { fmt, fmtData, fmtMoeda, escHtml, daysUntilVenc } from './format-ui.js';

// ─── helpers internos ────────────────────────────────────────────────────────

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
  vp.addEventListener('mouseenter', () => { paused = true; });
  vp.addEventListener('mouseleave', () => { paused = false; });
  vp.addEventListener('touchstart', () => { paused = true; }, { passive: true });
  vp.addEventListener('touchend', () => {
    setTimeout(() => { paused = false; }, 3000);
  }, { passive: true });
}

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

// ─── funções exportadas ───────────────────────────────────────────────────────

export async function loadDashHeadlinesFromRss() {
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

export async function loadDashCotacao() {
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

export async function loadDashFeriados() {
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

export async function loadDashWeatherOpenMeteo() {
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

    const payload = { hourly: slice, daily };

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

/** MK devolve “abertas” e “vencidas” em rotas diferentes; o banner precisa da união. */
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

export function renderDashProximoVencimento(abertasSettled) {
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

  const days = daysUntilVenc(next.datavenc);
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

export function renderDashAvisos(avisosSettled) {
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

export async function loadDashboard() {
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
      S.clienteData = me.value;
      const primeiroNome = (S.clienteData.nome_res || S.clienteData.nome || '').split(' ')[0];

      document.getElementById('dash-nome').textContent = primeiroNome;
      document.getElementById('topbar-nome').textContent = primeiroNome;

      const initials = (S.clienteData.nome || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
      const avatarEl = document.getElementById('topbar-avatar');
      if (avatarEl) avatarEl.textContent = initials;

      const statusTxt = document.getElementById('dash-status');
      const statusDot = document.getElementById('dash-status-dot');
      const pill = document.getElementById('dash-status-pill');
      const tileWatch = document.getElementById('tile-watch');
      const tileWatchStatus = document.getElementById('tile-watch-status');
      if (!FEATURE_WATCH_TV) {
        if (pill) pill.classList.add('hidden');
        if (tileWatch) tileWatch.classList.add('hidden');
      } else {
        if (pill) pill.classList.remove('hidden');
        if (tileWatch) tileWatch.classList.remove('hidden');
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
            if (tileWatchStatus) { tileWatchStatus.textContent = hasActive ? 'Ativo' : ''; tileWatchStatus.classList.toggle('hidden', !hasActive); }
          } else {
            if (statusTxt) statusTxt.textContent = 'Sem Watch';
            if (statusDot) { statusDot.classList.remove('online'); statusDot.classList.add('offline'); }
          }
        } catch {
          if (statusTxt) statusTxt.textContent = 'Sem Watch';
          if (statusDot) { statusDot.classList.remove('online'); statusDot.classList.add('offline'); }
        }
      }

      document.getElementById('dash-plano').textContent = S.clienteData.plano || '--';
      document.getElementById('dash-venc').textContent  = S.clienteData.venc ? `Dia ${S.clienteData.venc}` : '--';
    }

    const { titulos: titulosPendentes, fetchOk: fatFetchOk } = _dashMergeTitulosPortal(abertas, vencidas);
    if (fatFetchOk) {
      const count = titulosPendentes.length;
      document.getElementById('dash-faturas').textContent = count;
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
