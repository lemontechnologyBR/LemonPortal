/**
 * Desconto Lemon Club na fatura: % por tipo de resgate, título alvo e consumo após pagamento.
 */
const { sqliteDb } = require('./database');
const {
  lerValorPrincipalBrutoTituloMk,
  lerCampoMonetarioTituloMk,
  tituloNaoPago,
} = require('./juros-atraso-fatura');

const TIPO_DESCONTO_PERCENT = {
  desconto: 10,
  desconto_20: 20,
  desconto_30: 30,
  desconto_40: 40,
  desconto_50: 50,
  desconto_80: 80,
  desconto_100: 100,
};

function faturaDescontoTipoPercent(tipo) {
  const k = String(tipo || '');
  return Object.prototype.hasOwnProperty.call(TIPO_DESCONTO_PERCENT, k) ? TIPO_DESCONTO_PERCENT[k] : null;
}

function tipoResgateEhDescontoNaFatura(tipo) {
  return faturaDescontoTipoPercent(tipo) != null;
}

function parseValorTituloMk(v) {
  if (v == null || v === '') return NaN;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  return parseFloat(s);
}

function uuidNorm(u) {
  return String(u || '').trim().toLowerCase();
}

function normalizarClubFaturaDesconto(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw && typeof raw === 'object' ? raw : {};
    const aplicados = Array.isArray(o.aplicados) ? o.aplicados.filter((a) => a && a.tituloUuid) : [];
    let pendente = null;
    if (o.pendente && typeof o.pendente === 'object') {
      const p = o.pendente;
      const percent = Number(p.percent);
      const alvo = String(p.titulo_uuid_alvo || '').trim();
      if (
        Number.isFinite(percent) &&
        percent > 0 &&
        percent <= 100 &&
        faturaDescontoTipoPercent(p.tipo) === percent
      ) {
        pendente = {
          percent,
          tipo: String(p.tipo || ''),
          label: String(p.label || ''),
          desde: String(p.desde || ''),
          // Pode ser null quando não há fatura em aberto no momento do resgate
          titulo_uuid_alvo: alvo || null,
          titulo_alvo_datavenc:
            p.titulo_alvo_datavenc != null && String(p.titulo_alvo_datavenc).trim()
              ? String(p.titulo_alvo_datavenc).trim().slice(0, 40)
              : null,
          titulo_alvo_referencia:
            p.titulo_alvo_referencia != null && String(p.titulo_alvo_referencia).trim()
              ? String(p.titulo_alvo_referencia).trim().slice(0, 120)
              : null,
          // Desconto só é exibido na fatura após o cliente clicar "Aplicar na fatura"
          aplicado: p.aplicado === true,
        };
      }
    }
    return { pendente, aplicados };
  } catch {
    return { pendente: null, aplicados: [] };
  }
}

function serializarClubFaturaDesconto(cfd) {
  return JSON.stringify({
    pendente: cfd.pendente,
    aplicados: (cfd.aplicados || []).slice(-40),
  });
}

function loadClubFaturaDesconto(login) {
  const row = sqliteDb.prepare('SELECT club_fatura_desconto FROM clients WHERE login = ?').get(login);
  return normalizarClubFaturaDesconto(row?.club_fatura_desconto);
}

/** Identificador estilo UUID do título no MK (evita confundir com id/nosso número numérico). */
function pareceUuidTituloMk(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return true;
  if (/^[0-9a-f]{32}$/i.test(t)) return true;
  return false;
}

/**
 * UUID do título a partir do payload MK (lista ou titulo/show).
 * Prefere campos com formato UUID; `id` numérico só entra se não houver UUID explícito.
 */
function extrairUuidTitulo(t) {
  if (!t || typeof t !== 'object') return '';
  const pool = [
    t.uuid,
    t.dados?.uuid,
    typeof t.data === 'object' && t.data ? t.data.uuid : null,
    t.titulo?.uuid,
    t.gwt_uuid,
    t.codigo_uuid,
    t.id,
    t.dados?.id,
    t.titulo?.id,
  ];
  let fallback = '';
  for (const c of pool) {
    const s = String(c ?? '').trim();
    if (!s) continue;
    if (!fallback) fallback = s;
    if (pareceUuidTituloMk(s)) return s;
  }
  return fallback;
}

