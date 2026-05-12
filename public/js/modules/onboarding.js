/**
 * Landing, cadastro em etapas, login inicial e ViaCEP.
 * Expõe handlers no window via onboardingWindowAPI (onclick no HTML).
 */
import { API, PLANO_NOME_PARA_VALOR_MK } from './constants.js';
import { request } from './http.js';

const STORAGE_REGIAO = 'lemon_cadastro_regiao';
const STORAGE_ENDERECO_RP = 'lemon_cadastro_endereco_rp';
/** Linha base da rua Paulo Bourroul (308→bloco→AP, 280→B1/B2/B3→AP, 350–370→AP, Cingapura). */
const STORAGE_BOURROUL_RUA_BASE = 'lemon_rp_bourroul_rua_base';
/** R. Conde de Itaguaí — escolha de condomínio antes dos planos. */
const STORAGE_ITAGUAI_RUA_BASE = 'lemon_rp_itaguai_rua_base';
/** R. Barão de Castro Lima — escolha de condomínio (125 / 381) antes dos planos. */
const STORAGE_CASTRO_LIMA_RUA_BASE = 'lemon_rp_castro_lima_rua_base';
/** Letra do bloco Cingapura (B–E); depois número do bloco (B: 1–9; C–E: 1–10); por fim apto 11…62. */
const STORAGE_CINGAPURA_LETRA = 'lemon_rp_cingapura_bloco_letra';
/** Código do bloco: B1–B9; C/D/E + 1–10 (ex. C3, E10). */
const STORAGE_CINGAPURA_BLOCO_COD = 'lemon_rp_cingapura_bloco_cod';
/** Condomínio 350 / 360 / 370 antes de escolher o AP. */
const STORAGE_TORRE_RP = 'lemon_rp_torre_condominio';
/** Condomínio 308: bloco escolhido (1 ou 2) antes do AP. */
const STORAGE_308_BLOCO = 'lemon_rp_308_bloco';
/** Condomínio 280: bloco B1, B2 ou B3 antes do AP. */
const STORAGE_280_BLOCO = 'lemon_rp_280_bloco';
/** Condomínio 299 (Itaguaí): bloco 1, 2 ou 3 antes do AP — cada bloco: 9 andares × 5 AP/andar. */
const STORAGE_ITAGUAI_299_BLOCO = 'lemon_rp_itaguai_299_bloco';
/** Condomínio 321 (Itaguaí): bloco 1–4 antes do AP — cada bloco: 7 andares × 5 AP/andar. */
const STORAGE_ITAGUAI_321_BLOCO = 'lemon_rp_itaguai_321_bloco';
/** Itaguaí — condomínio 300 / 340 / 380 antes do andar e do AP. */
const STORAGE_ITAGUAI_TORRE_COND = 'lemon_rp_itaguai_torre_condominio';
/** Andar 1–9 escolhido antes dos AP101–AP114 daquele piso. */
const STORAGE_ITAGUAI_TORRE_ANDAR = 'lemon_rp_itaguai_torre_andar';

const ITAGUAI_CONDOMINIOS_TORRE_101 = new Set(['300', '340', '380']);

const CINGAPURA_LETRAS = ['B', 'C', 'D', 'E'];
const TORRES_COM_AP = new Set(['350', '360', '370']);

function limparSessaoCingapura() {
  sessionStorage.removeItem(STORAGE_CINGAPURA_LETRA);
  sessionStorage.removeItem(STORAGE_CINGAPURA_BLOCO_COD);
  sessionStorage.removeItem('lemon_rp_singapura_bloco');
}

function limparSessaoTorreRp() {
  sessionStorage.removeItem(STORAGE_TORRE_RP);
  sessionStorage.removeItem(STORAGE_308_BLOCO);
  sessionStorage.removeItem(STORAGE_280_BLOCO);
  sessionStorage.removeItem(STORAGE_ITAGUAI_299_BLOCO);
  sessionStorage.removeItem(STORAGE_ITAGUAI_321_BLOCO);
  sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_COND);
  sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_ANDAR);
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  sessionStorage.removeItem(STORAGE_CASTRO_LIMA_RUA_BASE);
}

function cingapuraLetraValida(letra) {
  return CINGAPURA_LETRAS.includes(String(letra || '').trim().toUpperCase());
}

function cingapuraCodigoNumeroBlocoValido(cod) {
  const s = String(cod || '').trim().toUpperCase();
  const m = s.match(/^([BCDE])(10|[1-9])$/);
  if (!m) return false;
  const L = m[1];
  const num = m[2] === '10' ? 10 : Number(m[2]);
  if (L === 'B') return num >= 1 && num <= 9;
  return num >= 1 && num <= 10;
}

/** 12 aptos: 6 andares × 2 (11, 12 … 61, 62). */
function cingapuraNumerosApartamento() {
  const list = [];
  for (let andar = 1; andar <= 6; andar += 1) {
    list.push(andar * 10 + 1, andar * 10 + 2);
  }
  return list;
}

/** Endereços de referência no Real Parque (ordem = índice no HTML). */
export const REAL_PARQUE_ENDERECOS = [
  'R. Paulo Bourroul — Real Parque, São Paulo — SP, 05686-050',
  'R. Conde de Itaguaí — Real Parque, São Paulo — SP, 05686-030',
  'R. Barão de Castro Lima — Real Parque, São Paulo — SP, 05685-040',
  'R. César Vallejo — Real Parque, São Paulo — SP, 04533-085',
];

const PAGES_ONBOARDING = [
  'page-landing',
  'page-login',
  'page-cadastro',
  'page-planos',
  'page-regiao',
  'page-realparque-enderecos',
  'page-castro-lima-condominios',
  'page-itaguai-condominios',
  'page-itaguai-299-blocos',
  'page-itaguai-299-apartamentos',
  'page-itaguai-321-blocos',
  'page-itaguai-321-apartamentos',
  'page-itaguai-torre-andar',
  'page-itaguai-torre-apartamentos',
  'page-bourroul-condominios',
  'page-bourroul-308-blocos',
  'page-bourroul-308-apartamentos',
  'page-bourroul-280-blocos',
  'page-bourroul-280-apartamentos',
  'page-bourroul-torre-apartamentos',
  'page-bourroul-cingapura-letras',
  'page-bourroul-cingapura-bloco-num',
  'page-bourroul-cingapura-apartamentos',
];

function hideTodasPaginasCaptacao() {
  PAGES_ONBOARDING.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active');
    el.classList.add('hidden');
  });
}

