/**
 * Estado mutável partilhado entre módulos (referência única).
 */
export const S = {
  clienteData: null,
  faturasCarregadas: { abertas: false, vencidas: false, pagas: false },
  connInterval: null,
  connMaxDl: 1,
  connMaxUl: 1,
  mpPollingInterval: null,
  mpSubCtx: null,
  speedTesting: false,
  speedHistory: JSON.parse(localStorage.getItem('lemon_speed_hist') || '[]'),
  gaugeMax: 1000,
  /** Missões já concluídas (cache local persistente entre sessões). */
  missaoCache: new Set(JSON.parse(localStorage.getItem('lemon_miss') || '[]')),
  clubPontos: 0,
};

export function cacheMissao(tipo) {
  S.missaoCache.add(tipo);
  localStorage.setItem('lemon_miss', JSON.stringify([...S.missaoCache]));
}

export function missaoCacheHas(tipo) {
  return S.missaoCache.has(tipo);
}

/** Referências ligadas depois do bootstrap (evita dependências circulares). */
export const app = {
  /** @type {(view: string) => void} */
  navTo: null,
  /** @type {() => void} */
  refreshFaturas: null,
  /** @type {() => void} */
  prePopularMissoes: null,
  /** @type {(uuid: string) => void} */
  abrirFatura: null,
};