function parseValorTituloPayloadMk(t) {
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    const v = lerValorPrincipalBrutoTituloMk(t);
    if (Number.isFinite(v)) return v;
  }
  return parseValorTituloMk(t?.valor ?? t?.dados?.valor ?? t?.titulo?.valor);
}

/** Subtotal do portal: mensalismo + multa + mora − descontos já lançados no MK (valor fatura até cupom Lemon). */
function subtotalTituloPortal(tituloPayload) {
  const base = lerValorPrincipalBrutoTituloMk(tituloPayload);
  const multa = lerCampoMonetarioTituloMk(tituloPayload, 'valormulta');
  const mora = lerCampoMonetarioTituloMk(tituloPayload, 'valormora');
  const desc = lerCampoMonetarioTituloMk(tituloPayload, 'valordesc');
  if (!Number.isFinite(base)) return NaN;
  const m = Number.isFinite(multa) && multa > 0 ? multa : 0;
  const mo = Number.isFinite(mora) && mora > 0 ? mora : 0;
  const de = Number.isFinite(desc) && desc > 0 ? desc : 0;
  return Number((base + m + mo - de).toFixed(2));
}

/** Alinha `uuid` ao id da rota/chamada (titulo/show do MK às vezes omite ou troca por id numérico). */
function garantirUuidTituloPayload(payload, idPedido) {
  const id = String(idPedido || '').trim();
  if (!id) return payload && typeof payload === 'object' ? { ...payload } : {};
  return { ...(payload && typeof payload === 'object' ? payload : {}), uuid: id };
}

function extrairDataVencTitulo(t) {
  const d = new Date(t?.datavenc || t?.data_vencimento || t?.vencimento || 0);
  const ts = d.getTime();
  return Number.isFinite(ts) ? ts : 0;
}

async function listarTitulosAbertosEVencidosPorCpf(cpfLimpo, mkGet) {
  let lista = [];
  try {
    const ab = await mkGet(`titulo/aberto/${cpfLimpo}`);
    const arr = ab?.titulos || ab?.data;
    if (Array.isArray(arr)) lista = lista.concat(arr);
  } catch (_) {}
  try {
    const ve = await mkGet(`titulo/vencido/${cpfLimpo}`);
    const arr = ve?.titulos || ve?.data;
    if (Array.isArray(arr)) lista = lista.concat(arr);
  } catch (_) {}
  return lista;
}