export function irParaEscolhaRegiao() {
  hideTodasPaginasCaptacao();
  document.getElementById('page-regiao').classList.remove('hidden');
  document.getElementById('page-regiao').classList.add('active');
}

/** Real Parque: tela de escolha de rua antes dos planos. */
export function irParaEnderecosRealParque() {
  hideTodasPaginasCaptacao();
  document.getElementById('page-realparque-enderecos').classList.remove('hidden');
  document.getElementById('page-realparque-enderecos').classList.add('active');
}

export function voltarEnderecosRealParqueParaRegiao() {
  sessionStorage.removeItem(STORAGE_REGIAO);
  sessionStorage.removeItem(STORAGE_ENDERECO_RP);
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaEscolhaRegiao();
}

/** Guarda a região; se Real Parque, abre lista de endereços; senão, planos. */
export function confirmarRegiaoContratacao(nomeRegiao) {
  const v = String(nomeRegiao || '').trim();
  if (!v) return;
  sessionStorage.setItem(STORAGE_REGIAO, v);
  if (v === 'Real Parque') {
    sessionStorage.removeItem(STORAGE_ENDERECO_RP);
    sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
    limparSessaoCingapura();
    limparSessaoTorreRp();
    irParaEnderecosRealParque();
    return;
  }
  sessionStorage.removeItem(STORAGE_ENDERECO_RP);
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaPlanos();
}

/** R. Paulo Bourroul: escolhe condomínio antes dos planos. */
export function irParaCondominiosPauloBourroul() {
  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-condominios').classList.remove('hidden');
  document.getElementById('page-bourroul-condominios').classList.add('active');
}

