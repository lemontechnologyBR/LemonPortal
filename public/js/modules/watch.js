/**
 * Seção Watch TV: renderização de assinaturas, ativação free e modal de e-mail.
 */
import { API, FEATURE_WATCH_TV } from './constants.js';
import { S } from './state.js';
import { request } from './http.js';
import { showToast } from './format-ui.js';

export function watchFormatDate(d) {
  if (!d) return '';
  const parts = d.split(/[\s-T]/);
  if (parts.length >= 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
  return d;
}

export function watchRenderTickets(list, statusInfo, pacotesMap) {
  pacotesMap = pacotesMap || {};
  const nome = (S.clienteData && (S.clienteData.nome_res || S.clienteData.nome)) || '';
  const plano = (S.clienteData && S.clienteData.plano) || (statusInfo && statusInfo.planoMk) || '';

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
    const initials = nome ? nome.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() : '?';
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
    const dataCriacaoUser = t.DataCriacaoUsuario || '';

    const fields = [];
    const pacoteNome = pacotesMap[String(pacoteId)] || '';
    if (pacoteId) fields.push({ icon: 'fa-box-open', label: 'Pacote', value: pacoteNome ? pacoteNome + ' <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">#' + pacoteId + '</span>' : String(pacoteId), color: 'var(--lemon-dark)' });
    if (tipo) fields.push({ icon: 'fa-tag', label: 'Tipo', value: tipo, color: '#6366f1' });
    if (ticket) fields.push({ icon: 'fa-ticket', label: 'Ticket', value: ticket, color: 'var(--blue,#1a5d77)' });
    if (email) fields.push({ icon: 'fa-envelope', label: 'E-mail', value: email, color: '#0891b2' });
    if (phone) {
      let phoneFormatted = phone;
      const digits = phone.replace(/\D/g, '');
      if (digits.length === 13) phoneFormatted = '+' + digits.slice(0, 2) + ' (' + digits.slice(2, 4) + ') ' + digits.slice(4, 9) + '-' + digits.slice(9);
      else if (digits.length === 11) phoneFormatted = '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7);
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
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + statusBadge + '</div>' +
      '</div>' +
      '<div style="padding:4px 20px 8px">' + rows + '</div>' +
    '</div>';
  }).join('');

  return html;
}

export async function watchAtivarFree() {
  if (!FEATURE_WATCH_TV) {
    showToast('Watch TV está temporariamente indisponível.', 'info');
    return;
  }
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

export function watchShowEmailModal() {
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

export async function loadWatchBrasil() {
  const alertEl = document.getElementById('watch-brasil-alert');
  const bodyEl = document.getElementById('watch-brasil-body');
  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }
  if (!bodyEl) return;
  if (!FEATURE_WATCH_TV) {
    bodyEl.innerHTML =
      '<div style="text-align:center;padding:32px 16px">' +
      '<i class="fa-solid fa-plug-circle-xmark" style="font-size:2rem;color:var(--text-muted);margin-bottom:12px;display:block"></i>' +
      '<p style="font-size:.92rem;font-weight:600;margin-bottom:6px">Watch TV temporariamente indisponível</p>' +
      '<p style="font-size:.85rem;color:var(--text-muted);line-height:1.45">Volte mais tarde ou fale com o suporte Lemon.</p>' +
      '</div>';
    return;
  }
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
