/**
 * Seção Perfil: dados pessoais, Lemon Club e carteira de cartões.
 */
import { API } from './constants.js';
import { S } from './state.js';
import { request } from './http.js';
import { fmt, fmtData, emptyState, showAlert } from './format-ui.js';

// ─── helpers internos ────────────────────────────────────────────────────────

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

// ─── funções exportadas ───────────────────────────────────────────────────────

export async function loadPerfil() {
  const container = document.getElementById('perfil-dados');
  container.innerHTML = '<div class="spinner"></div>';
  try {
    const me = S.clienteData || await request('GET', `${API}/me`);
    S.clienteData = me;

    const initials = (me.nome || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const avatarEl = document.getElementById('perfil-avatar-initials');
    if (avatarEl) avatarEl.textContent = initials;

    const nomeEl = document.getElementById('perfil-hero-name');
    if (nomeEl) nomeEl.textContent = me.nome || '—';
    const loginEl = document.getElementById('perfil-hero-login');
    if (loginEl) loginEl.textContent = '@' + (me.login || '');

    const planEl = document.getElementById('perfil-stat-plano');
    if (planEl) planEl.textContent = me.plano || me.contrato || '—';
    const desdeEl = document.getElementById('perfil-stat-desde');
    if (desdeEl) desdeEl.textContent = fmtData(me.cadastro) || '—';

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

    document.getElementById('perfil-email').value       = me.email       || '';
    document.getElementById('perfil-telefone').value    = me.fone        || me.telefone || '';
    document.getElementById('perfil-celular').value     = me.celular     || '';
    document.getElementById('perfil-endereco').value    = me.endereco    || '';
    document.getElementById('perfil-numero').value      = me.numero      || '';
    document.getElementById('perfil-cep').value         = me.cep         || '';
    document.getElementById('perfil-complemento').value = me.complemento || '';
    document.getElementById('perfil-bairro').value      = me.bairro      || '';
    document.getElementById('perfil-cidade').value      = me.cidade      || '';

    await _carregarPerfilClube();
    loadCarteira();
  } catch {
    container.innerHTML = emptyState('fa-triangle-exclamation', 'Erro ao carregar perfil');
  }
}

export async function _carregarPerfilClube() {
  try {
    const stats = await request('GET', `${API}/clube/stats`);

    const nv = stats.nivel || {};
    const nivelEl = document.getElementById('perfil-badge-nivel');
    if (nivelEl) {
      nivelEl.textContent = (nv.icon || '') + ' ' + (nv.label || '');
      nivelEl.style.color = nv.color || 'var(--lemon)';
      nivelEl.style.borderColor = (nv.color || 'var(--lemon)') + '44';
      nivelEl.style.background  = (nv.color || 'var(--lemon)') + '11';
    }
    const ptsEl = document.getElementById('perfil-badge-pts');
    if (ptsEl) ptsEl.textContent = (stats.pontos || 0) + ' pts';

    const streakEl = document.getElementById('perfil-stat-streak');
    if (streakEl) streakEl.textContent = stats.streak || 0;
    const missoesEl = document.getElementById('perfil-stat-missoes');
    if (missoesEl) missoesEl.textContent = (stats.completedMissions || []).length;

    const clubNivelEl = document.getElementById('perfil-clube-nivel-label');
    if (clubNivelEl) {
      clubNivelEl.textContent = (nv.icon || '') + ' ' + (nv.label || '');
      clubNivelEl.style.color = nv.color || 'var(--lemon)';
    }
    const clubPtsEl = document.getElementById('perfil-clube-pts');
    if (clubPtsEl) clubPtsEl.textContent = stats.pontos || 0;

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

export function toggleCarteiraAddForm(forceClose) {
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
    void window.preencherCarteiraMpAviso?.();
  }
  if (btn) btn.disabled = !panel.classList.contains('hidden');
}

export async function loadCarteira() {
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

export async function confirmarCarteiraAdd() {
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
    const cardToken = await window._mpCriarCardToken(pub, { nome, numero, mes, ano, cvv, cpf });
    const queroDebitoAuto = document.getElementById('carteira-debito-auto')?.checked;
    await request('POST', `${API}/carteira/cartao`, { cardToken });

    const feedback = document.getElementById('carteira-feedback');
    const limparForm = () => {
      document.getElementById('carteira-nome').value = '';
      document.getElementById('carteira-num').value = '';
      document.getElementById('carteira-mes').value = '';
      document.getElementById('carteira-ano').value = '';
      document.getElementById('carteira-cvv').value = '';
      const chk = document.getElementById('carteira-debito-auto');
      if (chk) chk.checked = false;
    };

    if (queroDebitoAuto) {
      try {
        const sub = await request('POST', `${API}/carteira/debito-automatico`, {});
        if (sub.initPoint) {
          limparForm();
          toggleCarteiraAddForm(true);
          await loadCarteira();
          window.location.href = sub.initPoint;
          return;
        }
        throw new Error('Link do Mercado Pago não retornado.');
      } catch (e2) {
        const msg = e2.message || 'Não foi possível abrir o débito automático.';
        if (feedback) {
          showAlert('carteira-feedback', `Cartão salvo na carteira. ${msg}`, 'warning');
        } else alert(`Cartão salvo. ${msg}`);
      }
    } else if (feedback) {
      showAlert(
        'carteira-feedback',
        'Cartão aceito pelo Mercado Pago e guardado na carteira. Não houve cobrança agora; na primeira compra o banco pode pedir uma confirmação a mais.',
        'success',
      );
    }

    limparForm();
    toggleCarteiraAddForm(true);
    await loadCarteira();
  } catch (e) {
    alert(e.message || 'Não foi possível salvar o cartão.');
  } finally {
    if (sbtn) { sbtn.disabled = false; sbtn.innerHTML = '<i class="fa-solid fa-lock"></i> Salvar na carteira'; }
  }
}

export async function removerCartaoCarteira(id) {
  if (!confirm('Remover este cartão da sua carteira?')) return;
  try {
    await request('DELETE', `${API}/carteira/cartao/${id}`);
    loadCarteira();
  } catch (e) {
    alert(e.message || 'Não foi possível remover o cartão.');
  }
}

/** Registra o listener do formulário de edição de perfil. */
export function initPerfil() {
  const form = document.getElementById('form-perfil');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
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
      window.completarMissao && window.completarMissao('mudar_dados', null, false);
    } catch (err) {
      showAlert('perfil-feedback', err.message || 'Erro ao salvar dados.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Alterações';
    }
  });
}