export function voltarCondominioPauloBourroulParaRuas() {
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  sessionStorage.removeItem(STORAGE_CASTRO_LIMA_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaEnderecosRealParque();
}

/** Após escolher uma das ruas do Real Parque (0 Bourroul; 1 Itaguaí; 2 Castro Lima+condomínios; 3 direto planos). */
export function confirmarEnderecoRealParque(indice) {
  const t = REAL_PARQUE_ENDERECOS[indice];
  if (!t) return;
  if (indice === 0) {
    sessionStorage.removeItem(STORAGE_ENDERECO_RP);
    limparSessaoCingapura();
    limparSessaoTorreRp();
    sessionStorage.setItem(STORAGE_BOURROUL_RUA_BASE, t);
    irParaCondominiosPauloBourroul();
    return;
  }
  if (indice === 1) {
    sessionStorage.removeItem(STORAGE_ENDERECO_RP);
    limparSessaoCingapura();
    limparSessaoTorreRp();
    sessionStorage.setItem(STORAGE_ITAGUAI_RUA_BASE, t);
    irParaCondominiosItaguai();
    return;
  }
  if (indice === 2) {
    sessionStorage.removeItem(STORAGE_ENDERECO_RP);
    limparSessaoCingapura();
    limparSessaoTorreRp();
    sessionStorage.setItem(STORAGE_CASTRO_LIMA_RUA_BASE, t);
    irParaCondominiosCastroLima();
    return;
  }
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  sessionStorage.removeItem(STORAGE_CASTRO_LIMA_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  sessionStorage.setItem(STORAGE_ENDERECO_RP, t);
  irParaPlanos();
}

const CONDOMINIOS_CASTRO_LIMA = new Set(['125', '381']);

/** R. Barão de Castro Lima: escolha do condomínio antes dos planos. */
export function irParaCondominiosCastroLima() {
  hideTodasPaginasCaptacao();
  document.getElementById('page-castro-lima-condominios').classList.remove('hidden');
  document.getElementById('page-castro-lima-condominios').classList.add('active');
}

export function voltarCondominioCastroLimaParaRuas() {
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  sessionStorage.removeItem(STORAGE_CASTRO_LIMA_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaEnderecosRealParque();
}

export function confirmarCondominioCastroLima(nomeCondominio) {
  const base = sessionStorage.getItem(STORAGE_CASTRO_LIMA_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const nome = String(nomeCondominio || '').trim();
  if (!CONDOMINIOS_CASTRO_LIMA.has(nome)) return;
  sessionStorage.setItem(STORAGE_ENDERECO_RP, `${base} · Condomínio: ${nome}`);
  sessionStorage.removeItem(STORAGE_CASTRO_LIMA_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaPlanos();
}

const CONDOMINIOS_ITAGUAI = new Set(['299', '300', '321', '340', '380']);

/** R. Conde de Itaguaí: escolha do condomínio antes dos planos. */
export function irParaCondominiosItaguai() {
  hideTodasPaginasCaptacao();
  document.getElementById('page-itaguai-condominios').classList.remove('hidden');
  document.getElementById('page-itaguai-condominios').classList.add('active');
}

export function voltarCondominioItaguaiParaRuas() {
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  sessionStorage.removeItem(STORAGE_CASTRO_LIMA_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaEnderecosRealParque();
}

export function confirmarCondominioItaguai(nomeCondominio) {
  const base = sessionStorage.getItem(STORAGE_ITAGUAI_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const nome = String(nomeCondominio || '').trim();
  if (!CONDOMINIOS_ITAGUAI.has(nome)) return;

  if (nome === '299') {
    limparSessaoCingapura();
    sessionStorage.removeItem(STORAGE_TORRE_RP);
    sessionStorage.removeItem(STORAGE_308_BLOCO);
    sessionStorage.removeItem(STORAGE_280_BLOCO);
    sessionStorage.removeItem(STORAGE_ITAGUAI_299_BLOCO);
    sessionStorage.removeItem(STORAGE_ITAGUAI_321_BLOCO);
    sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_COND);
    sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_ANDAR);
    hideTodasPaginasCaptacao();
    document.getElementById('page-itaguai-299-blocos').classList.remove('hidden');
    document.getElementById('page-itaguai-299-blocos').classList.add('active');
    return;
  }

  if (nome === '321') {
    limparSessaoCingapura();
    sessionStorage.removeItem(STORAGE_TORRE_RP);
    sessionStorage.removeItem(STORAGE_308_BLOCO);
    sessionStorage.removeItem(STORAGE_280_BLOCO);
    sessionStorage.removeItem(STORAGE_ITAGUAI_299_BLOCO);
    sessionStorage.removeItem(STORAGE_ITAGUAI_321_BLOCO);
    sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_COND);
    sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_ANDAR);
    hideTodasPaginasCaptacao();
    document.getElementById('page-itaguai-321-blocos').classList.remove('hidden');
    document.getElementById('page-itaguai-321-blocos').classList.add('active');
    return;
  }

  if (ITAGUAI_CONDOMINIOS_TORRE_101.has(nome)) {
    limparSessaoCingapura();
    sessionStorage.removeItem(STORAGE_TORRE_RP);
    sessionStorage.removeItem(STORAGE_308_BLOCO);
    sessionStorage.removeItem(STORAGE_280_BLOCO);
    sessionStorage.removeItem(STORAGE_ITAGUAI_299_BLOCO);
    sessionStorage.removeItem(STORAGE_ITAGUAI_321_BLOCO);
    sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_COND);
    sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_ANDAR);
    irParaItaguaiTorreAndar(nome);
    return;
  }

  sessionStorage.setItem(STORAGE_ENDERECO_RP, `${base} · Condomínio: ${nome}`);
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaPlanos();
}

/** 299: 9 andares × 5 apartamentos por andar (AP11–AP15 … AP91–AP95) — igual nos 3 blocos. */
function itaguai299NumerosApartamento() {
  const list = [];
  for (let andar = 1; andar <= 9; andar += 1) {
    for (let u = 1; u <= 5; u += 1) {
      list.push(andar * 10 + u);
    }
  }
  return list;
}

export function voltarItaguai299BlocosParaCondominios() {
  sessionStorage.removeItem(STORAGE_ITAGUAI_299_BLOCO);
  irParaCondominiosItaguai();
}

export function irParaItaguai299Apartamentos(blocoNum) {
  const base = sessionStorage.getItem(STORAGE_ITAGUAI_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const b = Number(blocoNum);
  if (b !== 1 && b !== 2 && b !== 3) return;
  sessionStorage.setItem(STORAGE_ITAGUAI_299_BLOCO, String(b));

  const titulo = document.getElementById('itaguai299-apts-titulo');
  const sub = document.getElementById('itaguai299-apts-subtitulo');
  const grid = document.getElementById('itaguai299-apts-grid');
  if (titulo) titulo.textContent = `Condomínio 299 — Bloco ${b}`;
  if (sub) {
    sub.textContent =
      '9 andares, 5 apartamentos por andar — AP11 a AP15, AP21 a AP25 … AP91 a AP95. Toque no seu apartamento.';
  }
  if (grid) {
    const nums = itaguai299NumerosApartamento();
    grid.innerHTML = nums
      .map(
        (n) =>
          `<button type="button" class="rp-azulejo rp-azulejo--cingapura-par rp-azulejo--cor-lima" onclick="confirmarItaguai299Unidade(${n})" aria-label="Apartamento AP${n}"><span class="rp-azulejo-icone" aria-hidden="true"><i class="fa-solid fa-door-open"></i></span><span class="rp-azulejo-nome">AP${n}</span></button>`,
      )
      .join('');
  }

  hideTodasPaginasCaptacao();
  document.getElementById('page-itaguai-299-apartamentos').classList.remove('hidden');
  document.getElementById('page-itaguai-299-apartamentos').classList.add('active');
}

export function voltarItaguai299ApartamentosParaBlocos() {
  sessionStorage.removeItem(STORAGE_ITAGUAI_299_BLOCO);
  hideTodasPaginasCaptacao();
  document.getElementById('page-itaguai-299-blocos').classList.remove('hidden');
  document.getElementById('page-itaguai-299-blocos').classList.add('active');
}

export function confirmarItaguai299Unidade(numeroApto) {
  const base = sessionStorage.getItem(STORAGE_ITAGUAI_RUA_BASE);
  const bloco = sessionStorage.getItem(STORAGE_ITAGUAI_299_BLOCO);
  if (!base || (bloco !== '1' && bloco !== '2' && bloco !== '3')) {
    irParaEnderecosRealParque();
    return;
  }
  const n = Number(numeroApto);
  const validos = new Set(itaguai299NumerosApartamento());
  if (!Number.isInteger(n) || !validos.has(n)) return;

  sessionStorage.setItem(
    STORAGE_ENDERECO_RP,
    `${base} · Condomínio: 299 · Bloco ${bloco} · Apto AP${n}`,
  );
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaPlanos();
}

/** 300 / 340 / 380: 14 unidades num andar (AP[andar]01 … só que o código é andar*100+u, u=1..14 → 101–114). */
function itaguaiTorreNumerosApartamentoNoAndar(andar) {
  const a = Number(andar);
  if (!Number.isInteger(a) || a < 1 || a > 9) return [];
  const list = [];
  for (let u = 1; u <= 14; u += 1) {
    list.push(a * 100 + u);
  }
  return list;
}

export function irParaItaguaiTorreAndar(condominioNome) {
  const base = sessionStorage.getItem(STORAGE_ITAGUAI_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const nome = String(condominioNome || '').trim();
  if (!ITAGUAI_CONDOMINIOS_TORRE_101.has(nome)) return;
  sessionStorage.setItem(STORAGE_ITAGUAI_TORRE_COND, nome);
  sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_ANDAR);

  const titulo = document.getElementById('itaguai-torre-andar-titulo');
  const sub = document.getElementById('itaguai-torre-andar-sub');
  if (titulo) titulo.textContent = `Condomínio ${nome}`;
  if (sub) {
    sub.textContent =
      'Em qual andar você mora? Toque em 1º andar, 2º andar … até 9º andar. Na próxima tela aparecem os 14 apartamentos daquele piso (ex.: no 1º andar: AP101 a AP114; no 2º: AP201 a AP214, e assim por diante).';
  }

  hideTodasPaginasCaptacao();
  document.getElementById('page-itaguai-torre-andar').classList.remove('hidden');
  document.getElementById('page-itaguai-torre-andar').classList.add('active');
}

export function voltarItaguaiTorreAndarParaCondominios() {
  sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_COND);
  sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_ANDAR);
  irParaCondominiosItaguai();
}

