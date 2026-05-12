'use strict';
const { sqliteDb } = require('./database');
const {
  normalizarClubFaturaDesconto,
  serializarClubFaturaDesconto,
} = require('./clube-fatura-desconto');
const { mergePrefs, parsePushNotifPrefsJson } = require('./push-notif-prefs');

// ── Camada SQLite ──────────────────────────────────────────────────────────

function rowToClient(row) {
  return {
    points:             row.points,
    totalEarned:        row.total_earned,
    streak:             row.streak,
    completedMissions:  JSON.parse(row.completed_missions),
    awardedInvoices:    JSON.parse(row.awarded_invoices),
    referrals:          JSON.parse(row.referrals),
    redeemed:           JSON.parse(row.redeemed),
    log:                JSON.parse(row.log),
    speedtests:         JSON.parse(row.speedtests),
    loginHistory:       JSON.parse(row.login_history),
    visitedSections:    JSON.parse(row.visited_sections),
    clubFaturaDesconto: normalizarClubFaturaDesconto(row.club_fatura_desconto),
    pushNotifPrefs:     parsePushNotifPrefsJson(row.push_notif_prefs),
  };
}

const stmtGet = sqliteDb.prepare('SELECT * FROM clients WHERE login = ?');

const stmtUpsert = sqliteDb.prepare(`
  INSERT INTO clients
    (login, points, total_earned, streak, completed_missions, awarded_invoices,
     referrals, redeemed, log, speedtests, login_history, visited_sections, club_fatura_desconto, push_notif_prefs, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, ?, datetime('now'))
  ON CONFLICT(login) DO UPDATE SET
    points             = excluded.points,
    total_earned       = excluded.total_earned,
    streak             = excluded.streak,
    completed_missions = excluded.completed_missions,
    awarded_invoices   = excluded.awarded_invoices,
    referrals          = excluded.referrals,
    redeemed           = excluded.redeemed,
    log                = excluded.log,
    speedtests         = excluded.speedtests,
    login_history      = excluded.login_history,
    visited_sections   = excluded.visited_sections,
    club_fatura_desconto = excluded.club_fatura_desconto,
    push_notif_prefs   = excluded.push_notif_prefs,
    updated_at         = datetime('now')
`);

function loadReferrals() {
  const rows = sqliteDb.prepare('SELECT * FROM clients').all();
  const db = {};
  for (const row of rows) db[row.login] = rowToClient(row);
  return db;
}

function saveReferrals(db) {
  const save = sqliteDb.transaction((entries) => {
    for (const [login, c] of entries) {
      stmtUpsert.run(
        login,
        c.points       || 0,
        c.totalEarned  || 0,
        c.streak       || 0,
        JSON.stringify(c.completedMissions || []),
        JSON.stringify(c.awardedInvoices   || []),
        JSON.stringify(c.referrals         || []),
        JSON.stringify(c.redeemed          || []),
        JSON.stringify(c.log               || []),
        JSON.stringify(c.speedtests        || []),
        JSON.stringify(c.loginHistory      || []),
        JSON.stringify(c.visitedSections   || []),
        serializarClubFaturaDesconto(normalizarClubFaturaDesconto(c.clubFaturaDesconto)),
        JSON.stringify(mergePrefs(c.pushNotifPrefs)),
      );
    }
  });
  save(Object.entries(db));
}

/** Carrega apenas um cliente do banco (O(1) em vez de O(n)). */
function loadClient(login) {
  const row = stmtGet.get(login);
  return row ? rowToClient(row) : null;
}

