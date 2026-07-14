/**
 * MikroTik / conexão em tempo real e teste de velocidade.
 */
import { API, PLAN_SPEEDS, GAUGE_LEN } from './constants.js';
import { S, cacheMissao, missaoCacheHas } from './state.js';
import { request } from './http.js';
import { fmtBps, fmtBytes, fmtUptime, showToast, animarContador } from './format-ui.js';

export async function loadConexao() {
  if (S.connInterval) clearInterval(S.connInterval);
  await atualizarConexao();
  S.connInterval = setInterval(atualizarConexao, 3000);
}

async function atualizarConexao() {
  try {
    const d = await request('GET', `${API}/conexao`);
    const hero = document.getElementById('conn-hero');
    const badge = document.getElementById('conn-status-badge');
    const dot = document.getElementById('conn-status-dot');
    const txt = document.getElementById('conn-status-text');
    const navDot = document.getElementById('nav-conn-dot');

    if (d.online) {
      hero.className = 'conn-hero online';
      badge.className = 'conn-status-badge online';
      txt.textContent = 'Conectado';
      navDot.style.display = 'block';

      document.getElementById('conn-uptime').innerHTML =
        `<i class="fa-solid fa-clock"></i> ${fmtUptime(d.uptime)} conectado`;
      document.getElementById('conn-ip').textContent = d.ip || '—';
      document.getElementById('conn-mac').textContent = d.mac || '—';
      document.getElementById('conn-login').textContent = d.login || '—';

      const dlRate = document.getElementById('conn-dl-rate');
      const ulRate = document.getElementById('conn-ul-rate');
      dlRate.textContent = fmtBps(d.dlRate);
      ulRate.textContent = fmtBps(d.ulRate);
      dlRate.style.color = d.dlRate > 0 ? '#818cf8' : 'var(--text-muted)';
      ulRate.style.color = d.ulRate > 0 ? 'var(--lemon)' : 'var(--text-muted)';

      document.getElementById('conn-dl-max').textContent = d.maxDl ? `/${fmtBps(d.maxDl)}` : '';
      document.getElementById('conn-ul-max').textContent = d.maxUl ? `/${fmtBps(d.maxUl)}` : '';
      document.getElementById('conn-plan-dl').textContent = d.maxDl ? fmtBps(d.maxDl) : '—';
      document.getElementById('conn-plan-ul').textContent = d.maxUl ? fmtBps(d.maxUl) : '—';

      document.getElementById('conn-dl-bytes').textContent = fmtBytes(d.dlBytes);
      document.getElementById('conn-ul-bytes').textContent = fmtBytes(d.ulBytes);

      S.connMaxDl = Math.max(S.connMaxDl, d.dlBytes, 1);
      S.connMaxUl = Math.max(S.connMaxUl, d.ulBytes, 1);
      const dlPct = Math.min((d.dlBytes / S.connMaxDl) * 100, 100);
      const ulPct = Math.min((d.ulBytes / S.connMaxUl) * 100, 100);
      document.getElementById('conn-dl-bar').style.width = dlPct + '%';
      document.getElementById('conn-ul-bar').style.width = ulPct + '%';

      const droppedWrap = document.getElementById('conn-dropped');
      if (d.dropped > 0) {
        droppedWrap.style.display = 'flex';
        document.getElementById('conn-dropped-val').textContent = d.dropped.toLocaleString('pt-BR');
      } else {
        droppedWrap.style.display = 'none';
      }
    } else {
      hero.className = 'conn-hero offline';
      badge.className = 'conn-status-badge offline';
      txt.textContent = 'Offline';
      navDot.style.display = 'none';
      document.getElementById('conn-uptime').textContent = '';
      document.getElementById('conn-ip').textContent = '—';
      document.getElementById('conn-mac').textContent = '—';
      document.getElementById('conn-login').textContent = '—';
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

export function navToVelocidade() {
  loadVelocidade();
}

export function loadVelocidade() {
  renderSpeedHistory();
  const planSpeed = getPlanSpeed();
  // Dial até ~1.5× o plano (mín. 400) — deixa o arco chegar perto do fim no limite real do plano
  S.gaugeMax = planSpeed
    ? Math.max(400, Math.ceil((planSpeed * 1.5) / 100) * 100)
    : 1000;
  if (planSpeed) {
    document.getElementById('cmp-plano').textContent = `${planSpeed} Mbps`;
  }
  detectarISP();
}

async function detectarISP() {
  // Usa cache de sessão para não bater na API em toda visita
  const cached = sessionStorage.getItem('lemon_isp_v1');
  if (cached) {
    try { _renderISP(JSON.parse(cached)); return; } catch (_) {}
  }
  try {
    const r = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
    if (!r.ok) throw new Error('status ' + r.status);
    const d = await r.json();
    sessionStorage.setItem('lemon_isp_v1', JSON.stringify(d));
    _renderISP(d);
  } catch (_) {
    _renderISP(null);
  }
}

function _renderISP(d) {
  const nameEl = document.getElementById('st-isp-name');
  const ipEl   = document.getElementById('st-isp-ip');
  if (!nameEl || !ipEl) return;
  if (!d) {
    nameEl.textContent = 'ISP desconhecido';
    ipEl.textContent   = '';
    return;
  }
  // Remove prefixo ASN: "AS264499 Giganet Telecom Ltda" → "Giganet Telecom Ltda"
  const raw  = d.org || d.asn || '';
  const name = raw.replace(/^AS\d+\s+/i, '') || 'Provedor local';
  nameEl.textContent = name.length > 24 ? name.slice(0, 22) + '…' : name;
  ipEl.textContent   = d.ip || '';
}

function getPlanSpeed() {
  if (!S.clienteData) return null;
  const mkDl = Number(S.clienteData.plano_download_mbps);
  if (Number.isFinite(mkDl) && mkDl > 0) return mkDl;
  const plano = (S.clienteData.plano || S.clienteData.plano_nome || '').toLowerCase();
  for (const [k, v] of Object.entries(PLAN_SPEEDS)) {
    if (plano.includes(k)) return v;
  }
  return null;
}

const DIAL_CIRC = 2 * Math.PI * 120; // r=120 no SVG ≈ 753.98

/** Mapeia Mbps → preenchimento do dial (0–1). Sqrt deixa velocidades médias mais legíveis. */
function rateToGauge(rateMbps) {
  const max = Math.max(S.gaugeMax || 1000, 1);
  const linear = Math.min(Math.max(rateMbps, 0) / max, 1);
  return Math.sqrt(linear);
}

function setGauge(pct) {
  const arc = document.getElementById('st-arc-fill');
  if (!arc) return;
  const p = Math.min(Math.max(pct, 0), 1);
  arc.style.strokeDasharray = String(DIAL_CIRC);
  arc.style.strokeDashoffset = String(DIAL_CIRC * (1 - p));
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

// ── Helpers de medição estável (estilo Speedtest.net) ─────────────────────────

/** Percentil p (0–1) de um array já ordenado ou desordenado. */
function percentil(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[idx];
}

async function medirPing(amostras = 12) {
  // Descarta o primeiro (TCP cold start) e usa mediana + jitter das restantes
  const tempos = [];
  for (let i = 0; i < amostras; i++) {
    const t0 = performance.now();
    await fetch('/speedtest/ping?t=' + Date.now(), { cache: 'no-store' });
    tempos.push(performance.now() - t0);
    await new Promise(r => setTimeout(r, 40));
  }
  const useful = tempos.slice(1); // descarta 1ª medição (cold)
  const sorted = [...useful].sort((a, b) => a - b);
  const ping = Math.round(sorted[Math.floor(sorted.length / 2)]);
  let jitter = 0;
  for (let i = 1; i < useful.length; i++) jitter += Math.abs(useful[i] - useful[i - 1]);
  jitter = Math.round(jitter / (useful.length - 1));
  return { ping, jitter };
}

async function medirDownload(onRate) {
  const STREAMS   = 4;
  const MB_EACH   = 25;
  const WARMUP_MS = 2000; // descarta primeiros 2 s (TCP slow start)
  const SAMPLE_MS = 200;  // janela de amostragem

  // Amostras de taxa instantânea (Mbps) pós-warmup
  const amostras = [];
  let totalBytes  = 0;
  let warmupDone  = false;
  let bytesNoWarmup = 0;
  const t0 = performance.now();
  let lastSampleTs    = t0;
  let lastSampleBytes = 0;

  function onChunk(size) {
    totalBytes += size;
    const now = performance.now();

    if (!warmupDone && now - t0 >= WARMUP_MS) {
      warmupDone     = true;
      bytesNoWarmup  = totalBytes;
      lastSampleTs   = now;
      lastSampleBytes = totalBytes;
    }

    const dt = now - lastSampleTs;
    if (dt >= SAMPLE_MS) {
      const rate = ((totalBytes - lastSampleBytes) * 8) / (dt / 1000) / 1e6;
      if (rate > 0) {
        if (warmupDone) amostras.push(rate);
        onRate(Math.max(0, rate));
      }
      lastSampleTs    = now;
      lastSampleBytes = totalBytes;
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

  // Resultado: percentil 90 das amostras pós-warmup (igual ao Speedtest.net)
  if (amostras.length >= 4) return percentil(amostras, 0.9);
  // Fallback: média simples se poucos dados
  const elapsed = (performance.now() - t0) / 1000;
  return (totalBytes * 8) / elapsed / 1e6;
}

function xhrUploadStream(data, onRate) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const t0 = performance.now();
    let lastLoaded = 0;
    let lastTs = t0;
    const SAMPLE_MS = 200;
    const WARMUP_MS = 1500;
    const amostras  = [];

    xhr.upload.onprogress = e => {
      const now = performance.now();
      const dt  = now - lastTs;
      if (dt >= SAMPLE_MS && e.loaded > lastLoaded) {
        const rate = ((e.loaded - lastLoaded) * 8) / (dt / 1000) / 1e6;
        if (now - t0 > WARMUP_MS && rate > 0) amostras.push(rate);
        lastLoaded = e.loaded;
        lastTs     = now;
        onRate(Math.max(0, rate), amostras);
      }
    };

    xhr.onload = () => resolve({
      bytes:    data.byteLength,
      elapsed:  (performance.now() - t0) / 1000,
      amostras,
    });
    xhr.onerror = reject;
    xhr.open('POST', '/speedtest/upload?t=' + Date.now());
    xhr.send(data);
  });
}

async function medirUpload(onRate) {
  const STREAMS = 3;
  const MB_EACH = 12;
  const chunk   = new Uint8Array(MB_EACH * 1024 * 1024);
  const rates   = new Array(STREAMS).fill(0);
  const todasAmostras = [];

  function onStreamRate(idx, rate, amostras) {
    rates[idx] = rate;
    todasAmostras.push(...(amostras || []));
    onRate(rates.reduce((a, b) => a + b, 0));
  }

  await Promise.all(
    Array.from({ length: STREAMS }, (_, i) =>
      xhrUploadStream(chunk.slice(), (rate, am) => onStreamRate(i, rate, am)),
    ),
  );

  // Percentil 90 das amostras pós-warmup
  if (todasAmostras.length >= 4) return percentil(todasAmostras, 0.9);
  // Fallback: soma das médias por stream
  return rates.reduce((a, b) => a + b, 0);
}

export async function iniciarSpeedTest() {
  if (S.speedTesting) return;
  S.speedTesting = true;

  const ringBtn   = document.getElementById('st-ring-btn');
  const ringOuter = document.getElementById('st-ring-outer');
  const ringMid   = document.getElementById('st-ring-mid');
  const phase = document.getElementById('speed-phase');
  const disp  = document.getElementById('speed-display');
  const unit  = document.getElementById('speed-unit');
  const pWrap = document.getElementById('speed-progress-wrap');
  const pFill = document.getElementById('speed-progress-fill');

  document.getElementById('speed-results').classList.add('hidden');
  document.getElementById('speed-compare').classList.add('hidden');
  ringBtn.classList.add('testing');
  ringOuter.classList.add('testing');
  ringMid.classList.add('testing');
  pWrap.classList.remove('hidden');
  setGauge(0);
  unit.textContent = 'Mbps';

  let pingMs = 0;
  let jitterMs = 0;
  let dlMbps = 0;
  let ulMbps = 0;

  try {
    phase.textContent = 'Medindo latência...';
    pFill.style.width = '5%';
    disp.textContent = '--';

    let pingPulse = 0;
    let pingDir = 1;
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

    phase.textContent = 'Aquecendo download...';
    unit.textContent = 'Mbps ↓';
    disp.textContent = '0.0';
    pFill.style.width = '20%';

    let dlPeak = 0;
    dlMbps = await medirDownload(rate => {
      if (rate > dlPeak) dlPeak = rate;
      disp.textContent = rate.toFixed(1);
      setGauge(rateToGauge(rate));
      const prog = 20 + Math.min(rateToGauge(rate) * 45, 45);
      pFill.style.width = prog + '%';
      if (phase.textContent === 'Aquecendo download...') phase.textContent = 'Testando download...';
    });

    await new Promise(r => {
      animateSpeed(parseFloat(disp.textContent) || dlMbps, dlMbps, 500, val => {
        disp.textContent = val.toFixed(1);
        setGauge(rateToGauge(val));
      });
      setTimeout(r, 550);
    });
    document.getElementById('res-download').textContent = dlMbps.toFixed(1);
    pFill.style.width = '65%';

    await new Promise(r => setTimeout(r, 400));

    phase.textContent = 'Aquecendo upload...';
    unit.textContent = 'Mbps ↑';
    disp.textContent = '0.0';
    setGauge(0);
    pFill.style.width = '68%';

    ulMbps = await medirUpload(rate => {
      disp.textContent = rate.toFixed(1);
      setGauge(rateToGauge(rate));
      const prog = 68 + Math.min(rateToGauge(rate) * 27, 27);
      pFill.style.width = prog + '%';
      if (phase.textContent === 'Aquecendo upload...') phase.textContent = 'Testando upload...';
    });

    await new Promise(r => {
      animateSpeed(parseFloat(disp.textContent) || ulMbps, ulMbps, 500, val => {
        disp.textContent = val.toFixed(1);
        setGauge(rateToGauge(val));
      });
      setTimeout(r, 550);
    });
    document.getElementById('res-upload').textContent = ulMbps.toFixed(1);
    pFill.style.width = '100%';

    phase.textContent = '✓ CONCLUÍDO';
    unit.textContent = 'Mbps ↓';
    animateSpeed(ulMbps, dlMbps, 700, val => {
      disp.textContent = val.toFixed(1);
      setGauge(rateToGauge(val));
    });
    setTimeout(() => { phase.textContent = 'TESTAR NOVAMENTE'; unit.textContent = 'Mbps'; }, 3000);

    setTimeout(async () => {
      document.getElementById('speed-results').classList.remove('hidden');
      exibirComparacao(dlMbps, ulMbps);
      salvarHistoricoSpeed(dlMbps, ulMbps, pingMs, jitterMs);
      renderSpeedHistory();
      try {
        const stRes = await request('POST', `${API}/speedtest/registrar`, {
          dl: dlMbps,
          ul: ulMbps,
          ping: pingMs,
          planSpeed: getPlanSpeed() || 0,
        });
        // Aquece o cache com todas as missões já concluídas
        if (stRes.missoesConcluidas) {
          stRes.missoesConcluidas.forEach(id => cacheMissao(id));
        }
        // Toasts APENAS para missões ganhas NESTE teste (novasMissoes)
        const labelMissao = {
          speedtest:          'Primeiro teste de velocidade!',
          speedtest_3x:       '3 testes realizados!',
          speedtest_5x:       '5 testes realizados!',
          speedtest_10x:      '10 testes realizados!',
          speedtest_manha:    'Teste matinal concluído!',
          speedtest_noite:    'Teste noturno concluído!',
          speedtest_100:      'Velocidade máxima atingida!',
          speedtest_excelente:'Velocidade excelente!',
          speedtest_semana:   'Testador assíduo!',
        };
        for (const id of (stRes.novasMissoes || [])) {
          if (labelMissao[id]) showToast(`+pts — Missão "${labelMissao[id]}" 🎯`, 'success');
        }
        if (stRes.pontos && stRes.novosPts > 0) {
          S.clubPontos = stRes.pontos;
          animarContador('ref-pontos', stRes.pontos);
        }
      } catch {}
    }, 800);
  } catch (err) {
    phase.textContent = 'ERRO';
    disp.textContent = '--';
    console.error('SpeedTest erro:', err);
  } finally {
    S.speedTesting = false;
    ringBtn.classList.remove('testing');
    ringOuter.classList.remove('testing');
    ringMid.classList.remove('testing');
    // Garante que nenhum transform residual fique no anel/texto
    ringMid.style.transform = '';
    ringBtn.style.transform = '';
    setTimeout(() => pWrap.classList.add('hidden'), 1500);
  }
}

function exibirComparacao(dlMbps, ulMbps) {
  const planSpeed = getPlanSpeed();
  const section = document.getElementById('speed-compare');
  section.classList.remove('hidden');

  document.getElementById('cmp-medida').textContent = dlMbps.toFixed(1) + ' Mbps';

  const maxRef = planSpeed || S.gaugeMax;
  const pct = Math.min(dlMbps / maxRef, 1.05);
  const barFill = document.getElementById('cmp-bar');
  setTimeout(() => {
    barFill.style.width = Math.min(pct * 100, 100) + '%';
  }, 100);

    if (planSpeed) {
    document.getElementById('cmp-plano').textContent = planSpeed + ' Mbps';
    document.getElementById('cmp-plan-marker').style.left = '100%';

    const ratio = dlMbps / planSpeed;
    const badge = document.getElementById('cmp-badge');
    let cls;
    let icon;
    let msg;
    // Missões de velocidade (speedtest_100, speedtest_excelente) são concedidas
    // pelo servidor em /speedtest/registrar — não duplicar a chamada aqui.
    if (ratio >= 0.9) {
      cls = 'badge-excelente';
      icon = 'fa-circle-check';
      msg = `Excelente! ${dlMbps.toFixed(0)} Mbps — dentro do esperado para seu plano.`;
    } else if (ratio >= 0.7) {
      cls = 'badge-bom';
      icon = 'fa-thumbs-up';
      msg = `Boa velocidade! ${Math.round(ratio * 100)}% do plano contratado.`;
    } else if (ratio >= 0.5) {
      cls = 'badge-regular';
      icon = 'fa-triangle-exclamation';
      msg = `Abaixo do esperado (${Math.round(ratio * 100)}%). Verifique o roteador.`;
    } else {
      cls = 'badge-ruim';
      icon = 'fa-circle-xmark';
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
  S.speedHistory.unshift({
    dl: dl.toFixed(1),
    ul: ul.toFixed(1),
    ping,
    jitter: jitter || 0,
    dt:
      now.toLocaleDateString('pt-BR') +
      ' ' +
      now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  });
  S.speedHistory = S.speedHistory.slice(0, 10);
  localStorage.setItem('lemon_speed_hist', JSON.stringify(S.speedHistory));
}

function renderSpeedHistory() {
  const list = document.getElementById('speed-history-list');
  if (!list) return;
  if (S.speedHistory.length === 0) {
    list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-gauge"></i><p>Nenhum teste ainda</p></div>';
    return;
  }
  list.innerHTML = S.speedHistory
    .map(
      h => `
    <div class="speed-history-item">
      <div class="speed-history-dt">${h.dt}</div>
      <div class="speed-history-vals">
        <span class="speed-history-val" style="color:#818cf8"><i class="fa-solid fa-arrow-down"></i>${h.dl} Mbps</span>
        <span class="speed-history-val" style="color:var(--lemon)"><i class="fa-solid fa-arrow-up"></i>${h.ul} Mbps</span>
        <span class="speed-history-val" style="color:#22d3ee"><i class="fa-solid fa-clock"></i>${h.ping}ms</span>
        ${h.jitter !== undefined ? `<span class="speed-history-val" style="color:#fb923c"><i class="fa-solid fa-wave-square"></i>${h.jitter}ms</span>` : ''}
      </div>
    </div>
  `,
    )
    .join('');
}

export function limparHistoricoSpeed() {
  S.speedHistory = [];
  localStorage.removeItem('lemon_speed_hist');
  renderSpeedHistory();
}