export function irParaItaguaiTorreApartamentosDoAndar(andarNum) {
  const base = sessionStorage.getItem(STORAGE_ITAGUAI_RUA_BASE);
  const condo = sessionStorage.getItem(STORAGE_ITAGUAI_TORRE_COND);
  if (!base || !ITAGUAI_CONDOMINIOS_TORRE_101.has(condo || '')) {
    irParaEnderecosRealParque();
    return;
  }
  const a = Number(andarNum);
  if (!Number.isInteger(a) || a < 1 || a > 9) return;
  sessionStorage.setItem(STORAGE_ITAGUAI_TORRE_ANDAR, String(a));

  const titulo = document.getElementById('itaguai-torre-apts-titulo');
  const sub = document.getElementById('itaguai-torre-apts-subtitulo');
  const grid = document.getElementById('itaguai-torre-apts-grid');
  const baseNum = a * 100;
  if (titulo) titulo.textContent = `Condomínio ${condo} — ${a}º andar`;
  if (sub) {
    sub.textContent = `Neste ${a}º andar são 14 apartamentos: AP${baseNum + 1} a AP${baseNum + 14}. Toque no seu.`;
  }
  if (grid) {
    const nums = itaguaiTorreNumerosApartamentoNoAndar(a);
    grid.innerHTML = nums
      .map(
        (n) =>
          `<button type="button" class="rp-azulejo rp-azulejo--cingapura-par rp-azulejo--cor-lima" onclick="confirmarItaguaiTorreUnidade(${n})" aria-label="Apartamento AP${n}"><span class="rp-azulejo-icone" aria-hidden="true"><i class="fa-solid fa-door-open"></i></span><span class="rp-azulejo-nome">AP${n}</span></button>`,
      )
      .join('');
  }

  hideTodasPaginasCaptacao();
  document.getElementById('page-itaguai-torre-apartamentos').classList.remove('hidden');
  document.getElementById('page-itaguai-torre-apartamentos').classList.add('active');
}

export function voltarItaguaiTorreApartamentosParaAndar() {
  sessionStorage.removeItem(STORAGE_ITAGUAI_TORRE_ANDAR);
  const condo = sessionStorage.getItem(STORAGE_ITAGUAI_TORRE_COND);
  if (condo && ITAGUAI_CONDOMINIOS_TORRE_101.has(condo)) {
    irParaItaguaiTorreAndar(condo);
    return;
  }
  irParaCondominiosItaguai();
}

export function confirmarItaguaiTorreUnidade(numeroApto) {
  const base = sessionStorage.getItem(STORAGE_ITAGUAI_RUA_BASE);
  const condo = sessionStorage.getItem(STORAGE_ITAGUAI_TORRE_COND);
  const andar = sessionStorage.getItem(STORAGE_ITAGUAI_TORRE_ANDAR);
  if (!base || !ITAGUAI_CONDOMINIOS_TORRE_101.has(condo || '') || !andar) {
    irParaEnderecosRealParque();
    return;
  }
  const n = Number(numeroApto);
  const validos = new Set(itaguaiTorreNumerosApartamentoNoAndar(Number(andar)));
  if (!Number.isInteger(n) || !validos.has(n)) return;

  sessionStorage.setItem(
    STORAGE_ENDERECO_RP,
    `${base} · Condomínio: ${condo} · ${andar}º andar · Apto AP${n}`,
  );
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaPlanos();
}

/** 321: 7 andares × 5 apartamentos por andar (AP11–AP15 … AP71–AP75) — igual nos 4 blocos. */
function itaguai321NumerosApartamento() {
  const list = [];
  for (let andar = 1; andar <= 7; andar += 1) {
    for (let u = 1; u <= 5; u += 1) {
      list.push(andar * 10 + u);
    }
  }
  return list;
}

export function voltarItaguai321BlocosParaCondominios() {
  sessionStorage.removeItem(STORAGE_ITAGUAI_321_BLOCO);
  irParaCondominiosItaguai();
}

export function irParaItaguai321Apartamentos(blocoNum) {
  const base = sessionStorage.getItem(STORAGE_ITAGUAI_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const b = Number(blocoNum);
  if (b !== 1 && b !== 2 && b !== 3 && b !== 4) return;
  sessionStorage.setItem(STORAGE_ITAGUAI_321_BLOCO, String(b));

  const titulo = document.getElementById('itaguai321-apts-titulo');
  const sub = document.getElementById('itaguai321-apts-subtitulo');
  const grid = document.getElementById('itaguai321-apts-grid');
  if (titulo) titulo.textContent = `Condomínio 321 — Bloco ${b}`;
  if (sub) {
    sub.textContent =
      '7 andares, 5 apartamentos por andar — AP11 a AP15, AP21 a AP25 … AP71 a AP75. Toque no seu apartamento.';
  }
  if (grid) {
    const nums = itaguai321NumerosApartamento();
    grid.innerHTML = nums
      .map(
        (n) =>
          `<button type="button" class="rp-azulejo rp-azulejo--cingapura-par rp-azulejo--cor-lima" onclick="confirmarItaguai321Unidade(${n})" aria-label="Apartamento AP${n}"><span class="rp-azulejo-icone" aria-hidden="true"><i class="fa-solid fa-door-open"></i></span><span class="rp-azulejo-nome">AP${n}</span></button>`,
      )
      .join('');
  }

  hideTodasPaginasCaptacao();
  document.getElementById('page-itaguai-321-apartamentos').classList.remove('hidden');
  document.getElementById('page-itaguai-321-apartamentos').classList.add('active');
}

export function voltarItaguai321ApartamentosParaBlocos() {
  sessionStorage.removeItem(STORAGE_ITAGUAI_321_BLOCO);
  hideTodasPaginasCaptacao();
  document.getElementById('page-itaguai-321-blocos').classList.remove('hidden');
  document.getElementById('page-itaguai-321-blocos').classList.add('active');
}

export function confirmarItaguai321Unidade(numeroApto) {
  const base = sessionStorage.getItem(STORAGE_ITAGUAI_RUA_BASE);
  const bloco = sessionStorage.getItem(STORAGE_ITAGUAI_321_BLOCO);
  if (!base || (bloco !== '1' && bloco !== '2' && bloco !== '3' && bloco !== '4')) {
    irParaEnderecosRealParque();
    return;
  }
  const n = Number(numeroApto);
  const validos = new Set(itaguai321NumerosApartamento());
  if (!Number.isInteger(n) || !validos.has(n)) return;

  sessionStorage.setItem(
    STORAGE_ENDERECO_RP,
    `${base} · Condomínio: 321 · Bloco ${bloco} · Apto AP${n}`,
  );
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaPlanos();
}

/** 7 andares × 4 apartamentos: 11–14, 21–24 … 71–74. */
function torreRpNumerosApartamento() {
  const list = [];
  for (let andar = 1; andar <= 7; andar += 1) {
    for (let u = 1; u <= 4; u += 1) {
      list.push(andar * 10 + u);
    }
  }
  return list;
}

/** Torres 350 / 360 / 370: escolha do apartamento (estilo Cingapura). */
export function irParaTorreApartamentos(condominio) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const nome = String(condominio || '').trim();
  if (!TORRES_COM_AP.has(nome)) return;
  limparSessaoCingapura();
  sessionStorage.setItem(STORAGE_TORRE_RP, nome);

  const titulo = document.getElementById('torre-apts-titulo');
  const sub = document.getElementById('torre-apts-subtitulo');
  const grid = document.getElementById('torre-apts-grid');
  if (titulo) titulo.textContent = `Condomínio ${nome}`;
  if (sub) {
    sub.textContent =
      `7 andares, 4 apartamentos por andar — AP11 a AP14, AP21 a AP24 … AP71 a AP74. Toque no seu apartamento.`;
  }
  if (grid) {
    const nums = torreRpNumerosApartamento();
    grid.innerHTML = nums
      .map(
        (n) =>
          `<button type="button" class="rp-azulejo rp-azulejo--cingapura-par rp-azulejo--cor-lima" onclick="confirmarTorreUnidade(${n})" aria-label="Apartamento AP${n}"><span class="rp-azulejo-icone" aria-hidden="true"><i class="fa-solid fa-door-open"></i></span><span class="rp-azulejo-nome">AP${n}</span></button>`,
      )
      .join('');
  }

  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-torre-apartamentos').classList.remove('hidden');
  document.getElementById('page-bourroul-torre-apartamentos').classList.add('active');
}

