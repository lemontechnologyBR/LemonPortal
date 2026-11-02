'use strict';
const axios = require('axios');
const { ERP_URL, ERP_PORTAL_TOKEN } = require('./config');

function erpAtivo() {
  return Boolean(ERP_URL && ERP_PORTAL_TOKEN);
}

function erpClient() {
  if (!erpAtivo()) {
    const err = new Error('ERP do portal sem ERP_URL ou ERP_PORTAL_TOKEN');
    err.status = 503;
    throw err;
  }
  return axios.create({
    baseURL: `${ERP_URL}/api/erp/portal`,
    timeout: 15000,
    headers: {
      'X-Portal-Token': ERP_PORTAL_TOKEN,
      'Content-Type': 'application/json',
    },
  });
}

async function erpGet(path, params) {
  const r = await erpClient().get(path, { params });
  return r.data;
}

async function erpPost(path, body) {
  const r = await erpClient().post(path, body || {});
  return r.data;
}

function erpCliente(query) {
  return erpGet('/cliente', query);
}

function erpTitulos(query) {
  return erpGet('/titulos', query);
}

function erpTitulo(id, query) {
  return erpGet(`/titulos/${encodeURIComponent(id)}`, query);
}

function erpBaixarTitulo(id, body) {
  return erpPost(`/titulos/${encodeURIComponent(id)}/baixar`, body);
}

async function erpTituloDoCliente(tituloId, login) {
  const t = await erpTitulo(tituloId, login ? { login } : {});
  if (!t || !t.id) return null;
  if (login && String(t.login).toLowerCase() !== String(login).toLowerCase()) return null;
  return t;
}

function _parseValorTitulo(v) {
  if (v == null || v === '') return NaN;
  return parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
}

/**
 * Resolve id numérico do ERP a partir de uuid MK antigo, login e/ou valor.
 * O MP às vezes grava external_reference com ULID do MK-Auth; o ERP só conhece id (ex.: 22553).
 */
async function erpResolverTituloId({ tituloId, login, valor } = {}) {
  const idRef = String(tituloId || '').trim();
  const loginCli = String(login || '').trim();
  const valorNum = valor == null || valor === '' ? NaN : _parseValorTitulo(valor);

  if (idRef) {
    try {
      const t = await erpTituloDoCliente(idRef, loginCli || undefined);
      if (t) return String(t.id || t.uuid || idRef);
    } catch (_) {}
    if (/^\d+$/.test(idRef)) return idRef;
  }

  if (!loginCli) return null;

  const candidatos = [];
  const seen = new Set();
  for (const status of ['aberto', 'vencido', undefined]) {
    try {
      const raw = await erpTitulos(status ? { login: loginCli, status } : { login: loginCli });
      const arr = Array.isArray(raw?.titulos) ? raw.titulos : [];
      for (const t of arr) {
        const id = String(t?.id ?? t?.uuid ?? '').trim();
        if (!id || seen.has(id)) continue;
        if (String(t.status || '').toLowerCase() === 'pago') continue;
        seen.add(id);
        candidatos.push(t);
      }
    } catch (_) {}
  }

  if (!candidatos.length) return null;

  let lista = candidatos;
  if (Number.isFinite(valorNum)) {
    const porValor = candidatos.filter((t) => {
      const tv = _parseValorTitulo(t.valor);
      return Number.isFinite(tv) && Math.abs(tv - valorNum) < 0.05;
    });
    if (porValor.length) lista = porValor;
  }

  lista.sort((a, b) => {
    const da = new Date(a.datavenc || 0).getTime();
    const db = new Date(b.datavenc || 0).getTime();
    return (Number.isFinite(da) ? da : 0) - (Number.isFinite(db) ? db : 0);
  });

  const best = lista[0];
  return best ? String(best.id || best.uuid) : null;
}

module.exports = {
  erpAtivo,
  erpCliente,
  erpTitulos,
  erpTitulo,
  erpBaixarTitulo,
  erpTituloDoCliente,
  erpResolverTituloId,
};