/** Salva apenas um cliente (O(1) em vez de O(n)). */
function saveClient(login, c) {
  stmtUpsert.run(
    login,
    c.points       || 0,
    c.totalEarned  || 0,
    c.streak       || 0,
    JSON.stringify(c.completedMissions || []),
    JSON.stringify(c.awardedInvoices   || []),
    JSON.stringify(c.referrals         || []),
    JSON.stringify(c.redeemed          || []),
    JSON.stringify(c.log               || []),
    JSON.stringify(c.speedtests        || []),
    JSON.stringify(c.loginHistory      || []),
    JSON.stringify(c.visitedSections   || []),
    serializarClubFaturaDesconto(normalizarClubFaturaDesconto(c.clubFaturaDesconto)),
    JSON.stringify(mergePrefs(c.pushNotifPrefs)),
  );
}

// ── Níveis de gamificação ──────────────────────────────────────────────────

const LEVELS = [
  { id: 'bronze',   label: 'Bronze',   min: 0,    max: 499,  icon: '🥉', color: '#cd7f32' },
  { id: 'prata',    label: 'Prata',    min: 500,  max: 1499, icon: '🥈', color: '#94a3b8' },
  { id: 'ouro',     label: 'Ouro',     min: 1500, max: 2999, icon: '🥇', color: '#f59e0b' },
  { id: 'diamante', label: 'Diamante', min: 3000, max: Infinity, icon: '💎', color: '#818cf8' },
];

// ── Missões disponíveis ────────────────────────────────────────────────────

