/**
 * Seção Faturas: listagem, abas (abertas/vencidas/pagas) e modal de detalhe.
 */
import { API, MP_LOGO_IMG } from './constants.js';
import { S } from './state.js';
import { request } from './http.js';
import { fmt, fmtData, fmtMoeda, emptyState, escHtml, daysUntilVenc, showToast } from './format-ui.js';

// Tolerância de R$ ao verificar se os valores do cupom Lemon Club da API fecham com o subtotal.
const CUPOM_RECONCILE_TOLERANCE = 0.071;

// Cache de títulos indexados por UUID — evita JSON.stringify inline no onclick e garante dados
// disponíveis mesmo quando a requisição de detalhe falha.
const _faturaCacheMap = new Map();

// ─── estado ──────────────────────────────────────────────────────────────────

// Garante que clienteData esteja carregado antes de renderizar contexto do cliente.
async function _ensureClienteProfile() {
  if (S.clienteData) return;
  try {
    S.clienteData = await request('GET', `${API}/me`);
  } catch (_) {}
}

// ─── helpers internos ────────────────────────────────────────────────────────

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
    Math.abs(apiPag + apiDesc - subAntesCupom) <= CUPOM_RECONCILE_TOLERANCE;
  if (apiFecha) {
    return { subAntesCupom, valorDesconto: apiDesc, valorAPagar: apiPag };
  }
  return { subAntesCupom, valorDesconto: descCalc, valorAPagar: pagarCalc };
}