export function voltarTorreApartamentosParaCondominios() {
  limparSessaoTorreRp();
  irParaCondominiosPauloBourroul();
}

/** Confirma torre (350/360/370) + número do AP (11–74). */
export function confirmarTorreUnidade(numeroApto) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  const torre = sessionStorage.getItem(STORAGE_TORRE_RP);
  if (!base || !torre || !TORRES_COM_AP.has(torre)) {
    irParaEnderecosRealParque();
    return;
  }
  const n = Number(numeroApto);
  const validos = new Set(torreRpNumerosApartamento());
  if (!Number.isInteger(n) || !validos.has(n)) return;

  sessionStorage.setItem(
    STORAGE_ENDERECO_RP,
    `${base} · Condomínio: ${torre} · Apto AP${n}`,
  );
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  limparSessaoTorreRp();
  limparSessaoCingapura();
  irParaPlanos();
}

/** 308: 8 andares × 5 apartamentos (11–15 … 81–85). */
function torre308NumerosApartamento() {
  const list = [];
  for (let andar = 1; andar <= 8; andar += 1) {
    for (let u = 1; u <= 5; u += 1) {
      list.push(andar * 10 + u);
    }
  }
  return list;
}

/** Condomínio 308: escolha do bloco (1 ou 2). */
export function irPara308Blocos() {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  limparSessaoTorreRp();
  limparSessaoCingapura();
  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-308-blocos').classList.remove('hidden');
  document.getElementById('page-bourroul-308-blocos').classList.add('active');
}

export function voltar308BlocosParaCondominios() {
  limparSessaoTorreRp();
  irParaCondominiosPauloBourroul();
}

/** 308: após o bloco — grelha de AP (estilo Cingapura). */
export function irPara308Apartamentos(blocoNum) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const b = Number(blocoNum);
  if (b !== 1 && b !== 2) return;
  sessionStorage.setItem(STORAGE_308_BLOCO, String(b));

  const titulo = document.getElementById('torre308-apts-titulo');
  const sub = document.getElementById('torre308-apts-subtitulo');
  const grid = document.getElementById('torre308-apts-grid');
  if (titulo) titulo.textContent = `Condomínio 308 — Bloco ${b}`;
  if (sub) {
    sub.textContent =
      `8 andares, 5 apartamentos por andar — AP11 a AP15, AP21 a AP25 … AP81 a AP85. Toque no seu apartamento.`;
  }
  if (grid) {
    const nums = torre308NumerosApartamento();
    grid.innerHTML = nums
      .map(
        (n) =>
          `<button type="button" class="rp-azulejo rp-azulejo--cingapura-par rp-azulejo--cor-lima" onclick="confirmar308Unidade(${n})" aria-label="Apartamento AP${n}"><span class="rp-azulejo-icone" aria-hidden="true"><i class="fa-solid fa-door-open"></i></span><span class="rp-azulejo-nome">AP${n}</span></button>`,
      )
      .join('');
  }

  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-308-apartamentos').classList.remove('hidden');
  document.getElementById('page-bourroul-308-apartamentos').classList.add('active');
}

export function voltar308ApartamentosParaBlocos() {
  sessionStorage.removeItem(STORAGE_308_BLOCO);
  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-308-blocos').classList.remove('hidden');
  document.getElementById('page-bourroul-308-blocos').classList.add('active');
}

export function confirmar308Unidade(numeroApto) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  const bloco = sessionStorage.getItem(STORAGE_308_BLOCO);
  if (!base || (bloco !== '1' && bloco !== '2')) {
    irParaEnderecosRealParque();
    return;
  }
  const n = Number(numeroApto);
  const validos = new Set(torre308NumerosApartamento());
  if (!Number.isInteger(n) || !validos.has(n)) return;

  sessionStorage.setItem(
    STORAGE_ENDERECO_RP,
    `${base} · Condomínio: 308 · Bloco ${bloco} · Apto AP${n}`,
  );
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  limparSessaoTorreRp();
  limparSessaoCingapura();
  irParaPlanos();
}

function normalizaBloco280(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase();
  if (s === 'B1' || s === '1') return 'B1';
  if (s === 'B2' || s === '2') return 'B2';
  if (s === 'B3' || s === '3') return 'B3';
  return null;
}

/** 280: B1 → 8 andares × 4 (AP11–AP84); B2/B3 → 8 andares × 5 (AP11–AP85). */
function torre280NumerosApartamento(blocoKey) {
  const k = normalizaBloco280(blocoKey);
  if (!k) return [];
  const list = [];
  if (k === 'B1') {
    for (let andar = 1; andar <= 8; andar += 1) {
      for (let u = 1; u <= 4; u += 1) list.push(andar * 10 + u);
    }
    return list;
  }
  for (let andar = 1; andar <= 8; andar += 1) {
    for (let u = 1; u <= 5; u += 1) list.push(andar * 10 + u);
  }
  return list;
}

export function irPara280Blocos() {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  limparSessaoTorreRp();
  limparSessaoCingapura();
  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-280-blocos').classList.remove('hidden');
  document.getElementById('page-bourroul-280-blocos').classList.add('active');
}

export function voltar280BlocosParaCondominios() {
  limparSessaoTorreRp();
  irParaCondominiosPauloBourroul();
}