/** Apenas faturas abertas (não vencidas) — cupom de desconto só pode ser vinculado a faturas em dia. */
async function listarTitulosAbertosPorCpf(cpfLimpo, mkGet) {
  try {
    const ab = await mkGet(`titulo/aberto/${cpfLimpo}`);
    const arr = ab?.titulos || ab?.data;
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function ordenarTitulosPorVencimentoUuid(a, b) {
  const da = extrairDataVencTitulo(a);
  const db = extrairDataVencTitulo(b);
  if (da !== db) return da - db;
  return extrairUuidTitulo(a).localeCompare(extrairUuidTitulo(b), 'pt-BR');
}

/**
 * Primeiro título ainda não pago, por data de vencimento (mais antigo primeiro; empate → UUID).
 */
async function uuidTituloAlvoDescontoClube(cpfLimpo, mkGet) {
  const c = await tituloAlvoDescontoClubeCompleto(cpfLimpo, mkGet);
  return c ? c.uuid : null;
}

/**
 * Metadados da fatura onde o cupom Lemon Club fica válido (uma só por vez).
 * @returns {null | { uuid: string, datavenc: string|null, referencia: string|null }}
 */
async function tituloAlvoDescontoClubeCompleto(cpfLimpo, mkGet) {
  const open = await titulosAbertosOrdenados(cpfLimpo, mkGet);
  if (!open.length) return null;
  const t0 = open[0];
  const dv = t0?.datavenc ?? t0?.data_vencimento ?? t0?.vencimento ?? null;
  const ref = t0?.referencia != null && String(t0.referencia).trim() ? String(t0.referencia).trim().slice(0, 120) : null;
  return {
    uuid: extrairUuidTitulo(t0),
    datavenc: dv != null ? String(dv).trim().slice(0, 40) : null,
    referencia: ref,
  };
}

function formatarDataVencimentoCurto(s) {
  if (s == null || String(s).trim() === '') return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return null;
  }
}

function extrairMetaTituloParaPendente(t) {
  const dv = t?.datavenc ?? t?.data_vencimento ?? t?.vencimento ?? null;
  const ref = t?.referencia != null && String(t.referencia).trim() ? String(t.referencia).trim().slice(0, 120) : null;
  return {
    titulo_alvo_datavenc: dv != null ? String(dv).trim().slice(0, 40) : undefined,
    titulo_alvo_referencia: ref || undefined,
  };
}

async function titulosAbertosEVencidosOrdenados(cpfLimpo, mkGet) {
  const lista = await listarTitulosAbertosEVencidosPorCpf(cpfLimpo, mkGet);
  return lista.filter((t) => extrairUuidTitulo(t) && tituloNaoPago(t)).sort(ordenarTitulosPorVencimentoUuid);
}

/** Faturas abertas (não vencidas) ordenadas — usada para vincular cupom de desconto. */
async function titulosAbertosOrdenados(cpfLimpo, mkGet) {
  const lista = await listarTitulosAbertosPorCpf(cpfLimpo, mkGet);
  return lista.filter((t) => extrairUuidTitulo(t) && tituloNaoPago(t)).sort(ordenarTitulosPorVencimentoUuid);
}

/**
 * Atualiza metadados do cupom com o MK e migra o alvo se o título antigo já não estiver em aberto/vencido.
 */
async function reconciliarPendenteDescontoClube(login, cpfLimpo, mkGet) {
  const cpf = String(cpfLimpo || '').replace(/\D/g, '');
  if (!login || cpf.length < 11 || !mkGet) return;

  const row = sqliteDb.prepare('SELECT club_fatura_desconto FROM clients WHERE login = ?').get(login);
  let cfd = normalizarClubFaturaDesconto(row?.club_fatura_desconto);
  if (!cfd.pendente) return;

  const open = await titulosAbertosOrdenados(cpf, mkGet);
  const alvoNorm = uuidNorm(cfd.pendente.titulo_uuid_alvo);

  if (!open.length) {
    // Nenhuma fatura em aberto: mantém o cupom pendente mas remove o alvo concreto.
    // O alvo será vinculado automaticamente quando o cliente regularizar e uma fatura em aberto aparecer.
    if (cfd.pendente.titulo_uuid_alvo) {
      cfd.pendente.titulo_uuid_alvo     = null;
      cfd.pendente.titulo_alvo_datavenc = null;
      cfd.pendente.titulo_alvo_referencia = null;
      sqliteDb
        .prepare(`UPDATE clients SET club_fatura_desconto = ?, updated_at = datetime('now') WHERE login = ?`)
        .run(serializarClubFaturaDesconto(cfd), login);
    }
    return;
  }

  const idx = open.findIndex((t) => uuidNorm(extrairUuidTitulo(t)) === alvoNorm);
  let mudou = false;

  if (idx >= 0) {
    const meta = extrairMetaTituloParaPendente(open[idx]);
    if (meta.titulo_alvo_datavenc !== cfd.pendente.titulo_alvo_datavenc) {
      cfd.pendente.titulo_alvo_datavenc = meta.titulo_alvo_datavenc;
      mudou = true;
    }
    if (meta.titulo_alvo_referencia !== cfd.pendente.titulo_alvo_referencia) {
      cfd.pendente.titulo_alvo_referencia = meta.titulo_alvo_referencia;
      mudou = true;
    }
  } else {
    const t0 = open[0];
    const nu = extrairUuidTitulo(t0);
    const meta = extrairMetaTituloParaPendente(t0);
    cfd.pendente.titulo_uuid_alvo = nu;
    cfd.pendente.titulo_alvo_datavenc = meta.titulo_alvo_datavenc;
    cfd.pendente.titulo_alvo_referencia = meta.titulo_alvo_referencia;
    mudou = true;
    console.log(`[Lemon Club] Cupom ${login}: título alvo atualizado para ${nu} (anterior já não está em aberto/vencido).`);
  }

  if (mudou) {
    sqliteDb
      .prepare(`UPDATE clients SET club_fatura_desconto = ?, updated_at = datetime('now') WHERE login = ?`)
      .run(serializarClubFaturaDesconto(cfd), login);
  }
}

function montarTextosCupomOutraFatura(pendente) {
  const pct = pendente.percent;
  const ref = pendente.titulo_alvo_referencia;
  const dvFmt = formatarDataVencimentoCurto(pendente.titulo_alvo_datavenc);

  let resumo = '';
  if (dvFmt && ref) resumo = `Cupom ${pct}% · outra fatura (${dvFmt}) · ${ref}`;
  else if (dvFmt) resumo = `Cupom ${pct}% · outra fatura (vence ${dvFmt})`;
  else if (ref) resumo = `Cupom ${pct}% · outra fatura (“${ref}”)`;
  else resumo = `Cupom ${pct}% · vale em outra mensalidade desta lista`;

  let texto = '';
  if (dvFmt && ref) {
    texto = `Nesta fatura o portal mostra o valor integral. O desconto de ${pct}% está na outra mensalidade — serviço “${ref}”, vencimento ${dvFmt}. Abra essa fatura e pague com PIX ou cartão Mercado Pago.`;
  } else if (dvFmt) {
    texto = `Nesta fatura o valor é integral (sem cupom). O desconto de ${pct}% vale na mensalidade que vence em ${dvFmt}. Procure-a em “Em aberto” ou “Vencidas”.`;
  } else if (ref) {
    texto = `Nesta fatura o valor é integral. O desconto de ${pct}% vale na mensalidade com referência “${ref}”.`;
  } else {
    texto = `Nesta fatura o valor é integral. Se houver mais de uma mensalidade em aberto ou vencida, o Lemon Club aplica ${pct}% só numa por vez: naquela cuja data de vencimento é a mais antiga (a que deve ser quitada antes). É outra linha desta lista — abra-a para ver o valor com desconto.`;
  }

  return { resumo, texto };
}

function calcularDescontoClubePercent(valorBase, percent) {
  const b = Number(valorBase);
  const p = Number(percent);
  if (!Number.isFinite(b) || b <= 0) return null;
  if (!Number.isFinite(p) || p <= 0 || p > 100) return null;
  const valor_desconto = Math.round((b * p) / 100 * 100) / 100;
  const valor_a_pagar = Math.max(0, Math.round((b - valor_desconto) * 100) / 100);
  return {
    valor_base_mk: b,
    percent: p,
    valor_desconto,
    valor_a_pagar,
  };
}

/** Valores aceites para cobrança MP (integral ou cupom Lemon Club sobre o principal + encargos integrais). */
function valoresMpPermitidosParaTitulo(tituloMk, pendente, tituloUuidPedido) {
  const full = subtotalTituloPortal(tituloMk);

  const out = [];
  if (Number.isFinite(full)) out.push(full);

  if (!Number.isFinite(full) || full <= 0 || !pendente || !pendente.titulo_uuid_alvo) return out;
  if (uuidNorm(pendente.titulo_uuid_alvo) !== uuidNorm(tituloUuidPedido)) return out;

  // Desconto calculado sobre o principal; encargos (multa/mora/desc) permanecem integrais.
  const principal = lerValorPrincipalBrutoTituloMk(tituloMk);
  if (!Number.isFinite(principal) || principal <= 0) return out;

  const c = calcularDescontoClubePercent(principal, pendente.percent);
  if (!c) return out;

  const multa = lerCampoMonetarioTituloMk(tituloMk, 'valormulta');
  const mora  = lerCampoMonetarioTituloMk(tituloMk, 'valormora');
  const desc  = lerCampoMonetarioTituloMk(tituloMk, 'valordesc');
  const multaNum = Number.isFinite(multa) && multa > 0 ? multa : 0;
  const moraNum  = Number.isFinite(mora)  && mora  > 0 ? mora  : 0;
  const descNum  = Number.isFinite(desc)  && desc  > 0 ? desc  : 0;
  const comCupom = Number((c.valor_a_pagar + multaNum + moraNum - descNum).toFixed(2));
  if (Number.isFinite(comCupom) && Math.abs(comCupom - full) > 0.009) out.push(comCupom);
  return out;
}

function valorPedidoConferePermitidos(valorPedido, permitidos) {
  const v = Number(parseFloat(valorPedido).toFixed(2));
  if (!Number.isFinite(v)) return false;
  return permitidos.some((x) => Math.abs(Number(x) - v) <= 0.02);
}

/**
 * Anexa campos lemon_clube_* ao payload de um título (detalhe ou item de lista).
 */
function enriquecerTituloComDescontoClube(tituloPayload, login) {
  if (!tituloPayload || typeof tituloPayload !== 'object') return tituloPayload;
  const uuid = extrairUuidTitulo(tituloPayload);
  if (!uuid || !login) return tituloPayload;

  const cfd = loadClubFaturaDesconto(login);
  const aplicado = (cfd.aplicados || []).find((a) => uuidNorm(a.tituloUuid) === uuidNorm(uuid));

  tituloPayload.lemon_clube_desconto_resgatado = false;
  tituloPayload.lemon_clube_desconto_percent = null;
  tituloPayload.lemon_clube_valor_desconto = null;
  tituloPayload.lemon_clube_valor_a_pagar = null;
  tituloPayload.lemon_clube_desconto_label = null;
  tituloPayload.lemon_clube_cupom_outra_fatura = false;
  tituloPayload.lemon_clube_cupom_alvo_uuid = null;
  tituloPayload.lemon_clube_cupom_alvo_texto = null;
  tituloPayload.lemon_clube_cupom_alvo_resumo = null;

  if (aplicado && !tituloNaoPago(tituloPayload)) {
    tituloPayload.lemon_clube_desconto_resgatado = true;
    tituloPayload.lemon_clube_desconto_percent = aplicado.percent != null ? Number(aplicado.percent) : null;
    tituloPayload.lemon_clube_valor_desconto =
      aplicado.valor_desconto != null ? Number(aplicado.valor_desconto) : null;
    tituloPayload.lemon_clube_valor_a_pagar = aplicado.valor_pago != null ? Number(aplicado.valor_pago) : null;
    tituloPayload.lemon_clube_desconto_label = aplicado.label || null;
    return tituloPayload;
  }

  const alvoNorm = cfd.pendente ? uuidNorm(cfd.pendente.titulo_uuid_alvo) : '';
  const esteNorm = uuidNorm(uuid);
  const ehTituloAlvoCupom = Boolean(cfd.pendente && alvoNorm && alvoNorm === esteNorm);

  if (ehTituloAlvoCupom) {
    // Desconto só é exibido se o cliente clicou "Aplicar na fatura" explicitamente
    if (!cfd.pendente.aplicado) return tituloPayload;

    // Cupom não se aplica a faturas vencidas.
    const dvRaw = tituloPayload.datavenc || tituloPayload.data_vencimento || tituloPayload.vencimento || '';
    if (dvRaw) {
      const dv = new Date(String(dvRaw).trim().slice(0, 10));
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      if (!isNaN(dv.getTime()) && dv < hoje) return tituloPayload;
    }

    // Desconto aplicado apenas sobre o principal; multa e juros são mantidos integrais.
    const principal = lerValorPrincipalBrutoTituloMk(tituloPayload);
    if (Number.isFinite(principal) && principal > 0) {
      const c = calcularDescontoClubePercent(principal, cfd.pendente.percent);
      if (c) {
        const multa = lerCampoMonetarioTituloMk(tituloPayload, 'valormulta');
        const mora  = lerCampoMonetarioTituloMk(tituloPayload, 'valormora');
        const desc  = lerCampoMonetarioTituloMk(tituloPayload, 'valordesc');
        const multaNum = Number.isFinite(multa) && multa > 0 ? multa : 0;
        const moraNum  = Number.isFinite(mora)  && mora  > 0 ? mora  : 0;
        const descNum  = Number.isFinite(desc)  && desc  > 0 ? desc  : 0;
        const valorAPagar = Math.max(0, Number((c.valor_a_pagar + multaNum + moraNum - descNum).toFixed(2)));
        tituloPayload.lemon_clube_desconto_resgatado = true;
        tituloPayload.lemon_clube_desconto_percent = c.percent;
        tituloPayload.lemon_clube_valor_desconto = c.valor_desconto;
        tituloPayload.lemon_clube_valor_a_pagar = valorAPagar;
        tituloPayload.lemon_clube_desconto_label = cfd.pendente.label || null;
        tituloPayload.lemon_clube_cupom_sobre_subtotal = true;
      }
    }
    return tituloPayload;
  }

  if (cfd.pendente) {
    tituloPayload.lemon_clube_cupom_outra_fatura = true;
    tituloPayload.lemon_clube_cupom_alvo_uuid = cfd.pendente.titulo_uuid_alvo;
    const { resumo, texto } = montarTextosCupomOutraFatura(cfd.pendente);
    tituloPayload.lemon_clube_cupom_alvo_resumo = resumo;
    tituloPayload.lemon_clube_cupom_alvo_texto = texto;
  }

  return tituloPayload;
}

function enriquecerListaFaturasClube(body, login) {
  if (!body || typeof body !== 'object') return body;
  if (Array.isArray(body)) {
    return { titulos: body.map((t) => enriquecerTituloComDescontoClube({ ...t }, login)) };
  }
  const titulos = body.titulos;
  if (!Array.isArray(titulos)) return body;
  body.titulos = titulos.map((t) => enriquecerTituloComDescontoClube({ ...t }, login));
  return body;
}

async function enriquecerListaFaturasClubePosReconciliar(body, login, cpfLimpo, mkGet) {
  await reconciliarPendenteDescontoClube(login, cpfLimpo, mkGet);
  return enriquecerListaFaturasClube(body, login);
}

async function enriquecerTituloComDescontoClubePosReconciliar(tituloPayload, login, cpfLimpo, mkGet) {
  await reconciliarPendenteDescontoClube(login, cpfLimpo, mkGet);
  return enriquecerTituloComDescontoClube(tituloPayload, login);
}

/**
 * Após baixa MK-Auth bem-sucedida: consome desconto pendente se o pagamento foi no título alvo.
 * @param {object|number} tituloOuValorBaseMk — payload completo do titulo/show (preferido) ou valor principal (legado).
 */
function tentarConsumirDescontoClubePosBaixa(login, tituloUuidPago, valorPago, tituloOuValorBaseMk) {
  const row = sqliteDb.prepare('SELECT club_fatura_desconto FROM clients WHERE login = ?').get(login);
  const cfd = normalizarClubFaturaDesconto(row?.club_fatura_desconto);
  if (!cfd.pendente) return false;
  if (uuidNorm(cfd.pendente.titulo_uuid_alvo) !== uuidNorm(tituloUuidPago)) return false;

  let subtotal = NaN;
  let principal = NaN;
  if (tituloOuValorBaseMk != null && typeof tituloOuValorBaseMk === 'object') {
    subtotal = subtotalTituloPortal(tituloOuValorBaseMk);
    principal = parseValorTituloPayloadMk(tituloOuValorBaseMk);
  } else {
    principal = parseValorTituloMk(tituloOuValorBaseMk);
    subtotal = Number.isFinite(principal) ? principal : NaN;
  }

  const vp = Number(valorPago);
  // Registra o desconto calculado sobre o principal (encargos não entram na base do desconto).
  const calc =
    Number.isFinite(principal) && principal > 0 ? calcularDescontoClubePercent(principal, cfd.pendente.percent) : null;

  cfd.aplicados.push({
    tituloUuid: String(tituloUuidPago),
    percent: cfd.pendente.percent,
    tipo: cfd.pendente.tipo,
    label: cfd.pendente.label,
    valor_base_mk: Number.isFinite(principal) ? principal : null,
    valor_subtotal_portal: Number.isFinite(subtotal) ? subtotal : null,
    valor_desconto: calc ? calc.valor_desconto : null,
    valor_pago: Number.isFinite(vp) ? vp : null,
    data: new Date().toISOString(),
  });
  cfd.pendente = null;

  sqliteDb
    .prepare(`UPDATE clients SET club_fatura_desconto = ?, updated_at = datetime('now') WHERE login = ?`)
    .run(serializarClubFaturaDesconto(cfd), login);
  return true;
}

module.exports = {
  faturaDescontoTipoPercent,
  tipoResgateEhDescontoNaFatura,
  parseValorTituloMk,
  garantirUuidTituloPayload,
  normalizarClubFaturaDesconto,
  serializarClubFaturaDesconto,
  loadClubFaturaDesconto,
  uuidTituloAlvoDescontoClube,
  tituloAlvoDescontoClubeCompleto,
  reconciliarPendenteDescontoClube,
  calcularDescontoClubePercent,
  valoresMpPermitidosParaTitulo,
  valorPedidoConferePermitidos,
  enriquecerTituloComDescontoClube,
  enriquecerListaFaturasClube,
  enriquecerListaFaturasClubePosReconciliar,
  enriquecerTituloComDescontoClubePosReconciliar,
  subtotalTituloPortal,
  tentarConsumirDescontoClubePosBaixa,
};