export function faturaValorMercadoPago(t, isPago) {
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

/** Valor efetivo a cobrar no portal (principal c/ ou s/ cupom + multa + mora − desconto MK). */
export function faturaValorTotalCobrancaPortal(t, isPago) {
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

function faturaListaMetaPrazo(t, tipo) {
  if (tipo === 'paga') {
    if (t.datapag) {
      return `<span class="fatura-meta-prazo fatura-meta-prazo--ok"><i class="fa-solid fa-circle-check"></i> Pago em ${fmtData(t.datapag)}</span>`;
    }
    return '';
  }
  const days = daysUntilVenc(t.datavenc);
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

export function faturaItemHtml(t, tipo) {
  _faturaCacheMap.set(String(t.uuid), t);

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
    <div class="fatura-item${comCupomLemon ? ' fatura-item--cupom-lemon' : ''}" role="button" tabindex="0" onclick="abrirFatura('${escHtml(String(t.uuid))}')">
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

// ─── loaders de aba ──────────────────────────────────────────────────────────

async function loadFaturasAbertas() {
  _faturaCacheMap.clear();
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

// ─── funções exportadas ───────────────────────────────────────────────────────

export async function loadFaturas() {
  if (!S.faturasCarregadas.abertas) {
    loadFaturasAbertas();
  }
}

/** Força recarregamento das faturas mesmo que já tenham sido carregadas antes (ex.: após resgate de cupom). */
export async function forceReloadFaturas() {
  S.faturasCarregadas.abertas = false;
  S.faturasCarregadas.vencidas = false;
  S.faturasCarregadas.pagas = false;
  await loadFaturasAbertas();
}

export function switchTab(btn, tab) {
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

export async function abrirFatura(uuid, dataInline) {
  const modal   = document.getElementById('modal-fatura');
  const content = document.getElementById('modal-fatura-content');

  content.innerHTML = `<div style="text-align:center;padding:32px 0"><div class="spinner"></div><p style="color:var(--text-muted);margin-top:12px;font-size:.85rem">Carregando fatura...</p></div>`;
  modal.classList.remove('hidden');

  await _ensureClienteProfile();

  let t;
  try {
    t = await request('GET', `${API}/faturas/${uuid}`);
  } catch {
    const cached = _faturaCacheMap.get(String(uuid));
    t = cached
      ?? (typeof dataInline === 'string' ? JSON.parse(dataInline) : (dataInline || {}));
    showToast('Não foi possível atualizar a fatura. Exibindo dados da lista.', 'error');
  }

  const isPago    = t.status === 'pago' || !!t.valorpag;
  const isVencida = !isPago && t.datavenc && new Date(t.datavenc) < new Date();
  const totalPortalPagar = faturaValorTotalCobrancaPortal(t, isPago);
  const lemonPct = t.lemon_clube_desconto_percent != null ? Number(t.lemon_clube_desconto_percent) : null;
  const lr = faturaLemonCupomReconciliado(t, isPago);
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
  // Preferimos o subtotal original do MK (salvo antes dos encargos do portal).
  // Fallback para o cálculo local quando não disponível (ex.: detalhe sem enriquecimento).
  const totalMkAberto = !isPago
    ? (t.lemon_mk_subtotal_original != null
        ? Math.round(Number(t.lemon_mk_subtotal_original) * 100) / 100
        : Math.round(_faturaSubtotalAbertoSemCupomLista(t) * 100) / 100)
    : NaN;
  // Só exibe o subtítulo "MK-Auth / boleto" quando o valor original do MK difere do total
  // que o portal cobra (ou seja, quando o portal adicionou encargos que o MK não tinha).
  const totalMkHeroMostrar =
    !isPago &&
    Number.isFinite(totalMkAberto) &&
    totalMkAberto > 0.004 &&
    Math.abs(totalMkAberto - totalPortalPagar) > 0.009 &&
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
          ? `<div class="fatura-modal-subtipo" style="font-size:.76rem;opacity:.88;margin-top:4px">Valor original (sem encargos do portal): <strong>${fmtMoeda(totalMkAberto)}</strong></div>`
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
    ${
      !isPago && t.lemon_clube_desconto_resgatado && lemonPct != null && lemonPct > 0
        ? `<div class="fatura-modal-cupom-banner">
            <div class="fatura-modal-cupom-banner__left">
              <span class="fatura-modal-cupom-banner__icon"><i class="fa-solid fa-ticket"></i></span>
              <div>
                <div class="fatura-modal-cupom-banner__titulo">Cupom Lemon Club ativo</div>
                <div class="fatura-modal-cupom-banner__label">${escHtml(lemonLabel || `Desconto ${lemonPct}% na fatura`)}</div>
              </div>
            </div>
            <div class="fatura-modal-cupom-banner__pct">${lemonPct}%<span style="font-size:1rem;font-weight:700"> OFF</span>${lemonDesc != null && lemonDesc > 0.004 ? `<small>− ${fmtMoeda(lemonDesc)}</small>` : ''}</div>
          </div>`
        : ''
    }
    ${faturaModalVelocidadeBlockHtml()}

    <!-- Detalhes -->
    <div class="fatura-modal-section">
  `;

  html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-calendar-days"></i> Vencimento</span><span class="modal-detail-val">${fmtData(t.datavenc)}</span></div>`;

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

  if (t.referencia) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-tag"></i> Referência</span><span class="modal-detail-val">${escHtml(String(t.referencia))}</span></div>`;
  }

  if (t.obs) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-circle-info"></i> Descrição</span><span class="modal-detail-val" style="font-size:.82rem;color:var(--text-muted)">${escHtml(String(t.obs))}</span></div>`;
  }

  if (principalMk > 0.004) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-coins"></i> Valor</span><span class="modal-detail-val">${fmtMoeda(principalMk)}</span></div>`;
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

  if (t.datapag) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-check"></i> Data Pag.</span><span class="modal-detail-val" style="color:#4ade80">${fmtData(t.datapag)}</span></div>`;
  }

  if (t.valorpag) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-money-bill-wave"></i> Valor Pago</span><span class="modal-detail-val" style="color:#4ade80">${fmtMoeda(t.valorpag)}</span></div>`;
  }

  if (isPago && t.formapag) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-credit-card"></i> Forma Pag.</span><span class="modal-detail-val">${escHtml(String(t.formapag))}</span></div>`;
  }

  if (descMk > 0.004) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-percent"></i> Desconto (MK)</span><span class="modal-detail-val" style="color:#4ade80">− ${fmtMoeda(descMk)}</span></div>`;
  }

  if (multaMk > 0.004) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-triangle-exclamation"></i> Multa</span><span class="modal-detail-val" style="color:#ef4444">+ ${fmtMoeda(multaMk)}</span></div>`;
  }
  if (moraMk > 0.004) {
    html += `<div class="modal-detail-row"><span class="modal-detail-label"><i class="fa-solid fa-clock"></i> Juros mora</span><span class="modal-detail-val" style="color:#ef4444">+ ${fmtMoeda(moraMk)}</span></div>`;
  }

  html += `</div>`;

  if (t.pix && !isPago) {
    html += `
      <div class="pix-section">
        <h4><i class="fa-solid fa-qrcode"></i> Pagar com PIX</h4>
        ${t.pix_qr ? `<div class="pix-qr"><img src="${t.pix_qr}" alt="QR Code PIX" /></div>` : ''}
        ${t.pix_link ? `<a href="${t.pix_link}" target="_blank" class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:10px;font-size:.82rem"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir link PIX</a>` : ''}
        <div class="fatura-code-label">Pix Copia e Cola</div>
        <div class="barcode-line">${t.pix}</div>
        <button class="copy-btn" style="width:100%;justify-content:center" onclick="copiar('${t.pix.replace(/'/g, "\\'")}', this)">
          <i class="fa-solid fa-copy"></i> Copiar chave PIX
        </button>
      </div>`;
  }

  if (t.linhadig && !isPago) {
    html += `
      <div class="boleto-section">
        <h4><i class="fa-solid fa-barcode"></i> Boleto Bancário</h4>
        <div class="fatura-code-label">Linha digitável</div>
        <div class="barcode-line">${t.linhadig}</div>
        <button class="copy-btn" style="width:100%;justify-content:center" onclick="copiar('${t.linhadig.replace(/'/g, "\\'")}', this)">
          <i class="fa-solid fa-copy"></i> Copiar linha digitável
        </button>
      </div>`;
  }

  if (!isPago) {
    const descMP = `Mensalidade Internet${t.referencia ? ' - ' + t.referencia : ''}`;
    const escDesc = descMP.replace(/'/g, "\\'");
    html += `
      <div id="mp-pix-area" style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
        <button type="button" id="btn-mp-pix" class="btn btn-primary" style="width:100%;justify-content:center;background:linear-gradient(135deg,#009ee3,#007ab8);gap:10px;font-size:.9rem;padding:14px;color:#fff;border:none;box-shadow:0 4px 14px rgba(0,158,227,.35)"
          onclick="void pagarPixFaturaComValorAtualizado('${uuid}', '${escDesc}')">
          ${MP_LOGO_IMG}
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