export function irPara280Apartamentos(blocoRaw) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const bloco = normalizaBloco280(blocoRaw);
  if (!bloco) return;
  sessionStorage.setItem(STORAGE_280_BLOCO, bloco);

  const titulo = document.getElementById('torre280-apts-titulo');
  const sub = document.getElementById('torre280-apts-subtitulo');
  const grid = document.getElementById('torre280-apts-grid');
  if (titulo) titulo.textContent = `Condomínio 280 — ${bloco}`;
  if (sub) {
    sub.textContent =
      bloco === 'B1'
        ? 'Bloco B1 — 8 andares, 4 apartamentos por andar (AP11 a AP14 … AP81 a AP84). Toque no seu apartamento.'
        : `Bloco ${bloco} — 8 andares, 5 apartamentos por andar (AP11 a AP15 … AP81 a AP85). Toque no seu apartamento.`;
  }
  if (grid) {
    grid.className = 'cingapura-apts-grid torre-rp-apts-scroll';
    grid.classList.add(bloco === 'B1' ? 'torre280-apts-grid--4col' : 'torre280-apts-grid--5col');
    const nums = torre280NumerosApartamento(bloco);
    grid.innerHTML = nums
      .map(
        (n) =>
          `<button type="button" class="rp-azulejo rp-azulejo--cingapura-par rp-azulejo--cor-lima" onclick="confirmar280Unidade(${n})" aria-label="Apartamento AP${n}"><span class="rp-azulejo-icone" aria-hidden="true"><i class="fa-solid fa-door-open"></i></span><span class="rp-azulejo-nome">AP${n}</span></button>`,
      )
      .join('');
  }

  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-280-apartamentos').classList.remove('hidden');
  document.getElementById('page-bourroul-280-apartamentos').classList.add('active');
}

export function voltar280ApartamentosParaBlocos() {
  sessionStorage.removeItem(STORAGE_280_BLOCO);
  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-280-blocos').classList.remove('hidden');
  document.getElementById('page-bourroul-280-blocos').classList.add('active');
}

export function confirmar280Unidade(numeroApto) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  const bloco = sessionStorage.getItem(STORAGE_280_BLOCO);
  if (!base || !['B1', 'B2', 'B3'].includes(bloco || '')) {
    irParaEnderecosRealParque();
    return;
  }
  const n = Number(numeroApto);
  const validos = new Set(torre280NumerosApartamento(bloco));
  if (!Number.isInteger(n) || !validos.has(n)) return;

  sessionStorage.setItem(
    STORAGE_ENDERECO_RP,
    `${base} · Condomínio: 280 · Bloco ${bloco} · Apto AP${n}`,
  );
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  limparSessaoTorreRp();
  limparSessaoCingapura();
  irParaPlanos();
}

/** Condomínio na R. Paulo Bourroul (fluxos dedicados para 308, 280, 350–370; fallback direto aos planos). */
export function confirmarCondominioPauloBourroul(nomeCondominio) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const nome = String(nomeCondominio || '').trim();
  if (!nome) return;
  sessionStorage.setItem(STORAGE_ENDERECO_RP, `${base} · Condomínio: ${nome}`);
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  irParaPlanos();
}

/** Cingapura: pergunta a letra do bloco (B, C, D ou E). */
export function irParaCingapuraLetra() {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  limparSessaoTorreRp();
  limparSessaoCingapura();
  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-cingapura-letras').classList.remove('hidden');
  document.getElementById('page-bourroul-cingapura-letras').classList.add('active');
}

export function voltarCingapuraLetraParaCondominios() {
  limparSessaoCingapura();
  irParaCondominiosPauloBourroul();
}

/** Cingapura: após a letra — escolhe o número do bloco (B: 1–9; demais: 1–10). */
export function irParaCingapuraNumerosBloco(letra) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
  const L = String(letra || '')
    .trim()
    .toUpperCase()
    .slice(0, 1);
  if (!cingapuraLetraValida(L)) return;
  sessionStorage.removeItem(STORAGE_CINGAPURA_BLOCO_COD);
  sessionStorage.setItem(STORAGE_CINGAPURA_LETRA, L);

  const grid = document.getElementById('cingapura-bloco-num-grid');
  const sub = document.getElementById('cingapura-bloco-num-subtitulo');
  if (sub) {
    const maxNum = L === 'B' ? 9 : 10;
    sub.textContent = `Letra ${L} — escolha o número do bloco (${L}1 a ${L}${maxNum}).`;
  }
  if (grid) {
    const botoes = [];
    const maxU = L === 'B' ? 9 : 10;
    for (let u = 1; u <= maxU; u += 1) {
      const cod = `${L}${u}`;
      botoes.push(
        `<button type="button" class="rp-azulejo rp-azulejo--cingapura-bloco-num rp-azulejo--cor-lima" onclick="irParaCingapuraApartamentos('${cod}')" aria-label="Bloco ${cod}"><span class="rp-azulejo-icone" aria-hidden="true"><i class="fa-solid fa-layer-group"></i></span><span class="rp-azulejo-nome">${cod}</span></button>`,
      );
    }
    grid.innerHTML = botoes.join('');
  }

  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-cingapura-bloco-num').classList.remove('hidden');
  document.getElementById('page-bourroul-cingapura-bloco-num').classList.add('active');
}

export function voltarCingapuraNumerosBlocoParaLetra() {
  limparSessaoCingapura();
  irParaCingapuraLetra();
}

/** Cingapura: após o código do bloco — escolhe o apartamento (11, 12 … 61, 62). */
export function irParaCingapuraApartamentos(codigoBloco) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  const letraGuardada = sessionStorage.getItem(STORAGE_CINGAPURA_LETRA);
  if (!base || !letraGuardada || !cingapuraLetraValida(letraGuardada)) {
    irParaEnderecosRealParque();
    return;
  }
  const cod = String(codigoBloco || '').trim().toUpperCase();
  if (!cingapuraCodigoNumeroBlocoValido(cod) || cod.charAt(0) !== letraGuardada) return;
  sessionStorage.setItem(STORAGE_CINGAPURA_BLOCO_COD, cod);

  const grid = document.getElementById('cingapura-apts-grid');
  const sub = document.getElementById('cingapura-apts-subtitulo');
  if (sub) {
    sub.textContent = `Bloco ${cod} — 6 andares, 2 aptos por andar (AP11, AP12, AP21, AP22 … AP61, AP62). Toque no seu apartamento.`;
  }
  if (grid) {
    const nums = cingapuraNumerosApartamento();
    grid.innerHTML = nums
      .map(
        (n) =>
          `<button type="button" class="rp-azulejo rp-azulejo--cingapura-par rp-azulejo--cor-lima" onclick="confirmarCingapuraUnidade(${n})" aria-label="Bloco ${cod}, apartamento AP${n}"><span class="rp-azulejo-icone" aria-hidden="true"><i class="fa-solid fa-door-open"></i></span><span class="rp-azulejo-nome">AP${n}</span></button>`,
      )
      .join('');
  }

  hideTodasPaginasCaptacao();
  document.getElementById('page-bourroul-cingapura-apartamentos').classList.remove('hidden');
  document.getElementById('page-bourroul-cingapura-apartamentos').classList.add('active');
}

