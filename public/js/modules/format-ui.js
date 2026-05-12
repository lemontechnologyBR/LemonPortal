export function fmt(str) {
  if (!str) return '--';
  return String(str);
}

export function fmtData(str) {
  if (!str) return '--';
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString('pt-BR');
}

export function fmtMoeda(val) {
  if (!val) return 'R$ 0,00';
  const n = parseFloat(val);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtBps(bps) {
  bps = Number(bps) || 0;
  if (bps >= 1e9) return (bps / 1e9).toFixed(2) + ' Gbps';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' Kbps';
  return bps + ' bps';
}

export function fmtBytes(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + ' TB';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

export function fmtUptime(str) {
  if (!str) return '';
  const d = str.match(/(\d+)d/)?.[1];
  const h = str.match(/(\d+)h/)?.[1];
  const m = str.match(/(\d+)m/)?.[1];
  const s = str.match(/(\d+)s/)?.[1];
  const parts = [];
  if (d) parts.push(`${d} dia${d !== '1' ? 's' : ''}`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !d && !h) parts.push(`${s}s`);
  return parts.join(' ') || str;
}

export function showLoading() {
  document.getElementById('overlay-loading').classList.remove('hidden');
}
export function hideLoading() {
  document.getElementById('overlay-loading').classList.add('hidden');
}

export function showAlert(elId, msg, type = 'error') {
  const el = document.getElementById(elId);
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

export function emptyState(icon, msg) {
  return `<div class="empty-state"><i class="fa-solid ${icon}"></i><p>${msg}</p></div>`;
}

export function closeModal(e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
  }
}

export function closeModalDirect() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
}

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function showToast(msg, tipo = 'success') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none';
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

export function animarContador(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent, 10) || 0;
  const dur = 700;
  const t0 = performance.now();
  function step(now) {
    const p = Math.min((now - t0) / dur, 1);
    el.textContent = Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export async function copiar(texto, btn) {
  const ok = await _copiarTexto(texto);
  if (ok && btn) {
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove('copied');
    }, 2500);
  } else if (!ok) {
    _abrirModalCopia(texto);
  }
}

async function _copiarTexto(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      /* cai para execCommand */
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const execOk = document.execCommand('copy');
    document.body.removeChild(ta);
    if (execOk) return true;
  } catch {
    /* ignora */
  }
  return false;
}

export function _abrirModalCopia(texto) {
  const existing = document.getElementById('_modal-copia-manual');
  if (existing) existing.remove();
  const m = document.createElement('div');
  m.id = '_modal-copia-manual';
  m.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px';
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
  setTimeout(() => {
    const ta = document.getElementById('_copia-ta');
    if (ta) {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
    }
  }, 150);
}

export { _copiarTexto };

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _dashLocalMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysUntilVenc(datavencStr) {
  if (!datavencStr) return null;
  const due = new Date(datavencStr);
  if (isNaN(due.getTime())) return null;
  const dueDay = _dashLocalMidnight(due);
  const today = _dashLocalMidnight(new Date());
  return Math.round((dueDay - today) / 86400000);
}
