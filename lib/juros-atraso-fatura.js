'use strict';

/**
 * Juros de mora e multa por atraso calculados pelo portal sobre títulos em atraso.
 * Quando o MK já envia valor maior, mantém o do MK (Math.max).
 *
 * .env:
 *   FATURA_JUROS_POR_DIA_PERCENT — % por dia sobre o principal (ex.: 0.033 = ~1%/mês). Use 0 para desligar.
 *   FATURA_MULTA_ATRASO_PERCENT  — % fixo cobrado uma única vez ao atrasar (ex.: 2 = 2%). Use 0 para desligar.
 */

function parsePctEnv(envVar, defaultVal) {
  const raw = String(process.env[envVar] ?? String(defaultVal)).trim();
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parsePercentEnv() {
  return parsePctEnv('FATURA_JUROS_POR_DIA_PERCENT', '1');
}

function parseMultaEnv() {
  return parsePctEnv('FATURA_MULTA_ATRASO_PERCENT', '2');
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseValor(v) {
  if (v == null || v === '') return NaN;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  return parseFloat(s);
}

/**
 * Lista / show do MK pode aninhar título em `data` ou `titulo`; junta todas as fontes.
 */
function valoresCampoMkPool(tituloRaiz, campo) {
  const d = typeof tituloRaiz?.data === 'object' && tituloRaiz.data ? tituloRaiz.data : null;
  return [
    tituloRaiz?.[campo],
    tituloRaiz?.dados?.[campo],
    tituloRaiz?.titulo?.[campo],
    tituloRaiz?.titulo?.dados?.[campo],
    d?.[campo],
    d?.dados?.[campo],
  ];
}

/**
 * Principal do MK (valor do título) — quando a raiz vem zerada/usada como placeholder,
 * preserva o valor em `dados` (titulo/show costuma repetir nos dois níveis).
 */
function lerValorPrincipalBrutoTituloMk(t) {
  let primeiroPos = NaN;
  let ultimoFinito = NaN;
  for (const raw of valoresCampoMkPool(t, 'valor')) {
    const n = parseValor(raw);
    if (!Number.isFinite(n)) continue;
    ultimoFinito = n;
    if (n > 0.004 && !Number.isFinite(primeiroPos)) primeiroPos = n;
  }
  if (Number.isFinite(primeiroPos)) return primeiroPos;
  return ultimoFinito;
}

/**
 * Lê montante em repetido na raiz e em dados (MK envia só em um ou `null`/`0` em outro).
 * Usa Math.max só entre números finitos válidos para não mascarar com `??`.
 */
function lerCampoMonetarioTituloMk(t, campo) {
  if (!campo || !t || typeof t !== 'object') return NaN;
  const vals = [];
  for (const raw of valoresCampoMkPool(t, campo)) {
    const n = parseValor(raw);
    if (Number.isFinite(n)) vals.push(n);
  }
  if (!vals.length) return NaN;
  return Math.max(...vals);
}

function tituloNaoPago(t) {
  if (!t || typeof t !== 'object') return false;
  let vp = NaN;
  for (const raw of valoresCampoMkPool(t, 'valorpag')) {
    vp = parseValor(raw);
    if (Number.isFinite(vp)) break;
  }
  if (Number.isFinite(vp) && vp > 0) return false;
  const nested = typeof t.data === 'object' && t.data ? t.data : null;
  const st = `${t.status || t.situacao || t.dados?.status || nested?.status || nested?.situacao || ''}`.toLowerCase();
  if (st.includes('pago') || st.includes('quit') || st.includes('liquid')) return false;
  return true;
}

/** Dias corridos de atraso após a data de vencimento (0 = em dia ou vence hoje). */
function diasAtrasoCorridos(dataVencStr) {
  if (dataVencStr == null || String(dataVencStr).trim() === '') return 0;
  const d0 = String(dataVencStr).trim();
  const datePart = d0.includes('T') ? d0.split('T')[0] : d0.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) {
    const d = new Date(dataVencStr);
    const ts = d.getTime();
    if (!Number.isFinite(ts)) return 0;
    const due = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const diff = Math.floor((today - due) / 86400000);
    return diff > 0 ? diff : 0;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const due = Date.UTC(y, mo - 1, da);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = Math.floor((today - due) / 86400000);
  return diff > 0 ? diff : 0;
}

/**
 * Aplica juros de mora e multa por atraso ao payload de um título (mutação no objeto).
 * @returns {object} o mesmo objeto
 */
function aplicarJurosAtrasoTitulo(t) {
  const pctJuros = parsePercentEnv();
  const pctMulta = parseMultaEnv();
  if (!t || typeof t !== 'object') return t;
  if (pctJuros <= 0 && pctMulta <= 0) return t;
  if (!tituloNaoPago(t)) return t;

  const dvRaw = valoresCampoMkPool(t, 'datavenc')
    .concat(valoresCampoMkPool(t, 'data_vencimento'))
    .concat(valoresCampoMkPool(t, 'vencimento'));
  const dv = dvRaw.find((x) => x != null && String(x).trim() !== '');
  const dias = diasAtrasoCorridos(dv);
  if (dias <= 0) return t;

  const valorBruto = lerValorPrincipalBrutoTituloMk(t);
  const valorDescMk = lerCampoMonetarioTituloMk(t, 'valordesc');
  const descNum = Number.isFinite(valorDescMk) && valorDescMk > 0 ? valorDescMk : 0;
  const valorBase = Number.isFinite(valorBruto) ? Math.max(0, valorBruto - descNum) : NaN;
  if (!Number.isFinite(valorBase) || valorBase <= 0) return t;

  // Subtotal original do MK antes de qualquer injeção do portal (usado pelo frontend para
  // mostrar "Total no MK-Auth / boleto" apenas quando difere do total com encargos do portal).
  const mkMultaOriginal = lerCampoMonetarioTituloMk(t, 'valormulta');
  const mkMoraOriginal  = lerCampoMonetarioTituloMk(t, 'valormora');
  t.lemon_mk_subtotal_original = roundMoney(
    valorBase
    + (Number.isFinite(mkMultaOriginal) && mkMultaOriginal > 0 ? mkMultaOriginal : 0)
    + (Number.isFinite(mkMoraOriginal)  && mkMoraOriginal  > 0 ? mkMoraOriginal  : 0),
  );

  // ── juros de mora (acumulam por dia) ──────────────────────────────────────
  if (pctJuros > 0) {
    const portalMora = roundMoney((valorBase * (pctJuros / 100)) * dias);
    if (portalMora > 0) {
      const mkMoraRaw = lerCampoMonetarioTituloMk(t, 'valormora');
      const mkMoraNum = Number.isFinite(mkMoraRaw) && mkMoraRaw > 0 ? mkMoraRaw : 0;
      const merged = roundMoney(Math.max(mkMoraNum, portalMora));

      t.lemon_juros_atraso_dias = dias;
      t.lemon_juros_atraso_percent_dia = pctJuros;
      t.lemon_juros_atraso_calculado = roundMoney(portalMora);
      t.lemon_juros_atraso_mk_original =
        merged > mkMoraNum + 0.001 && mkMoraNum > 0 ? String(mkMoraNum) : null;
      t.valormora = merged.toFixed(2);
    }
  }

  // ── multa por atraso (percentual fixo, cobrado uma única vez) ─────────────
  if (pctMulta > 0) {
    const portalMulta = roundMoney(valorBase * (pctMulta / 100));
    if (portalMulta > 0) {
      const mkMultaRaw = lerCampoMonetarioTituloMk(t, 'valormulta');
      const mkMultaNum = Number.isFinite(mkMultaRaw) && mkMultaRaw > 0 ? mkMultaRaw : 0;
      const merged = roundMoney(Math.max(mkMultaNum, portalMulta));

      t.lemon_multa_atraso_percent = pctMulta;
      t.lemon_multa_atraso_calculada = roundMoney(portalMulta);
      t.lemon_multa_atraso_mk_original =
        merged > mkMultaNum + 0.001 && mkMultaNum > 0 ? String(mkMultaNum) : null;
      t.valormulta = merged.toFixed(2);
    }
  }

  return t;
}

function aplicarJurosAtrasoListaBody(body) {
  if (!body) return body;
  if (Array.isArray(body)) {
    return body.map((t) => aplicarJurosAtrasoTitulo({ ...t }));
  }
  const titulos = body.titulos;
  if (Array.isArray(titulos)) {
    return { ...body, titulos: titulos.map((t) => aplicarJurosAtrasoTitulo({ ...t })) };
  }
  return body;
}

module.exports = {
  parsePercentEnv,
  parseMultaEnv,
  diasAtrasoCorridos,
  lerValorPrincipalBrutoTituloMk,
  lerCampoMonetarioTituloMk,
  tituloNaoPago,
  aplicarJurosAtrasoTitulo,
  aplicarJurosAtrasoListaBody,
};