export function voltarCingapuraApartamentosParaNumerosBloco() {
  sessionStorage.removeItem(STORAGE_CINGAPURA_BLOCO_COD);
  const L = sessionStorage.getItem(STORAGE_CINGAPURA_LETRA);
  if (!L || !cingapuraLetraValida(L)) {
    irParaCingapuraLetra();
    return;
  }
  irParaCingapuraNumerosBloco(L);
}

/** Cingapura: confirma letra + código do bloco (ex. B4) + nº do apto (11 … 62). */
export function confirmarCingapuraUnidade(numeroApto) {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  const letraGuardada = sessionStorage.getItem(STORAGE_CINGAPURA_LETRA);
  const blocoCod = sessionStorage.getItem(STORAGE_CINGAPURA_BLOCO_COD);
  if (
    !base ||
    !letraGuardada ||
    !blocoCod ||
    !cingapuraLetraValida(letraGuardada) ||
    !cingapuraCodigoNumeroBlocoValido(blocoCod)
  ) {
    irParaEnderecosRealParque();
    return;
  }
  if (blocoCod.charAt(0) !== letraGuardada) return;
  const n = Number(numeroApto);
  const validos = new Set(cingapuraNumerosApartamento());
  if (!Number.isInteger(n) || !validos.has(n)) return;

  sessionStorage.setItem(
    STORAGE_ENDERECO_RP,
    `${base} · Condomínio: Cingapura · Bloco ${blocoCod} · Apto AP${n}`,
  );
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  sessionStorage.removeItem(STORAGE_ITAGUAI_RUA_BASE);
  sessionStorage.removeItem(STORAGE_CASTRO_LIMA_RUA_BASE);
  limparSessaoCingapura();
  irParaPlanos();
}

export function irParaPlanos() {
  hideTodasPaginasCaptacao();
  const regiao = sessionStorage.getItem(STORAGE_REGIAO);
  const endRp = sessionStorage.getItem(STORAGE_ENDERECO_RP);
  const label = document.getElementById('planos-regiao-label');
  const endEl = document.getElementById('planos-endereco-rp');
  if (label) {
    if (regiao) {
      const prefixo = regiao === 'Real Parque' ? 'Condomínio' : 'Casas';
      label.textContent = `${prefixo} — ${regiao}`;
      label.classList.remove('hidden');
    } else {
      label.textContent = '';
      label.classList.add('hidden');
    }
  }
  if (endEl) {
    if (endRp && regiao === 'Real Parque') {
      endEl.textContent = endRp;
      endEl.classList.remove('hidden');
    } else {
      endEl.textContent = '';
      endEl.classList.add('hidden');
    }
  }
  document.getElementById('page-planos').classList.remove('hidden');
  document.getElementById('page-planos').classList.add('active');
}

/** Voltar da lista de planos: endereços RP → região → landing. */
export function voltarDePlanosOuLanding() {
  if (sessionStorage.getItem(STORAGE_ENDERECO_RP)) {
    sessionStorage.removeItem(STORAGE_ENDERECO_RP);
    sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
    limparSessaoCingapura();
    limparSessaoTorreRp();
    irParaEnderecosRealParque();
    return;
  }
  if (sessionStorage.getItem(STORAGE_REGIAO)) {
    irParaEscolhaRegiao();
    return;
  }
  voltarLanding();
}

export function irParaCadastro(plano) {
  hideTodasPaginasCaptacao();
  document.getElementById('page-cadastro').classList.remove('hidden');
  document.getElementById('page-cadastro').classList.add('active');

  if (plano) {
    const sel = document.getElementById('cad-plano');
    const v = PLANO_NOME_PARA_VALOR_MK[plano];
    if (sel && v) sel.value = v;
  }

  cadGoTo(1);
}

export function cadGoTo(step) {
  [1, 2, 3, 4].forEach((s) => {
    const el = document.getElementById(`cad-step-${s}`);
    if (el) el.classList.toggle('hidden', s !== step);
    const ind = document.getElementById(`step-ind-${s}`);
    if (ind) {
      ind.classList.toggle('active', s === step);
      ind.classList.toggle('done', s < step);
    }
  });
  document.querySelectorAll('.step-line').forEach((l, i) => {
    l.classList.toggle('done', i + 1 < step);
  });
}

export function cadNext(from) {
  const errEl = document.getElementById(`cad-err-${from}`);
  errEl.classList.add('hidden');

  if (from === 1) {
    const nome = document.getElementById('cad-nome').value.trim();
    const cpf = document.getElementById('cad-cpf').value.replace(/\D/g, '');
    if (!nome) return (errEl.textContent = 'Nome é obrigatório.', errEl.classList.remove('hidden'));
    if (cpf.length !== 11) return (errEl.textContent = 'CPF inválido.', errEl.classList.remove('hidden'));
    const login =
      nome
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '')
        .slice(0, 20) + cpf.slice(-4);
    document.getElementById('cad-login').value = login;
  }

  if (from === 2) {
    const end = document.getElementById('cad-end').value.trim();
    const num = document.getElementById('cad-num').value.trim();
    const bairro = document.getElementById('cad-bairro').value.trim();
    const cidade = document.getElementById('cad-cidade').value.trim();
    const estado = document.getElementById('cad-estado').value;
    if (!end || !num || !bairro || !cidade || !estado)
      return (errEl.textContent = 'Preencha todos os campos obrigatórios.', errEl.classList.remove('hidden'));
  }

  cadGoTo(from + 1);
}

export function cadBack(from) {
  cadGoTo(from - 1);
}

