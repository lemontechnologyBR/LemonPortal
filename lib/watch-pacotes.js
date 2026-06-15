/**
 * Catálogo de pacotes Watch Brasil (IDs oficiais) + resolução por plano Lemon.
 * Ajuste MAPA_PLANO_LEMON ou use WATCH_PACOTE_MAP_JSON / WATCH_PACOTE_ID no .env.
 */

const PACOTES = [
  { id: '36887', nome: 'WATCH FREE' },
  { id: '36889', nome: 'UP WATCH LOCAL PRO' },
  { id: '36891', nome: 'UP WATCH' },
  { id: '36893', nome: 'MAX' },
  { id: '36894', nome: 'PREMIUM SPORTS-D' },
  { id: '36895', nome: 'POWER ULTRA' },
  { id: '36897', nome: 'POWER SELEÇÃO ESPORTES' },
  { id: '36899', nome: 'POWER PLAY' },
  { id: '36901', nome: 'POWER MEGA' },
  { id: '36904', nome: 'POWER ELITE' },
  { id: '36906', nome: 'COMBATE' },
  { id: '36907', nome: 'HUB ULTRA LOCAL PRO' },
  { id: '36909', nome: 'HUB ULTRA' },
  { id: '36911', nome: 'HUB SELEÇÃO ESPORTES LOCAL PRO' },
  { id: '36913', nome: 'HUB SELEÇÃO ESPORTES' },
  { id: '36915', nome: 'UP CINE+ LOCAL PRO' },
  { id: '36917', nome: 'UP CINE+' },
  { id: '36919', nome: 'HUB MIX LOCAL PRO' },
  { id: '36922', nome: 'HUB MIX' },
  { id: '36925', nome: 'TELECINE' },
];

/**
 * Substring do plano MK (normalizado) → ID Watch.
 * A resolução é por substring (match parcial): o nome do plano do cliente só
 * precisa CONTER a chave abaixo para ser mapeado ao pacote correspondente.
 * Edite conforme contrato com a Watch.
 */
const MAPA_PLANO_LEMON = {
  // -- entradas originais --
  'lemon smart': '36887',
  'lemon plus': '36891',
  'lemon max': '36893',
  'lemon x': '36904',

  // -- WATCH FREE (36887) — planos de entrada / 200 Mbps --
  'smart': '36887',
  'basico': '36887',
  'start': '36887',
  'inicial': '36887',
  'lemon 200': '36887',
  '200': '36887',

  // -- UP WATCH (36891) — planos intermediários / 500 Mbps --
  'plus': '36891',
  'intermediario': '36891',
  'avancado 50': '36891',
  'lemon 500': '36891',
  '500': '36891',

  // -- MAX (36893) — planos avançados / 100 Mbps --
  'max': '36893',
  'turbo': '36893',
  'top': '36893',
  'premium': '36893',
  'avancado 100': '36893',

  // -- POWER ELITE (36904) — planos topo / 1 Gbps --
  'ultra': '36904',
  'gigabit': '36904',
  'giga': '36904',
  'elite': '36904',
  '1g': '36904',
  'fibra 1g': '36904',
  '1 giga': '36904',
  '1gb': '36904',
  '1000': '36904',
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

function parseEnvMap() {
  const raw = String(process.env.WATCH_PACOTE_MAP_JSON || '').trim();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** Há forma de obter um ID de pacote (env fixo, JSON ou mapa Lemon). */
function temConfigPacote() {
  if (String(process.env.WATCH_PACOTE_ID || '').trim()) return true;
  if (parseEnvMap()) return true;
  return Object.keys(MAPA_PLANO_LEMON).length > 0;
}

/**
 * Resolve o pPacote para a API Watch.
 * @param {object} cliente — sessão: { plano?, login? }
 */
function resolvePacoteId(cliente) {
  const forced = String(process.env.WATCH_PACOTE_ID || '').trim();
  if (forced) return forced;

  const envMap = parseEnvMap();
  const planoRaw = cliente?.plano || cliente?.plano_nome || '';
  const plano = norm(planoRaw);

  if (envMap && plano) {
    for (const [chave, id] of Object.entries(envMap)) {
      const k = norm(chave);
      if (!k || id == null) continue;
      if (plano === k || plano.includes(k) || k.includes(plano)) return String(id).trim();
    }
  }

  for (const [chave, id] of Object.entries(MAPA_PLANO_LEMON)) {
    if (plano.includes(chave)) return id;
  }

  return '';
}

function listarPacotes() {
  return PACOTES.map((p) => ({ ...p }));
}

module.exports = {
  PACOTES,
  MAPA_PLANO_LEMON,
  temConfigPacote,
  resolvePacoteId,
  listarPacotes,
};
