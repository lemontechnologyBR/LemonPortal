/**
 * Cruza o plano do cliente (MK-Auth) com plano/listar ou plano/show — veldown/velup em Kbps.
 * @see https://postman.mk-auth.com.br/docs.php (OpenAPI: plano/listar, plano/show, cliente/show)
 */
const { mkGet } = require('./mk-api');

const PLANOS_TTL_MS = 5 * 60 * 1000;
let _planosCache = { at: 0, list: null };

function extractPlanosArray(body) {
  if (!body || typeof body !== 'object') return [];
  const a = body.planos || body.dados;
  return Array.isArray(a) ? a : [];
}

function normalizePlanoKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
}

/** MK costuma guardar velocidades em Kbps (ex.: veldown: '75000'); valores < 1000 tratamos como Mbps. */
function velToMbps(raw) {
  const n = Number(String(raw ?? '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000) return Math.round(n / 1000);
  return Math.round(n);
}

function mergeVelocidadeIntoCliente(cliente, p) {
  if (!p) return null;
  const dlMbps = velToMbps(p.veldown);
  if (dlMbps == null || dlMbps <= 0) return null;
  const ulMbps = velToMbps(p.velup);
  return Object.assign({}, cliente, {
    plano_veldown_kbps: Number(String(p.veldown).replace(',', '.').trim()) || null,
    plano_velup_kbps:
      p.velup != null && String(p.velup).trim() !== ''
        ? Number(String(p.velup).replace(',', '.').trim()) || null
        : null,
    plano_download_mbps: dlMbps,
    plano_upload_mbps: ulMbps != null && ulMbps > 0 ? ulMbps : null,
  });
}

/** GET plano/show/{uuid} — doc também menciona capitalização alternativa. */
async function tryPlanoShow(uuid) {
  const u = String(uuid || '').trim();
  if (!u || !/^[0-9a-f-]{36}$/i.test(u)) return null;
  for (const path of [`plano/show/${u}`, `plano/Show/${u}`]) {
    try {
      const d = await mkGet(path);
      if (d && d.veldown != null && String(d.veldown).trim() !== '') return d;
    } catch {
      /* tenta próximo path */
    }
  }
  return null;
}

/**
 * Filtro oficial: após plano/listar, barra + parâmetros (ex.: listar/nome=Prata).
 * @see OpenAPI — plano/listar
 */
async function tryPlanoListarComFiltro(field, value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const enc = encodeURIComponent(v);
  const paths = [
    `plano/listar/pagina=1/${field}=${enc}`,
    `plano/listar/${field}=${enc}/pagina=1`,
  ];
  for (const path of paths) {
    try {
      const d = await mkGet(path);
      const arr = extractPlanosArray(d);
      if (!arr.length) continue;
      if (arr.length === 1) return arr[0];
      const nk = normalizePlanoKey(v);
      const exact = arr.find(
        (p) =>
          normalizePlanoKey(p.nome || '') === nk ||
          normalizePlanoKey(p.titulo || '') === nk
      );
      return exact || arr[0];
    } catch {
      /* próximo path */
    }
  }
  return null;
}

function findPlanoForCliente(cliente, planos) {
  if (!Array.isArray(planos) || !planos.length) return null;

  const uuid =
    cliente.uuid_plano ||
    cliente.plano_uuid ||
    cliente.uuidPlano ||
    cliente.planoUuid;
  if (uuid) {
    const by = planos.find((p) => String(p.uuid || p.uuid_plano || '') === String(uuid));
    if (by) return by;
  }

  const key = String(cliente.plano || cliente.plano_nome || cliente.contrato || '').trim();
  if (!key) return null;
  const nk = normalizePlanoKey(key);

  for (const p of planos) {
    for (const f of [p.nome, p.titulo]) {
      if (f && normalizePlanoKey(f) === nk) return p;
    }
  }

  let best = null;
  let bestLen = 0;
  for (const p of planos) {
    for (const f of [p.nome, p.titulo]) {
      if (!f) continue;
      const nf = normalizePlanoKey(f);
      if (!nf) continue;
      if (nk.includes(nf) || nf.includes(nk)) {
        if (nf.length > bestLen) {
          bestLen = nf.length;
          best = p;
        }
      }
    }
  }
  return best;
}

async function fetchAllPlanosMk() {
  const paths = [
    'plano/listar/pagina=1&limite=500',
    'plano/listar/pagina=1',
  ];
  let first = null;
  for (const p of paths) {
    try {
      first = await mkGet(p);
      break;
    } catch {
      /* próximo */
    }
  }
  if (!first) return [];
  let all = [...extractPlanosArray(first)];
  const tp = Math.min(Number(first.total_paginas) || 1, 30);
  for (let pagina = 2; pagina <= tp; pagina++) {
    try {
      const d = await mkGet(`plano/listar/pagina=${pagina}&limite=500`);
      all = all.concat(extractPlanosArray(d));
    } catch {
      try {
        const d2 = await mkGet(`plano/listar/pagina=${pagina}`);
        all = all.concat(extractPlanosArray(d2));
      } catch {
        break;
      }
    }
  }
  return all;
}

async function getPlanosListCached() {
  if (_planosCache.list && Date.now() - _planosCache.at < PLANOS_TTL_MS) {
    return _planosCache.list;
  }
  const list = await fetchAllPlanosMk();
  _planosCache = { at: Date.now(), list };
  return list;
}

/**
 * Resolve o plano do cliente conforme a API MK-Auth (show por UUID, listar com filtro nome/titulo, depois lista completa).
 * @param {object} cliente — corpo de cliente/show
 */
async function enrichClienteComVelocidadePlano(cliente) {
  if (!cliente || typeof cliente !== 'object') return cliente;
  try {
    const nomePlano = String(cliente.plano || cliente.plano_nome || '').trim();

    const uuidCandidates = [
      cliente.uuid_plano,
      cliente.plano_uuid,
      cliente.uuidPlano,
      cliente.planoUuid,
    ].filter(Boolean);

    for (const uid of uuidCandidates) {
      const shown = await tryPlanoShow(uid);
      const merged = mergeVelocidadeIntoCliente(cliente, shown);
      if (merged) return merged;
    }

    if (nomePlano) {
      for (const field of ['nome', 'titulo']) {
        const p = await tryPlanoListarComFiltro(field, nomePlano);
        const merged = mergeVelocidadeIntoCliente(cliente, p);
        if (merged) return merged;
      }
    }

    const planos = await getPlanosListCached();
    const p = findPlanoForCliente(cliente, planos);
    const merged = mergeVelocidadeIntoCliente(cliente, p);
    return merged || cliente;
  } catch {
    return cliente;
  }
}

module.exports = {
  normalizePlanoKey,
  findPlanoForCliente,
  enrichClienteComVelocidadePlano,
};