export async function enviarCadastro() {
  const errEl = document.getElementById('cad-err-3');
  errEl.classList.add('hidden');

  const senha = document.getElementById('cad-senha').value;
  const senha2 = document.getElementById('cad-senha2').value;
  const login = document.getElementById('cad-login').value.trim();

  if (!login) return (errEl.textContent = 'Login é obrigatório.', errEl.classList.remove('hidden'));
  if (senha.length < 6) return (errEl.textContent = 'Senha deve ter pelo menos 6 caracteres.', errEl.classList.remove('hidden'));
  if (senha !== senha2) return (errEl.textContent = 'As senhas não coincidem.', errEl.classList.remove('hidden'));

  const btn = document.getElementById('btn-cadastrar');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;margin:0"></div> Enviando...';

  const refParam =
    new URLSearchParams(window.location.search).get('ref') || sessionStorage.getItem('lemon_ref') || '';

  try {
    const regiaoCondominio = sessionStorage.getItem(STORAGE_REGIAO) || '';
    const enderecoIndicadoRp = sessionStorage.getItem(STORAGE_ENDERECO_RP) || '';

    await request('POST', `${API}/cadastro`, {
      nome: document.getElementById('cad-nome').value.trim(),
      cpf: document.getElementById('cad-cpf').value.replace(/\D/g, ''),
      data_nasc: document.getElementById('cad-nasc').value.trim(),
      email: document.getElementById('cad-email').value.trim(),
      celular: document.getElementById('cad-tel').value.trim(),
      cep: document.getElementById('cad-cep').value.replace(/\D/g, ''),
      endereco: document.getElementById('cad-end').value.trim(),
      numero: document.getElementById('cad-num').value.trim(),
      complemento: document.getElementById('cad-comp').value.trim(),
      bairro: document.getElementById('cad-bairro').value.trim(),
      cidade: document.getElementById('cad-cidade').value.trim(),
      estado: document.getElementById('cad-estado').value,
      login,
      senha,
      plano: document.getElementById('cad-plano').value,
      ref: refParam,
      regiao_condominio: regiaoCondominio || undefined,
      endereco_indicado_rp: enderecoIndicadoRp || undefined,
    });
    cadGoTo(4);
    sessionStorage.removeItem(STORAGE_REGIAO);
    sessionStorage.removeItem(STORAGE_ENDERECO_RP);
    sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
    sessionStorage.removeItem('lemon_ref');
    limparSessaoTorreRp();
  } catch (err) {
    errEl.textContent = err.message || 'Erro ao finalizar cadastro. Tente novamente.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Finalizar cadastro';
  }
}

export async function buscarCep(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) v = v.replace(/(\d{5})(\d{0,3})/, '$1-$2');
  input.value = v;
  if (v.replace(/\D/g, '').length === 8) {
    try {
      const r = await fetch(`https://viacep.com.br/ws/${v.replace(/\D/g, '')}/json/`);
      const d = await r.json();
      if (!d.erro) {
        document.getElementById('cad-end').value = d.logradouro || '';
        document.getElementById('cad-bairro').value = d.bairro || '';
        document.getElementById('cad-cidade').value = d.localidade || '';
        document.getElementById('cad-estado').value = d.uf || '';
        document.getElementById('cad-num').focus();
      }
    } catch {
      /* silencioso */
    }
  }
}

export function togglePassCad() {
  const input = document.getElementById('cad-senha');
  const icon = document.getElementById('eye-cad');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

export function irParaLogin() {
  hideTodasPaginasCaptacao();
  document.getElementById('page-login').classList.remove('hidden');
  document.getElementById('page-login').classList.add('active');
}

export function voltarLanding() {
  sessionStorage.removeItem(STORAGE_REGIAO);
  sessionStorage.removeItem(STORAGE_ENDERECO_RP);
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  limparSessaoCingapura();
  limparSessaoTorreRp();
  hideTodasPaginasCaptacao();
  document.getElementById('page-landing').classList.remove('hidden');
  document.getElementById('page-landing').classList.add('active');
}

/** Máscaras do formulário de cadastro (chamar após o DOM existir). */
export function initOnboardingFormListeners() {
  const nascInput = document.getElementById('cad-nasc');
  if (nascInput) {
    nascInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 8);
      if (v.length > 4) v = v.replace(/(\d{2})(\d{2})(\d{0,4})/, '$1/$2/$3');
      else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,2})/, '$1/$2');
      e.target.value = v;
    });
  }

  const tel = document.getElementById('cad-tel');
  if (tel) {
    tel.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 10) v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
      else if (v.length > 6) v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
      else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
      e.target.value = v;
    });
  }
}

/** Funções expostas no `window` para `onclick` no HTML. */
export const onboardingWindowAPI = {
  irParaEscolhaRegiao,
  irParaEnderecosRealParque,
  voltarEnderecosRealParqueParaRegiao,
  irParaCondominiosPauloBourroul,
  voltarCondominioPauloBourroulParaRuas,
  voltarCondominioItaguaiParaRuas,
  confirmarCondominioItaguai,
  voltarCondominioCastroLimaParaRuas,
  confirmarCondominioCastroLima,
  voltarItaguai299BlocosParaCondominios,
  irParaItaguai299Apartamentos,
  voltarItaguai299ApartamentosParaBlocos,
  confirmarItaguai299Unidade,
  voltarItaguai321BlocosParaCondominios,
  irParaItaguai321Apartamentos,
  voltarItaguai321ApartamentosParaBlocos,
  confirmarItaguai321Unidade,
  irParaItaguaiTorreAndar,
  voltarItaguaiTorreAndarParaCondominios,
  irParaItaguaiTorreApartamentosDoAndar,
  voltarItaguaiTorreApartamentosParaAndar,
  confirmarItaguaiTorreUnidade,
  confirmarRegiaoContratacao,
  confirmarEnderecoRealParque,
  confirmarCondominioPauloBourroul,
  irParaTorreApartamentos,
  voltarTorreApartamentosParaCondominios,
  confirmarTorreUnidade,
  irPara308Blocos,
  voltar308BlocosParaCondominios,
  irPara308Apartamentos,
  voltar308ApartamentosParaBlocos,
  confirmar308Unidade,
  irPara280Blocos,
  voltar280BlocosParaCondominios,
  irPara280Apartamentos,
  voltar280ApartamentosParaBlocos,
  confirmar280Unidade,
  irParaCingapuraLetra,
  voltarCingapuraLetraParaCondominios,
  irParaCingapuraNumerosBloco,
  voltarCingapuraNumerosBlocoParaLetra,
  irParaCingapuraApartamentos,
  voltarCingapuraApartamentosParaNumerosBloco,
  confirmarCingapuraUnidade,
  irParaPlanos,
  voltarDePlanosOuLanding,
  irParaCadastro,
  cadGoTo,
  cadNext,
  cadBack,
  enviarCadastro,
  buscarCep,
  togglePassCad,
  irParaLogin,
  voltarLanding,
};