const MISSIONS = {
  // ── Exploração ──────────────────────────────────────────────────────
  primeiro_login:      { label: 'Primeiro acesso ao portal',    pts: 5,   icon: 'fa-door-open',         cor: '#818cf8', desc: 'Acesse o portal pela primeira vez',              categoria: 'Exploração' },
  ver_fatura:          { label: 'Verificar suas faturas',        pts: 5,   icon: 'fa-file-invoice',       cor: '#22d3ee', desc: 'Visite a seção de faturas',                     categoria: 'Exploração' },
  ver_conexao:         { label: 'Verificar sua conexão',         pts: 5,   icon: 'fa-wifi',               cor: '#4ade80', desc: 'Acesse a tela Minha Conexão',                  categoria: 'Exploração' },
  abrir_chamado:       { label: 'Abrir um chamado',              pts: 10,  icon: 'fa-headset',            cor: '#fb923c', desc: 'Envie sua primeira solicitação de suporte',    categoria: 'Exploração' },
  explorador:          { label: 'Explorador do portal',          pts: 20,  icon: 'fa-compass',            cor: '#c084fc', desc: 'Visite todas as seções do portal',              categoria: 'Exploração' },
  ver_velocidade_sec:  { label: 'Visitar Teste de Velocidade',  pts: 5,   icon: 'fa-gauge-high',         cor: '#a78bfa', desc: 'Acesse a seção de Teste de Velocidade',         categoria: 'Exploração' },
  ver_perfil_sec:      { label: 'Visitar seu perfil',            pts: 5,   icon: 'fa-user-circle',        cor: '#38bdf8', desc: 'Acesse a seção Meu Perfil',                    categoria: 'Exploração' },
  ver_suporte_sec:     { label: 'Visitar seção de suporte',      pts: 5,   icon: 'fa-life-ring',          cor: '#fb923c', desc: 'Acesse a área de suporte e chamados',           categoria: 'Exploração' },
  ver_desafios:        { label: 'Ver seus desafios',             pts: 5,   icon: 'fa-list-check',         cor: '#c084fc', desc: 'Acesse a aba de Desafios no Lemon Club',        categoria: 'Exploração' },
  ver_historico:       { label: 'Ver histórico de pontos',       pts: 5,   icon: 'fa-clock-rotate-left',  cor: '#67e8f9', desc: 'Confira seu histórico de pontos ganhos',        categoria: 'Exploração' },
  acesso_noturno:      { label: 'Acesso noturno',                pts: 10,  icon: 'fa-moon',               cor: '#818cf8', desc: 'Acesse o portal após as 22h',                  categoria: 'Exploração' },

  // ── App & Perfil ────────────────────────────────────────────────────
  perfil_completo:     { label: 'Completar o perfil',            pts: 15,  icon: 'fa-id-card',            cor: '#22d3ee', desc: 'Preencha todos os seus dados de contato',       categoria: 'App & Perfil' },
  instalar_app:        { label: 'Instalar o Lemon App',          pts: 20,  icon: 'fa-mobile-screen',      cor: '#b6c33f', desc: 'Adicione o app à sua tela inicial',             categoria: 'App & Perfil' },
  compartilhar_link:   { label: 'Copiar link de indicação',      pts: 10,  icon: 'fa-copy',               cor: '#38bdf8', desc: 'Copie seu link de indicação exclusivo',         categoria: 'App & Perfil' },
  ativar_notif:        { label: 'Ativar notificações',           pts: 15,  icon: 'fa-bell',               cor: '#fbbf24', desc: 'Ative as notificações push do portal',          categoria: 'App & Perfil' },
  mudar_dados:         { label: 'Atualizar dados de contato',    pts: 10,  icon: 'fa-pen-to-square',      cor: '#86efac', desc: 'Salve seus dados atualizados no perfil',        categoria: 'App & Perfil' },
  indicar_whatsapp:    { label: 'Enviar link pelo WhatsApp',     pts: 15,  icon: 'fa-whatsapp',           cor: '#4ade80', desc: 'Use o compartilhamento do portal para mandar seu link de indicação pelo WhatsApp (App & Perfil).', categoria: 'App & Perfil' },
  login_3x:            { label: 'Acessar o portal 3 vezes',      pts: 15,  icon: 'fa-arrow-right-to-bracket', cor: '#a78bfa', desc: 'Faça login no portal 3 vezes diferentes',  categoria: 'App & Perfil' },
  uso_semanal:         { label: 'Usar em 3 dias diferentes',     pts: 20,  icon: 'fa-calendar-check',     cor: '#fb923c', desc: 'Acesse o portal em 3 dias distintos',          categoria: 'App & Perfil' },

  // ── Teste de Velocidade ─────────────────────────────────────────────
  speedtest:           { label: 'Primeiro teste de velocidade',  pts: 5,   icon: 'fa-gauge-high',         cor: '#818cf8', desc: 'Faça seu primeiro teste de velocidade',         categoria: 'Velocidade' },
  speedtest_3x:        { label: 'Testar 3 vezes',                pts: 15,  icon: 'fa-rotate',             cor: '#a78bfa', desc: 'Realize 3 testes de velocidade',                categoria: 'Velocidade' },
  speedtest_excelente: { label: 'Velocidade excelente',          pts: 20,  icon: 'fa-star',               cor: '#fbbf24', desc: 'Obtenha resultado excelente (≥90% do plano)',   categoria: 'Velocidade' },
  speedtest_5x:        { label: 'Testar 5 vezes',                pts: 25,  icon: 'fa-arrows-rotate',      cor: '#818cf8', desc: 'Realize 5 testes de velocidade',                categoria: 'Velocidade' },
  speedtest_10x:       { label: 'Testar 10 vezes',               pts: 40,  icon: 'fa-infinity',           cor: '#c084fc', desc: 'Realize 10 testes de velocidade',               categoria: 'Velocidade' },
  speedtest_manha:     { label: 'Teste matinal',                 pts: 10,  icon: 'fa-sun',                cor: '#fbbf24', desc: 'Faça um teste entre 6h e 12h',                  categoria: 'Velocidade' },
  speedtest_noite:     { label: 'Teste noturno',                 pts: 10,  icon: 'fa-moon',               cor: '#60a5fa', desc: 'Faça um teste entre 20h e 23h',                 categoria: 'Velocidade' },
  speedtest_100:       { label: 'Velocidade máxima!',            pts: 30,  icon: 'fa-circle-check',       cor: '#4ade80', desc: 'Atinja 100% da velocidade do seu plano',        categoria: 'Velocidade' },
  speedtest_semana:    { label: 'Testador assíduo',              pts: 15,  icon: 'fa-calendar-days',      cor: '#67e8f9', desc: 'Faça testes em 3 dias diferentes',              categoria: 'Velocidade' },

  // ── Fidelidade ──────────────────────────────────────────────────────
  pagamento_1:         { label: 'Primeira fatura em dia',        pts: 10,  icon: 'fa-check-circle',       cor: '#4ade80', desc: 'Primeira fatura paga até o vencimento, contabilizada no portal.', categoria: 'Fidelidade', auto: true },
  pagamento_5:         { label: '5 faturas em dia',              pts: 25,  icon: 'fa-circle-check',       cor: '#86efac', desc: '5 faturas distintas pagas até o vencimento (sincronização MK / pagamentos no portal).', categoria: 'Fidelidade', auto: true },
  pagamento_10:        { label: '10 faturas em dia',             pts: 50,  icon: 'fa-shield-check',       cor: '#22d3ee', desc: '10 faturas distintas pagas até o vencimento, contabilizadas no Lemon.', categoria: 'Fidelidade', auto: true },
  streak_3:            { label: '3 faturas em dia',              pts: 50,  icon: 'fa-fire',               cor: '#fb923c', desc: 'Total de 3 faturas pontuadas como pagas no prazo no clube.', categoria: 'Fidelidade', auto: true },
  streak_6:            { label: '6 faturas em dia',              pts: 100, icon: 'fa-fire-flame-curved',  cor: '#f97316', desc: 'Total de 6 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  streak_9:            { label: '9 faturas em dia',              pts: 150, icon: 'fa-fire-flame-curved',  cor: '#ef4444', desc: 'Total de 9 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  maratonista:         { label: '15 faturas em dia',             pts: 75,  icon: 'fa-person-running',     cor: '#f59e0b', desc: 'Total de 15 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  streak_12:           { label: '12 faturas em dia',             pts: 200, icon: 'fa-crown',              cor: '#f59e0b', desc: 'Total de 12 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  streak_18:           { label: '18 faturas em dia',             pts: 150, icon: 'fa-gem',                cor: '#a78bfa', desc: 'Total de 18 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  streak_24:           { label: '24 faturas em dia',             pts: 300, icon: 'fa-trophy',             cor: '#f59e0b', desc: 'Total de 24 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },

  // ── Indicações ──────────────────────────────────────────────────────
  indicar_1:           { label: 'Primeiro indicado',             pts: 25,  icon: 'fa-user-plus',          cor: '#b6c33f', desc: 'Indique seu primeiro amigo com sucesso',        categoria: 'Indicações', auto: true },
  indicar_2:           { label: '2 amigos indicados',            pts: 50,  icon: 'fa-user-group',         cor: '#a3e635', desc: 'Indique 2 amigos que assinaram a Lemon',       categoria: 'Indicações', auto: true },
  indicar_3:           { label: '3 amigos indicados',            pts: 75,  icon: 'fa-users',              cor: '#86efac', desc: 'Indique 3 amigos que assinaram a Lemon',       categoria: 'Indicações', auto: true },
  indicar_5:           { label: '5 amigos indicados',            pts: 125, icon: 'fa-people-group',       cor: '#4ade80', desc: 'Indique 5 amigos — você é o melhor!',          categoria: 'Indicações', auto: true },
  indicar_7:           { label: '7 amigos indicados',            pts: 175, icon: 'fa-people-roof',        cor: '#22d3ee', desc: 'Indique 7 amigos que assinaram a Lemon.',       categoria: 'Indicações', auto: true },
  indicar_10:          { label: '10 amigos indicados',           pts: 250, icon: 'fa-city',               cor: '#38bdf8', desc: '10 amigos indicados — você é lendário!',       categoria: 'Indicações', auto: true },
  indicar_15:          { label: '15 amigos indicados',           pts: 375, icon: 'fa-star',               cor: '#fbbf24', desc: '15 indicações — mestre das indicações!',       categoria: 'Indicações', auto: true },
  indicar_20:          { label: '20 amigos indicados',           pts: 500, icon: 'fa-crown',              cor: '#f59e0b', desc: '20 indicações — nível elite supremo!',         categoria: 'Indicações', auto: true },
  embaixador:          { label: 'Divulgar o Lemon Club',         pts: 10,  icon: 'fa-bullhorn',           cor: '#22d3ee', desc: 'Compartilhe o portal ou seu link de indicação a partir do Lemon Club (área de indicações).', categoria: 'Indicações' },

  // ── Conquistas de Nível ─────────────────────────────────────────────
  clube_prata:         { label: 'Alcançar nível Prata',          pts: 25,  icon: 'fa-medal',              cor: '#94a3b8', desc: 'Atinja 500 pontos ganhos no total',             categoria: 'Conquistas', auto: true },
  clube_ouro:          { label: 'Alcançar nível Ouro',           pts: 50,  icon: 'fa-trophy',             cor: '#f59e0b', desc: 'Atinja 1500 pontos ganhos no total',            categoria: 'Conquistas', auto: true },
  clube_diamante:      { label: 'Alcançar nível Diamante',       pts: 100, icon: 'fa-gem',                cor: '#818cf8', desc: 'Atinja 3000 pontos — elite Lemon!',             categoria: 'Conquistas', auto: true },
  missoes_5:           { label: 'Completar 5 missões',           pts: 15,  icon: 'fa-list-check',         cor: '#4ade80', desc: 'Complete 5 desafios do Lemon Club',             categoria: 'Conquistas', auto: true },
  missoes_10:          { label: 'Completar 10 missões',          pts: 30,  icon: 'fa-check-double',       cor: '#22d3ee', desc: 'Complete 10 desafios do Lemon Club',            categoria: 'Conquistas', auto: true },
  missoes_15:          { label: 'Completar 15 missões',          pts: 50,  icon: 'fa-star-half-stroke',   cor: '#fbbf24', desc: 'Complete 15 desafios — você está voando!',     categoria: 'Conquistas', auto: true },
  missoes_20:          { label: 'Completar 20 missões',          pts: 75,  icon: 'fa-star',               cor: '#f59e0b', desc: 'Complete 20 desafios — campeão do clube!',     categoria: 'Conquistas', auto: true },
  resgatar_1:          { label: 'Primeiro resgate de pontos',    pts: 10,  icon: 'fa-ticket',             cor: '#a78bfa', desc: 'Resgate um benefício pela primeira vez',        categoria: 'Conquistas', auto: true },
  colecionador:        { label: 'Resgatar 3 vezes',              pts: 25,  icon: 'fa-bag-shopping',       cor: '#818cf8', desc: 'Resgate benefícios 3 vezes no total',           categoria: 'Conquistas', auto: true },
};

// ── Funções de domínio ─────────────────────────────────────────────────────

function getLevel(totalEarned) {
  return LEVELS.find(l => totalEarned >= l.min && totalEarned <= l.max) || LEVELS[0];
}

function initClient(login) {
  return {
    points: 0, totalEarned: 0, referrals: [], redeemed: [], log: [],
    awardedInvoices: [], completedMissions: [], streak: 0,
    speedtests: [],
    loginHistory: [],
    visitedSections: [],
    clubFaturaDesconto: { pendente: null, aplicados: [] },
    pushNotifPrefs: mergePrefs({}),
  };
}

function getClientData(login) {
  let c = loadClient(login);
  if (!c) c = initClient(login);
  if (c.totalEarned === undefined)   c.totalEarned = c.points;
  if (!c.log)                        c.log = [];
  if (!c.awardedInvoices)            c.awardedInvoices = [];
  if (!c.completedMissions)          c.completedMissions = [];
  if (c.streak === undefined)        c.streak = 0;
  if (!c.speedtests)                 c.speedtests = [];
  if (!c.loginHistory)               c.loginHistory = [];
  else c.loginHistory = c.loginHistory.slice(-100);
  if (!c.visitedSections)            c.visitedSections = [];
  if (!c.clubFaturaDesconto || typeof c.clubFaturaDesconto !== 'object') {
    c.clubFaturaDesconto = normalizarClubFaturaDesconto(null);
  } else {
    c.clubFaturaDesconto = normalizarClubFaturaDesconto(serializarClubFaturaDesconto(c.clubFaturaDesconto));
  }
  if (!c.pushNotifPrefs || typeof c.pushNotifPrefs !== 'object') c.pushNotifPrefs = mergePrefs({});
  else c.pushNotifPrefs = mergePrefs(c.pushNotifPrefs);
  const db = {};
  db[login] = c;
  return db;
}

function addPoints(db, login, pts, tipo, descricao) {
  const c = db[login];
  c.points      = (c.points      || 0) + pts;
  c.totalEarned = (c.totalEarned || 0) + pts;
  c.log.unshift({ data: new Date().toISOString(), pontos: pts, tipo, descricao });
  c.log = c.log.slice(0, 100);
}

function awardPoints(referrerLogin, newClientLogin, newClientNome) {
  const db = getClientData(referrerLogin);
  const c = db[referrerLogin];
  const already = (c.referrals || []).some(r => r.login === newClientLogin);
  if (already) return false;

  let pts = 200;
  const redeemed = c.redeemed || [];
  const dobroResgate = redeemed.find(r => r.tipo === 'indicacao_dobro' && !r.usado);
  if (dobroResgate) {
    pts = 400;
    if (!dobroResgate.usosRestantes) dobroResgate.usosRestantes = 2;
    dobroResgate.usosRestantes--;
    if (dobroResgate.usosRestantes <= 0) dobroResgate.usado = true;
  }

  addPoints(db, referrerLogin, pts, 'indicacao', `Indicação de ${newClientNome}${pts > 200 ? ' (bônus dobro!)' : ''}`);
  c.referrals = c.referrals || [];
  c.referrals.push({ login: newClientLogin, nome: newClientNome, data: new Date().toISOString(), pontos: pts });

  // Desbloqueia missões de indicação imediatamente ao registrar a indicação
  if (!c.completedMissions) c.completedMissions = [];
  const totalRef = c.referrals.length;
  const missoesMilestones = [
    [1,  'indicar_1'],
    [2,  'indicar_2'],
    [3,  'indicar_3'],
    [5,  'indicar_5'],
    [7,  'indicar_7'],
    [10, 'indicar_10'],
    [15, 'indicar_15'],
    [20, 'indicar_20'],
  ];
  for (const [min, id] of missoesMilestones) {
    if (totalRef >= min) {
      const m = MISSIONS[id];
      if (m && !c.completedMissions.includes(id)) {
        addPoints(db, referrerLogin, m.pts, 'conquista', `🎯 Missão: ${m.label}`);
        c.completedMissions.push(id);
      }
    }
  }

  // Verifica conquistas de nível que possam ter sido desbloqueadas
  const nivelMissoes = [
    [500,  'clube_prata'],
    [1500, 'clube_ouro'],
    [3000, 'clube_diamante'],
  ];
  for (const [min, id] of nivelMissoes) {
    const m = MISSIONS[id];
    if (m && c.totalEarned >= min && !c.completedMissions.includes(id)) {
      addPoints(db, referrerLogin, m.pts, 'conquista', `🎯 Missão: ${m.label}`);
      c.completedMissions.push(id);
    }
  }

  saveClient(referrerLogin, c);
  return true;
}

function concederPontosMP(login, tituloUuid) {
  try {
    const db = getClientData(login);
    const c  = db[login];
    if (!c.awardedInvoices) c.awardedInvoices = [];
    if (!c.completedMissions) c.completedMissions = [];

    const id = String(tituloUuid || '');
    if (id && c.awardedInvoices.includes(id)) {
      console.log(`[Pontos MP] Fatura ${id} já pontuada para ${login}`);
      return { novos: 0, streak: c.awardedInvoices.length };
    }

    addPoints(db, login, 50, 'pagamento', `Pagamento via PIX/Mercado Pago${id ? ' — fatura ' + id : ''}`);
    if (id) c.awardedInvoices.push(id);

    c.streak = c.awardedInvoices.length;

    let novos = 1;
    function autoMission(missaoId, tipo = 'missao') {
      const m = MISSIONS[missaoId];
      if (!m || c.completedMissions.includes(missaoId)) return;
      addPoints(db, login, m.pts, tipo, `🎯 Missão: ${m.label}`);
      c.completedMissions.push(missaoId);
      novos++;
    }

    if (c.streak >= 1)  autoMission('pagamento_1',  'pagamento');
    if (c.streak >= 5)  autoMission('pagamento_5',  'pagamento');
    if (c.streak >= 10) autoMission('pagamento_10', 'pagamento');

    if (c.streak >= 3)  autoMission('streak_3',  'streak');
    if (c.streak >= 6)  autoMission('streak_6',  'streak');
    if (c.streak >= 9)  autoMission('streak_9',  'streak');
    if (c.streak >= 12) autoMission('streak_12', 'streak');
    if (c.streak >= 15) autoMission('maratonista', 'streak');
    if (c.streak >= 18) autoMission('streak_18', 'streak');
    if (c.streak >= 24) autoMission('streak_24', 'streak');

    const totalRef = (c.referrals || []).length;
    if (totalRef >= 1)  autoMission('indicar_1',  'indicacao');
    if (totalRef >= 2)  autoMission('indicar_2',  'indicacao');
    if (totalRef >= 3)  autoMission('indicar_3',  'indicacao');
    if (totalRef >= 5)  autoMission('indicar_5',  'indicacao');
    if (totalRef >= 7)  autoMission('indicar_7',  'indicacao');
    if (totalRef >= 10) autoMission('indicar_10', 'indicacao');
    if (totalRef >= 15) autoMission('indicar_15', 'indicacao');
    if (totalRef >= 20) autoMission('indicar_20', 'indicacao');

    const totalMissoes  = c.completedMissions.length;
    const totalResgates = (c.redeemed || []).length;
    if (totalMissoes >= 5)  autoMission('missoes_5',   'conquista');
    if (totalMissoes >= 10) autoMission('missoes_10',  'conquista');
    if (totalMissoes >= 15) autoMission('missoes_15',  'conquista');
    if (totalMissoes >= 20) autoMission('missoes_20',  'conquista');
    if (totalResgates >= 1) autoMission('resgatar_1', 'conquista');
    if (totalResgates >= 3) autoMission('colecionador', 'conquista');

    if (c.totalEarned >= 500)  autoMission('clube_prata',    'conquista');
    if (c.totalEarned >= 1500) autoMission('clube_ouro',     'conquista');
    if (c.totalEarned >= 3000) autoMission('clube_diamante', 'conquista');

    saveClient(login, c);
    console.log(`[Pontos MP] +50pts para ${login} | streak=${c.streak} | total=${c.points}`);
    return { novos, streak: c.streak, totalPts: c.points };
  } catch (e) {
    console.error('[Pontos MP] Erro:', e.message);
    return { novos: 0 };
  }
}

module.exports = {
  LEVELS,
  MISSIONS,
  rowToClient,
  stmtGet,
  stmtUpsert,
  loadReferrals,
  saveReferrals,
  loadClient,
  saveClient,
  getLevel,
  initClient,
  getClientData,
  addPoints,
  awardPoints,
  concederPontosMP,
};
