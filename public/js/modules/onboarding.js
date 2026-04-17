/**
 * Landing, cadastro em etapas, login inicial e ViaCEP.
 * Expõe handlers no window via onboardingWindowAPI (onclick no HTML).
 */
import { API, PLANO_NOME_PARA_VALOR_MK } from './constants.js';
import { request } from './http.js';

const STORAGE_REGIAO = 'lemon_cadastro_regiao';
const STORAGE_ENDERECO_RP = 'lemon_cadastro_endereco_rp';
/** Linha base da rua Paulo Bourroul antes de escolher o condomínio (Azul 308, Cingapura, Amarelo 280). */
const STORAGE_BOURROUL_RUA_BASE = 'lemon_rp_bourroul_rua_base';
/** Letra do bloco Cingapura (B–E); depois número do bloco (B: 1–9; C–E: 1–10); por fim apto 11…62. */
const STORAGE_CINGAPURA_LETRA = 'lemon_rp_cingapura_bloco_letra';
/** Código do bloco: B1–B9; C/D/E + 1–10 (ex. C3, E10). */
const STORAGE_CINGAPURA_BLOCO_COD = 'lemon_rp_cingapura_bloco_cod';

const CINGAPURA_LETRAS = ['B', 'C', 'D', 'E'];

function limparSessaoCingapura() {
  sessionStorage.removeItem(STORAGE_CINGAPURA_LETRA);
  sessionStorage.removeItem(STORAGE_CINGAPURA_BLOCO_COD);
  sessionStorage.removeItem('lemon_rp_singapura_bloco');
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
  'page-bourroul-condominios',
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
    irParaEnderecosRealParque();
    return;
  }
  sessionStorage.removeItem(STORAGE_ENDERECO_RP);
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  limparSessaoCingapura();
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
  limparSessaoCingapura();
  irParaEnderecosRealParque();
}

/** Após escolher uma das ruas do Real Parque (índice 0 = fluxo Bourroul + condomínio). */
export function confirmarEnderecoRealParque(indice) {
  const t = REAL_PARQUE_ENDERECOS[indice];
  if (!t) return;
  if (indice === 0) {
    sessionStorage.removeItem(STORAGE_ENDERECO_RP);
    limparSessaoCingapura();
    sessionStorage.setItem(STORAGE_BOURROUL_RUA_BASE, t);
    irParaCondominiosPauloBourroul();
    return;
  }
  sessionStorage.removeItem(STORAGE_BOURROUL_RUA_BASE);
  limparSessaoCingapura();
  sessionStorage.setItem(STORAGE_ENDERECO_RP, t);
  irParaPlanos();
}

/** Condomínio na R. Paulo Bourroul (Azul 308, Amarelo 280). Cingapura usa fluxo próprio. */
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
  irParaPlanos();
}

/** Cingapura: pergunta a letra do bloco (B, C, D ou E). */
export function irParaCingapuraLetra() {
  const base = sessionStorage.getItem(STORAGE_BOURROUL_RUA_BASE);
  if (!base) {
    irParaEnderecosRealParque();
    return;
  }
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
  confirmarRegiaoContratacao,
  confirmarEnderecoRealParque,
  confirmarCondominioPauloBourroul,
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
