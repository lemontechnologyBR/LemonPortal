require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const config = require('./lib/config');
const { sqliteDb } = require('./lib/database');
const pushLib = require('./lib/push');
const { mergePrefs, parsePushNotifPrefsJson, getPrefsForLogin } = require('./lib/push-notif-prefs');
const { startPushFaturaReminderJob } = require('./lib/push-fatura-reminders');
const { getMikrotikConexao } = require('./lib/mikrotik');
const { getJWT, mkGet, mkPost, mkPut, mkDelete } = require('./lib/mk-api');
const {
  normalizarClubFaturaDesconto,
  serializarClubFaturaDesconto,
  tipoResgateEhDescontoNaFatura,
  faturaDescontoTipoPercent,
  uuidTituloAlvoDescontoClube,
  tituloAlvoDescontoClubeCompleto,
  reconciliarPendenteDescontoClube,
  enriquecerTituloComDescontoClube,
  enriquecerListaFaturasClube,
  enriquecerListaFaturasClubePosReconciliar,
  enriquecerTituloComDescontoClubePosReconciliar,
  garantirUuidTituloPayload,
} = require('./lib/clube-fatura-desconto');
const { enrichClienteComVelocidadePlano } = require('./lib/plano-match');
const { mpWalletGetOrCreateCustomer } = require('./lib/mercadopago-wallet');
const { registerMercadoPagoRoutes, startMercadoPagoPendingJob } = require('./routes/mercadopago');
const { registerWatchBrasilRoutes } = require('./routes/watch-brasil');

const {
  PORT,
  MK_URL,
  MP_TOKEN,
  MP_PUBKEY,
  MP_BASE,
  LEMON_PORTAL_PUBLIC,
  ADMIN_USER,
  ADMIN_PASS,
  mpChavesMercadoPagoAlinhadas,
  mpAccessTokenEhTeste,
} = config;

const app = express();

const SESSION_SECRET =
  String(process.env.SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
if (!String(process.env.SESSION_SECRET || '').trim()) {
  console.warn('[Sessão] SESSION_SECRET ausente no .env — usando segredo aleatório (sessões invalidam ao reiniciar).');
}

// Deserializa uma linha do SQLite para o formato interno { login: {...} }
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
    pushNotifPrefs: parsePushNotifPrefsJson(row.push_notif_prefs),
  };
}

const stmtGet    = sqliteDb.prepare('SELECT * FROM clients WHERE login = ?');
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

// Compatível com o restante do código: retorna objeto { [login]: dadosCliente }
function loadReferrals() {
  const rows = sqliteDb.prepare('SELECT * FROM clients').all();
  const db = {};
  for (const row of rows) db[row.login] = rowToClient(row);
  return db;
}

// Salva todos os clientes modificados no db-object de volta ao SQLite (transação atômica)
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

// Níveis de gamificação
const LEVELS = [
  { id: 'bronze',   label: 'Bronze',   min: 0,    max: 499,  icon: '🥉', color: '#cd7f32' },
  { id: 'prata',    label: 'Prata',    min: 500,  max: 1499, icon: '🥈', color: '#94a3b8' },
  { id: 'ouro',     label: 'Ouro',     min: 1500, max: 2999, icon: '🥇', color: '#f59e0b' },
  { id: 'diamante', label: 'Diamante', min: 3000, max: Infinity, icon: '💎', color: '#818cf8' },
];

// Missões disponíveis (id → { label, pts, icon, cor, desc, categoria, auto })
// auto: true = completada pelo servidor; false = cliente envia POST /missao
const MISSIONS = {
  // ── Exploração ──────────────────────────────────────────────────────
  primeiro_login:      { label: 'Primeiro acesso ao portal',    pts: 15,  icon: 'fa-door-open',         cor: '#818cf8', desc: 'Acesse o portal pela primeira vez',              categoria: 'Exploração' },
  ver_fatura:          { label: 'Verificar suas faturas',        pts: 10,  icon: 'fa-file-invoice',       cor: '#22d3ee', desc: 'Visite a seção de faturas',                     categoria: 'Exploração' },
  ver_conexao:         { label: 'Verificar sua conexão',         pts: 10,  icon: 'fa-wifi',               cor: '#4ade80', desc: 'Acesse a tela Minha Conexão',                  categoria: 'Exploração' },
  abrir_chamado:       { label: 'Abrir um chamado',              pts: 15,  icon: 'fa-headset',            cor: '#fb923c', desc: 'Envie sua primeira solicitação de suporte',    categoria: 'Exploração' },
  explorador:          { label: 'Explorador do portal',          pts: 40,  icon: 'fa-compass',            cor: '#c084fc', desc: 'Visite todas as seções do portal',              categoria: 'Exploração' },
  ver_velocidade_sec:  { label: 'Visitar Teste de Velocidade',  pts: 10,  icon: 'fa-gauge-high',         cor: '#a78bfa', desc: 'Acesse a seção de Teste de Velocidade',         categoria: 'Exploração' },
  ver_perfil_sec:      { label: 'Visitar seu perfil',            pts: 10,  icon: 'fa-user-circle',        cor: '#38bdf8', desc: 'Acesse a seção Meu Perfil',                    categoria: 'Exploração' },
  ver_suporte_sec:     { label: 'Visitar seção de suporte',      pts: 10,  icon: 'fa-life-ring',          cor: '#fb923c', desc: 'Acesse a área de suporte e chamados',           categoria: 'Exploração' },
  ver_desafios:        { label: 'Ver seus desafios',             pts: 15,  icon: 'fa-list-check',         cor: '#c084fc', desc: 'Acesse a aba de Desafios no Lemon Club',        categoria: 'Exploração' },
  ver_historico:       { label: 'Ver histórico de pontos',       pts: 15,  icon: 'fa-clock-rotate-left',  cor: '#67e8f9', desc: 'Confira seu histórico de pontos ganhos',        categoria: 'Exploração' },
  acesso_noturno:      { label: 'Acesso noturno',                pts: 20,  icon: 'fa-moon',               cor: '#818cf8', desc: 'Acesse o portal após as 22h',                  categoria: 'Exploração' },

  // ── App & Perfil ────────────────────────────────────────────────────
  perfil_completo:     { label: 'Completar o perfil',            pts: 20,  icon: 'fa-id-card',            cor: '#22d3ee', desc: 'Preencha todos os seus dados de contato',       categoria: 'App & Perfil' },
  instalar_app:        { label: 'Instalar o Lemon App',          pts: 30,  icon: 'fa-mobile-screen',      cor: '#b6c33f', desc: 'Adicione o app à sua tela inicial',             categoria: 'App & Perfil' },
  compartilhar_link:   { label: 'Copiar link de indicação',      pts: 15,  icon: 'fa-copy',               cor: '#38bdf8', desc: 'Copie seu link de indicação exclusivo',         categoria: 'App & Perfil' },
  ativar_notif:        { label: 'Ativar notificações',           pts: 20,  icon: 'fa-bell',               cor: '#fbbf24', desc: 'Ative as notificações push do portal',          categoria: 'App & Perfil' },
  mudar_dados:         { label: 'Atualizar dados de contato',    pts: 15,  icon: 'fa-pen-to-square',      cor: '#86efac', desc: 'Salve seus dados atualizados no perfil',        categoria: 'App & Perfil' },
  indicar_whatsapp:    { label: 'Enviar link pelo WhatsApp',     pts: 20,  icon: 'fa-whatsapp',           cor: '#4ade80', desc: 'Use o compartilhamento do portal para mandar seu link de indicação pelo WhatsApp (App & Perfil).', categoria: 'App & Perfil' },
  login_3x:            { label: 'Acessar o portal 3 vezes',      pts: 25,  icon: 'fa-arrow-right-to-bracket', cor: '#a78bfa', desc: 'Faça login no portal 3 vezes diferentes',  categoria: 'App & Perfil' },
  uso_semanal:         { label: 'Usar em 3 dias diferentes',     pts: 35,  icon: 'fa-calendar-check',     cor: '#fb923c', desc: 'Acesse o portal em 3 dias distintos',          categoria: 'App & Perfil' },

  // ── Teste de Velocidade ─────────────────────────────────────────────
  speedtest:           { label: 'Primeiro teste de velocidade',  pts: 10,  icon: 'fa-gauge-high',         cor: '#818cf8', desc: 'Faça seu primeiro teste de velocidade',         categoria: 'Velocidade' },
  speedtest_3x:        { label: 'Testar 3 vezes',                pts: 25,  icon: 'fa-rotate',             cor: '#a78bfa', desc: 'Realize 3 testes de velocidade',                categoria: 'Velocidade' },
  speedtest_excelente: { label: 'Velocidade excelente',          pts: 30,  icon: 'fa-star',               cor: '#fbbf24', desc: 'Obtenha resultado excelente (≥90% do plano)',   categoria: 'Velocidade' },
  speedtest_5x:        { label: 'Testar 5 vezes',                pts: 40,  icon: 'fa-arrows-rotate',      cor: '#818cf8', desc: 'Realize 5 testes de velocidade',                categoria: 'Velocidade' },
  speedtest_10x:       { label: 'Testar 10 vezes',               pts: 75,  icon: 'fa-infinity',           cor: '#c084fc', desc: 'Realize 10 testes de velocidade',               categoria: 'Velocidade' },
  speedtest_manha:     { label: 'Teste matinal',                 pts: 20,  icon: 'fa-sun',                cor: '#fbbf24', desc: 'Faça um teste entre 6h e 12h',                  categoria: 'Velocidade' },
  speedtest_noite:     { label: 'Teste noturno',                 pts: 20,  icon: 'fa-moon',               cor: '#60a5fa', desc: 'Faça um teste entre 20h e 23h',                 categoria: 'Velocidade' },
  speedtest_100:       { label: 'Velocidade máxima!',            pts: 50,  icon: 'fa-circle-check',       cor: '#4ade80', desc: 'Atinja 100% da velocidade do seu plano',        categoria: 'Velocidade' },
  speedtest_semana:    { label: 'Testador assíduo',              pts: 30,  icon: 'fa-calendar-days',      cor: '#67e8f9', desc: 'Faça testes em 3 dias diferentes',              categoria: 'Velocidade' },

  // ── Fidelidade ──────────────────────────────────────────────────────
  pagamento_1:         { label: 'Primeira fatura em dia',        pts: 25,  icon: 'fa-check-circle',       cor: '#4ade80', desc: 'Primeira fatura paga até o vencimento, contabilizada no portal.', categoria: 'Fidelidade', auto: true },
  pagamento_5:         { label: '5 faturas em dia',              pts: 50,  icon: 'fa-circle-check',       cor: '#86efac', desc: '5 faturas distintas pagas até o vencimento (sincronização MK / pagamentos no portal).', categoria: 'Fidelidade', auto: true },
  pagamento_10:        { label: '10 faturas em dia',             pts: 100, icon: 'fa-shield-check',       cor: '#22d3ee', desc: '10 faturas distintas pagas até o vencimento, contabilizadas no Lemon.', categoria: 'Fidelidade', auto: true },
  streak_3:            { label: '3 faturas em dia',              pts: 100, icon: 'fa-fire',               cor: '#fb923c', desc: 'Total de 3 faturas pontuadas como pagas no prazo no clube.', categoria: 'Fidelidade', auto: true },
  streak_6:            { label: '6 faturas em dia',              pts: 200, icon: 'fa-fire-flame-curved',  cor: '#f97316', desc: 'Total de 6 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  streak_9:            { label: '9 faturas em dia',              pts: 300, icon: 'fa-fire-flame-curved',  cor: '#ef4444', desc: 'Total de 9 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  maratonista:         { label: '15 faturas em dia',             pts: 150, icon: 'fa-person-running',     cor: '#f59e0b', desc: 'Total de 15 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  streak_12:           { label: '12 faturas em dia',             pts: 500, icon: 'fa-crown',              cor: '#f59e0b', desc: 'Total de 12 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  streak_18:           { label: '18 faturas em dia',             pts: 400, icon: 'fa-gem',                cor: '#a78bfa', desc: 'Total de 18 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },
  streak_24:           { label: '24 faturas em dia',             pts: 750, icon: 'fa-trophy',             cor: '#f59e0b', desc: 'Total de 24 faturas pontuadas como pagas no prazo.', categoria: 'Fidelidade', auto: true },

  // ── Indicações ──────────────────────────────────────────────────────
  indicar_1:           { label: 'Primeiro indicado',             pts: 50,  icon: 'fa-user-plus',          cor: '#b6c33f', desc: 'Indique seu primeiro amigo com sucesso',        categoria: 'Indicações', auto: true },
  indicar_2:           { label: '2 amigos indicados',            pts: 100, icon: 'fa-user-group',         cor: '#a3e635', desc: 'Indique 2 amigos que assinaram a Lemon',       categoria: 'Indicações', auto: true },
  indicar_3:           { label: '3 amigos indicados',            pts: 150, icon: 'fa-users',              cor: '#86efac', desc: 'Indique 3 amigos que assinaram a Lemon',       categoria: 'Indicações', auto: true },
  indicar_5:           { label: '5 amigos indicados',            pts: 300, icon: 'fa-people-group',       cor: '#4ade80', desc: 'Indique 5 amigos — você é o melhor!',          categoria: 'Indicações', auto: true },
  indicar_7:           { label: '7 amigos indicados',            pts: 400, icon: 'fa-people-roof',        cor: '#22d3ee', desc: 'Indique 7 amigos que assinaram a Lemon.',         categoria: 'Indicações', auto: true },
  indicar_10:          { label: '10 amigos indicados',           pts: 600, icon: 'fa-city',               cor: '#38bdf8', desc: '10 amigos indicados — você é lendário!',       categoria: 'Indicações', auto: true },
  indicar_15:          { label: '15 amigos indicados',           pts: 900, icon: 'fa-star',               cor: '#fbbf24', desc: '15 indicações — mestre das indicações!',       categoria: 'Indicações', auto: true },
  indicar_20:          { label: '20 amigos indicados',           pts: 1200,icon: 'fa-crown',              cor: '#f59e0b', desc: '20 indicações — nível elite supremo!',         categoria: 'Indicações', auto: true },
  embaixador:          { label: 'Divulgar o Lemon Club',         pts: 20,  icon: 'fa-bullhorn',           cor: '#22d3ee', desc: 'Compartilhe o portal ou seu link de indicação a partir do Lemon Club (área de indicações).', categoria: 'Indicações' },

  // ── Conquistas de Nível ─────────────────────────────────────────────
  clube_prata:         { label: 'Alcançar nível Prata',          pts: 50,  icon: 'fa-medal',              cor: '#94a3b8', desc: 'Atinja 500 pontos ganhos no total',             categoria: 'Conquistas', auto: true },
  clube_ouro:          { label: 'Alcançar nível Ouro',           pts: 100, icon: 'fa-trophy',             cor: '#f59e0b', desc: 'Atinja 1500 pontos ganhos no total',            categoria: 'Conquistas', auto: true },
  clube_diamante:      { label: 'Alcançar nível Diamante',       pts: 200, icon: 'fa-gem',                cor: '#818cf8', desc: 'Atinja 3000 pontos — elite Lemon!',             categoria: 'Conquistas', auto: true },
  missoes_5:           { label: 'Completar 5 missões',           pts: 30,  icon: 'fa-list-check',         cor: '#4ade80', desc: 'Complete 5 desafios do Lemon Club',             categoria: 'Conquistas', auto: true },
  missoes_10:          { label: 'Completar 10 missões',          pts: 60,  icon: 'fa-check-double',       cor: '#22d3ee', desc: 'Complete 10 desafios do Lemon Club',            categoria: 'Conquistas', auto: true },
  missoes_15:          { label: 'Completar 15 missões',          pts: 100, icon: 'fa-star-half-stroke',   cor: '#fbbf24', desc: 'Complete 15 desafios — você está voando!',     categoria: 'Conquistas', auto: true },
  missoes_20:          { label: 'Completar 20 missões',          pts: 150, icon: 'fa-star',               cor: '#f59e0b', desc: 'Complete 20 desafios — campeão do clube!',     categoria: 'Conquistas', auto: true },
  resgatar_1:          { label: 'Primeiro resgate de pontos',    pts: 20,  icon: 'fa-ticket',             cor: '#a78bfa', desc: 'Resgate um benefício pela primeira vez',        categoria: 'Conquistas', auto: true },
  colecionador:        { label: 'Resgatar 3 vezes',              pts: 50,  icon: 'fa-bag-shopping',       cor: '#818cf8', desc: 'Resgate benefícios 3 vezes no total',           categoria: 'Conquistas', auto: true },
};

function getLevel(totalEarned) {
  return LEVELS.find(l => totalEarned >= l.min && totalEarned <= l.max) || LEVELS[0];
}

function initClient(login) {
  return {
    points: 0, totalEarned: 0, referrals: [], redeemed: [], log: [],
    awardedInvoices: [], completedMissions: [], streak: 0, // streak = nº faturas distintas pontuadas em dia (não “meses” de calendário)
    // Dados reais para validação de missões
    speedtests: [],      // { ts, dl, ul, ping, hora, data }
    loginHistory: [],    // { ts, hora, data }
    visitedSections: [], // seções visitadas (strings)
    clubFaturaDesconto: { pendente: null, aplicados: [] },
    pushNotifPrefs: mergePrefs({}),
  };
}

function getClientData(login) {
  const db = loadReferrals();
  if (!db[login]) db[login] = initClient(login);
  // Migração: garantir campos novos
  const c = db[login];
  if (c.totalEarned === undefined)   c.totalEarned = c.points;
  if (!c.log)                        c.log = [];
  if (!c.awardedInvoices)            c.awardedInvoices = [];
  if (!c.completedMissions)          c.completedMissions = [];
  if (c.streak === undefined)        c.streak = 0;
  if (!c.speedtests)                 c.speedtests = [];
  if (!c.loginHistory)               c.loginHistory = [];
  if (!c.visitedSections)            c.visitedSections = [];
  if (!c.clubFaturaDesconto || typeof c.clubFaturaDesconto !== 'object') {
    c.clubFaturaDesconto = normalizarClubFaturaDesconto(null);
  } else {
    c.clubFaturaDesconto = normalizarClubFaturaDesconto(serializarClubFaturaDesconto(c.clubFaturaDesconto));
  }
  if (!c.pushNotifPrefs || typeof c.pushNotifPrefs !== 'object') c.pushNotifPrefs = mergePrefs({});
  else c.pushNotifPrefs = mergePrefs(c.pushNotifPrefs);
  return db;
}

function addPoints(db, login, pts, tipo, descricao) {
  const c = db[login];
  c.points      = (c.points      || 0) + pts;
  c.totalEarned = (c.totalEarned || 0) + pts;
  c.log.unshift({ data: new Date().toISOString(), pontos: pts, tipo, descricao });
  c.log = c.log.slice(0, 100); // máximo 100 registros
}

function awardPoints(referrerLogin, newClientLogin, newClientNome) {
  const db = getClientData(referrerLogin);
  const c = db[referrerLogin];
  const already = (c.referrals || []).some(r => r.login === newClientLogin);
  if (already) return false;

  // Verificar se tem resgate "indicacao_dobro" ativo (2 próximas indicações = 200 pts cada)
  let pts = 100;
  const redeemed = c.redeemed || [];
  const dobroResgate = redeemed.find(r => r.tipo === 'indicacao_dobro' && !r.usado);
  if (dobroResgate) {
    pts = 200;
    if (!dobroResgate.usosRestantes) dobroResgate.usosRestantes = 2;
    dobroResgate.usosRestantes--;
    if (dobroResgate.usosRestantes <= 0) dobroResgate.usado = true;
  }

  addPoints(db, referrerLogin, pts, 'indicacao', `Indicação de ${newClientNome}${pts > 100 ? ' (bônus dobro!)' : ''}`);
  c.referrals = c.referrals || [];
  c.referrals.push({ login: newClientLogin, nome: newClientNome, data: new Date().toISOString(), pontos: pts });
  saveReferrals(db);
  return true;
}

// Concede pontos após pagamento via Mercado Pago
function concederPontosMP(login, tituloUuid) {
  try {
    const db = getClientData(login);
    const c  = db[login];
    if (!c.awardedInvoices) c.awardedInvoices = [];
    if (!c.completedMissions) c.completedMissions = [];

    // Evita duplicidade: só concede pontos uma vez por fatura
    const id = String(tituloUuid || '');
    if (id && c.awardedInvoices.includes(id)) {
      console.log(`[Pontos MP] Fatura ${id} já pontuada para ${login}`);
      return { novos: 0, streak: c.awardedInvoices.length };
    }

    // 25 pontos por pagamento via portal
    addPoints(db, login, 25, 'pagamento', `Pagamento via PIX/Mercado Pago${id ? ' — fatura ' + id : ''}`);
    if (id) c.awardedInvoices.push(id);

    // streak = quantidade de faturas distintas já pontuadas como pagas no prazo (MK/MP); não implica meses consecutivos no calendário.
    c.streak = c.awardedInvoices.length;

    let novos = 1;
    function autoMission(missaoId, tipo = 'missao') {
      const m = MISSIONS[missaoId];
      if (!m || c.completedMissions.includes(missaoId)) return;
      addPoints(db, login, m.pts, tipo, `🎯 Missão: ${m.label}`);
      c.completedMissions.push(missaoId);
      novos++;
    }

    // Missões de pagamento
    if (c.streak >= 1)  autoMission('pagamento_1',  'pagamento');
    if (c.streak >= 5)  autoMission('pagamento_5',  'pagamento');
    if (c.streak >= 10) autoMission('pagamento_10', 'pagamento');

    // Missões de streak
    if (c.streak >= 3)  autoMission('streak_3',  'streak');
    if (c.streak >= 6)  autoMission('streak_6',  'streak');
    if (c.streak >= 9)  autoMission('streak_9',  'streak');
    if (c.streak >= 12) autoMission('streak_12', 'streak');
    if (c.streak >= 15) autoMission('maratonista', 'streak');
    if (c.streak >= 18) autoMission('streak_18', 'streak');
    if (c.streak >= 24) autoMission('streak_24', 'streak');

    // Missões de indicação
    const totalRef = (c.referrals || []).length;
    if (totalRef >= 1)  autoMission('indicar_1',  'indicacao');
    if (totalRef >= 2)  autoMission('indicar_2',  'indicacao');
    if (totalRef >= 3)  autoMission('indicar_3',  'indicacao');
    if (totalRef >= 5)  autoMission('indicar_5',  'indicacao');
    if (totalRef >= 7)  autoMission('indicar_7',  'indicacao');
    if (totalRef >= 10) autoMission('indicar_10', 'indicacao');
    if (totalRef >= 15) autoMission('indicar_15', 'indicacao');
    if (totalRef >= 20) autoMission('indicar_20', 'indicacao');

    // Missões de conquista
    const totalMissoes  = c.completedMissions.length;
    const totalResgates = (c.redeemed || []).length;
    if (totalMissoes >= 5)  autoMission('missoes_5',   'conquista');
    if (totalMissoes >= 10) autoMission('missoes_10',  'conquista');
    if (totalMissoes >= 15) autoMission('missoes_15',  'conquista');
    if (totalMissoes >= 20) autoMission('missoes_20',  'conquista');
    if (totalResgates >= 1) autoMission('resgatar_1', 'conquista');
    if (totalResgates >= 3) autoMission('colecionador', 'conquista');

    // Missões de nível — verificar DEPOIS de todos os bônus acima
    if (c.totalEarned >= 500)  autoMission('clube_prata',    'conquista');
    if (c.totalEarned >= 1500) autoMission('clube_ouro',     'conquista');
    if (c.totalEarned >= 3000) autoMission('clube_diamante', 'conquista');

    saveReferrals(db);
    console.log(`[Pontos MP] +25pts para ${login} | streak=${c.streak} | total=${c.points}`);
    return { novos, streak: c.streak, totalPts: c.points };
  } catch (e) {
    console.error('[Pontos MP] Erro:', e.message);
    return { novos: 0 };
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.cliente) {
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  }
  next();
}

// Login do cliente (somente por CPF)
app.post('/portal/login', async (req, res) => {
  const { cpf } = req.body;
  if (!cpf) {
    return res.status(400).json({ error: 'CPF é obrigatório.' });
  }
  const cpfLimpo = cpf.replace(/\D/g, '');
  try {
    const token = await getJWT();
    const clienteRes = await axios.get(`${MK_URL}/cliente/show/${cpfLimpo}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const cliente = clienteRes.data;

    if (!cliente || !cliente.login) {
      return res.status(404).json({ error: 'CPF não encontrado. Verifique e tente novamente.' });
    }
    req.session.cliente = {
      login: cliente.login,
      nome: cliente.nome,
      email: cliente.email,
      cpf_cnpj: cliente.cpf_cnpj,
      uuid: cliente.uuid_cliente || cliente.uuid,
      plano: cliente.plano || cliente.plano_nome || cliente.nome_plano || '',
    };
    req.session.token = token;

    // Registrar login para validação de missões
    const db = getClientData(cliente.login);
    const c  = db[cliente.login];
    const now = new Date();
    const isFirst = isPrimeiroLogin(cliente.login);
    c.loginHistory.push({
      ts:   now.toISOString(),
      hora: now.getHours(),
      data: now.toDateString(),
    });
    c.loginHistory = c.loginHistory.slice(-200); // manter últimos 200
    saveReferrals(db);

    // Notificações automáticas de boas-vindas no primeiro acesso ao portal
    if (isFirst) {
      setImmediate(async () => {
        try {
          await enviarBoasVindas(cliente.login, cliente.nome);
          setTimeout(() => enviarApresentacaoClube(cliente.login, cliente.nome), 8000);
        } catch {}
      });
    }

    res.json({ success: true, nome: cliente.nome, primeiroAcesso: isFirst });
  } catch (err) {
    const msg = err.response?.data?.mensagem || err.response?.data?.message || 'Erro ao autenticar.';
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

// Logout
app.post('/portal/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Dados do cliente logado
app.get('/portal/me', requireAuth, async (req, res) => {
  try {
    const token = await getJWT();
    const r = await axios.get(`${MK_URL}/cliente/show/${req.session.cliente.login}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const cliente = await enrichClienteComVelocidadePlano(r.data);
    res.json(cliente);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar dados do cliente.' });
  }
});

// Atualizar perfil: tenta editar direto; se negado, abre chamado automaticamente
app.put('/portal/perfil', requireAuth, async (req, res) => {
  const { email, telefone, celular, endereco, numero, bairro, cidade, estado, cep, complemento } = req.body;
  const cliente = req.session.cliente;

  try {
    const token = await getJWT();

    // Tenta editar direto pela API
    const editRes = await axios.put(`${MK_URL}/cliente/editar`, {
      uuid: cliente.uuid,
      email, telefone, celular, endereco, numero, bairro, cidade, estado, cep, complemento
    }, { headers: { Authorization: `Bearer ${token}` } });

    const body = editRes.data;
    if (body?.error) throw new Error(body.error?.text || 'Permissão negada');

    return res.json({ success: true, modo: 'direto' });
  } catch (errEdit) {
    // Fallback: abre chamado com as alterações solicitadas
    try {
      const token = await getJWT();
      const linhas = [
        `📋 Solicitação de atualização de cadastro`,
        ``,
        email       ? `E-mail: ${email}`               : null,
        telefone    ? `Telefone: ${telefone}`           : null,
        celular     ? `Celular: ${celular}`             : null,
        endereco    ? `Endereço: ${endereco}, ${numero}` : null,
        complemento ? `Complemento: ${complemento}`    : null,
        bairro      ? `Bairro: ${bairro}`              : null,
        cidade      ? `Cidade: ${cidade} - ${estado}`  : null,
        cep         ? `CEP: ${cep}`                    : null,
      ].filter(Boolean).join('\n');

      await axios.post(`${MK_URL}/chamado/inserir`, {
        login: cliente.login,
        nome: cliente.nome,
        email: cliente.email,
        assunto: 'Cadastro',
        prioridade: 'normal',
        mensagem: linhas
      }, { headers: { Authorization: `Bearer ${token}` } });

      return res.json({
        success: true,
        modo: 'chamado',
        aviso: 'Sua solicitação foi enviada como chamado. Nossa equipe irá atualizar seus dados em breve.'
      });
    } catch (errChamado) {
      return res.status(500).json({ error: 'Não foi possível salvar as alterações. Tente novamente.' });
    }
  }
});

// Faturas em aberto
app.get('/portal/faturas/abertas', requireAuth, async (req, res) => {
  try {
    const token = await getJWT();
    const cpf = req.session.cliente.cpf_cnpj || req.session.cliente.login;
    const r = await axios.get(`${MK_URL}/titulo/aberto/${cpf}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const login = req.session.cliente.login;
    const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
    const body = await enriquecerListaFaturasClubePosReconciliar(
      r.data,
      login,
      cpfLimpo.length >= 11 ? cpfLimpo : '',
      mkGet,
    );
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar faturas abertas.' });
  }
});

function readPortalAvisosDb() {
  return sqliteDb
    .prepare(
      `SELECT mensagem, tipo, link_text, link_href FROM portal_avisos ORDER BY ordem ASC, id ASC LIMIT 20`
    )
    .all()
    .map((r) => ({
      mensagem: r.mensagem,
      tipo: r.tipo,
      linkText: r.link_text || '',
      linkHref: r.link_href || '',
    }));
}

function replacePortalAvisosDb(rows) {
  const del = sqliteDb.prepare('DELETE FROM portal_avisos');
  const ins = sqliteDb.prepare(
    `INSERT INTO portal_avisos (ordem, mensagem, tipo, link_text, link_href) VALUES (?,?,?,?,?)`
  );
  const run = sqliteDb.transaction((list) => {
    del.run();
    list.forEach((row, i) => {
      ins.run(i, row.mensagem, row.tipo, row.linkText || null, row.linkHref || null);
    });
  });
  run(rows);
}

function sanitizePortalAvisoItem(raw) {
  const mensagem = String(raw?.mensagem || '').trim().slice(0, 2000);
  if (!mensagem) return null;
  const tipo = ['info', 'success', 'warning'].includes(raw?.tipo) ? raw.tipo : 'info';
  let linkText = String(raw?.linkText || '').trim().slice(0, 120);
  let linkHref = String(raw?.linkHref || '').trim().slice(0, 500);
  if (!/^https?:\/\//i.test(linkHref)) {
    linkHref = '';
    linkText = '';
  }
  return { mensagem, tipo, linkText, linkHref };
}

app.get('/portal/avisos', requireAuth, (req, res) => {
  try {
    const avisos = readPortalAvisosDb()
      .map(sanitizePortalAvisoItem)
      .filter(Boolean)
      .slice(0, 15);
    res.json({ avisos });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao ler avisos.' });
  }
});

// Web Push (VAPID) — subscrição do cliente
app.get('/portal/push/public-key', requireAuth, (req, res) => {
  try {
    res.json({ publicKey: pushLib.getPublicVapidKey() });
  } catch (e) {
    res.status(500).json({ error: 'Chave push indisponível.' });
  }
});

app.post('/portal/push/subscribe', requireAuth, (req, res) => {
  try {
    pushLib.savePushSubscription(req.session.cliente.login, req.body, req.get('user-agent'));
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Falha ao guardar subscrição.' });
  }
});

app.post('/portal/push/unsubscribe', requireAuth, (req, res) => {
  try {
    pushLib.removePushSubscription(req.session.cliente.login, req.body?.endpoint || null);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao remover subscrição.' });
  }
});

app.get('/portal/notificacoes/prefs', requireAuth, (req, res) => {
  try {
    const login = req.session.cliente.login;
    const prefs = getPrefsForLogin(login);
    const row = sqliteDb.prepare('SELECT COUNT(*) as c FROM push_subscriptions WHERE login = ?').get(login);
    res.json({ prefs, hasSubscription: (row?.c || 0) > 0 });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao ler preferências.' });
  }
});

app.put('/portal/notificacoes/prefs', requireAuth, (req, res) => {
  try {
    const login = req.session.cliente.login;
    const body = req.body || {};
    const patch = {};
    if (typeof body.faturaVencimento === 'boolean') patch.faturaVencimento = body.faturaVencimento;
    if (typeof body.avisosLemon === 'boolean') patch.avisosLemon = body.avisosLemon;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Envie faturaVencimento e/ou avisosLemon (boolean).' });
    }
    const db = getClientData(login);
    const c = db[login];
    c.pushNotifPrefs = mergePrefs({ ...mergePrefs(c.pushNotifPrefs), ...patch });
    saveReferrals(db);
    res.json({ prefs: c.pushNotifPrefs });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao gravar preferências.' });
  }
});

// Faturas vencidas
app.get('/portal/faturas/vencidas', requireAuth, async (req, res) => {
  try {
    const token = await getJWT();
    const cpf = req.session.cliente.cpf_cnpj || req.session.cliente.login;
    const r = await axios.get(`${MK_URL}/titulo/vencido/${cpf}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const login = req.session.cliente.login;
    const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
    const body = await enriquecerListaFaturasClubePosReconciliar(
      r.data,
      login,
      cpfLimpo.length >= 11 ? cpfLimpo : '',
      mkGet,
    );
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar faturas vencidas.' });
  }
});

// Histórico de faturas pagas
app.get('/portal/faturas/pagas', requireAuth, async (req, res) => {
  try {
    const token = await getJWT();
    const login = req.session.cliente.login;
    const r = await axios.get(`${MK_URL}/titulo/pago/${login}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
    const body = await enriquecerListaFaturasClubePosReconciliar(
      r.data,
      login,
      cpfLimpo.length >= 11 ? cpfLimpo : '',
      mkGet,
    );
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar histórico de faturas.' });
  }
});

// Detalhe de uma fatura
app.get('/portal/faturas/:uuid', requireAuth, async (req, res) => {
  try {
    const token = await getJWT();
    const urlTitulo = String(req.params.uuid || '').trim();
    const r = await axios.get(`${MK_URL}/titulo/show/${encodeURIComponent(urlTitulo)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const login = req.session.cliente.login;
    const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
    const body = await enriquecerTituloComDescontoClubePosReconciliar(
      garantirUuidTituloPayload(r.data, urlTitulo),
      login,
      cpfLimpo.length >= 11 ? cpfLimpo : '',
      mkGet,
    );
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar fatura.' });
  }
});

// Listar chamados do cliente (filtra por login no backend)
app.get('/portal/chamados', requireAuth, async (req, res) => {
  try {
    const token = await getJWT();
    const login = req.session.cliente.login;
    const r = await axios.get(`${MK_URL}/chamado/listar/pagina=1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const todos = r.data?.chamados || [];
    const meusChamados = todos.filter(c => c.login === login);
    res.json({ chamados: meusChamados, total: meusChamados.length });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar chamados.' });
  }
});

// Abrir chamado
app.post('/portal/chamados', requireAuth, async (req, res) => {
  try {
    const token = await getJWT();
    const { assunto, mensagem, prioridade } = req.body;
    const cliente = req.session.cliente;
    const r = await axios.post(`${MK_URL}/chamado/inserir`, {
      login: cliente.login,
      nome: cliente.nome,
      email: cliente.email,
      assunto: assunto || 'Outros',
      prioridade: prioridade || 'normal',
      mensagem
    }, { headers: { Authorization: `Bearer ${token}` } });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao abrir chamado.' });
  }
});

// Detalhe de um chamado
app.get('/portal/chamados/:id', requireAuth, async (req, res) => {
  try {
    const token = await getJWT();
    const r = await axios.get(`${MK_URL}/chamado/show/${req.params.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar chamado.' });
  }
});

// Cadastro de novo cliente via API
app.post('/portal/cadastro', async (req, res) => {
  const { nome, cpf, data_nasc, email, celular,
          cep, endereco, numero, complemento, bairro, cidade, estado,
          login, senha, plano, ref, regiao_condominio, endereco_indicado_rp } = req.body;

  if (!nome || !cpf || !login || !senha) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  }
  try {
    const token = await getJWT();
    const r = await axios.post(`${MK_URL}/instalacao/inserir`, {
      nome, cpf, data_nasc, email, celular,
      cep, endereco, numero, complemento, bairro, cidade, estado,
      login, senha
    }, { headers: { Authorization: `Bearer ${token}` } });

    const body = r.data;
    if (body?.status === 'erro' || body?.error) {
      const msg = body?.mensagem || body?.error?.text || 'Erro ao cadastrar.';
      return res.status(400).json({ error: msg });
    }

    // Chamado de ativação com plano
    const msgPlano = plano
      ? `Novo cliente cadastrado via portal.\nPlano solicitado: ${plano}\nAguardando ativação.`
      : `Novo cliente cadastrado via portal.\nAguardando ativação.`;

    const regiao = String(regiao_condominio || '').trim();
    const tipoMoradia = regiao === 'Real Parque' ? 'Condomínio' : 'Casas';
    const msgRegiao = regiao ? `\n\n${tipoMoradia} / região: ${regiao}` : '';

    const endRp = String(endereco_indicado_rp || '').trim();
    const msgEndRp = endRp ? `\n\nEndereço indicado (Real Parque): ${endRp}` : '';

    const msgRef = ref
      ? `\n\n🎁 Indicado por: ${ref}`
      : '';

    try {
      await axios.post(`${MK_URL}/chamado/inserir`, {
        login,
        nome,
        email: email || '',
        assunto: 'Cadastro',
        prioridade: 'normal',
        mensagem: msgPlano + msgRegiao + msgEndRp + msgRef
      }, { headers: { Authorization: `Bearer ${token}` } });
    } catch (_) {}

    // Premiar quem indicou
    if (ref && ref !== login) {
      awardPoints(ref, login, nome);
    }

    // Boas-vindas via WhatsApp (em background, sem bloquear resposta)
    setImmediate(() => notificarCadastro(login, nome, celular));

    res.json({ success: true });
  } catch (err) {
    const msg = err.response?.data?.mensagem || err.response?.data?.message || 'Erro ao cadastrar. Verifique os dados.';
    res.status(err.response?.status || 500).json({ error: msg });
  }
});

// ===== ROTAS DE GAMIFICAÇÃO =====

// Stats completos do clube
app.get('/portal/clube/stats', requireAuth, async (req, res) => {
  const login = req.session.cliente.login;
  const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
  try {
    if (cpfLimpo.length >= 11) await reconciliarPendenteDescontoClube(login, cpfLimpo, mkGet);
  } catch (_) {}
  const db = getClientData(login);
  const c = db[login];
  const level = getLevel(c.totalEarned || 0);
  const nextLevel = LEVELS[LEVELS.indexOf(level) + 1] || null;
  const host = `${req.protocol}://${req.get('host')}`;
  // Monta status de missões
  const missionsStatus = Object.entries(MISSIONS).map(([id, m]) => ({
    id,
    ...m,
    auto: !!m.auto,
    completa: (c.completedMissions || []).includes(id),
  }));

  const cfd = c.clubFaturaDesconto && typeof c.clubFaturaDesconto === 'object' ? c.clubFaturaDesconto : { pendente: null };
  res.json({
    pontos:            c.points,
    totalEarned:       c.totalEarned || 0,
    nivel:             level,
    proximoNivel:      nextLevel,
    ptsFaltamProx:     nextLevel ? (nextLevel.min - (c.totalEarned || 0)) : 0,
    totalIndicados:    (c.referrals || []).length,
    indicacoes:        (c.referrals || []).slice(0, 20),
    resgates:          (c.redeemed  || []).slice(0, 20),
    log:               (c.log       || []).slice(0, 30),
    link:              `${host}/?ref=${encodeURIComponent(login)}`,
    streak:            c.streak || 0,
    missoes:           missionsStatus,
    completedMissions: c.completedMissions || [],
    faturaDescontoPendente: cfd.pendente
      ? {
          percent: cfd.pendente.percent,
          label: cfd.pendente.label,
          titulo_uuid_alvo: cfd.pendente.titulo_uuid_alvo,
          titulo_alvo_datavenc: cfd.pendente.titulo_alvo_datavenc || null,
          titulo_alvo_referencia: cfd.pendente.titulo_alvo_referencia || null,
        }
      : null,
  });
});

// Sincronizar pontos de faturas pagas em dia
app.post('/portal/clube/sincronizar', requireAuth, async (req, res) => {
  const login = req.session.cliente.login;
  const cpf   = req.session.cliente.cpf_cnpj || login;
  try {
    const token = await getJWT();
    const r = await axios.get(`${MK_URL}/titulo/pago/${cpf}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const faturas = Array.isArray(r.data) ? r.data : (r.data?.titulos || []);
    const db = getClientData(login);
    const c  = db[login];
    let novos = 0;

    for (const f of faturas) {
      const ids = [f.id, f.numero, f.referencia, f.uuid].map(v => String(v || '').trim()).filter(Boolean);
      if (ids.length === 0) continue;
      if (ids.some(id => c.awardedInvoices.includes(id))) continue;

      const venc = new Date(f.data_vencimento || f.vencimento || '');
      const pago = new Date(f.data_pagamento  || f.pagamento  || '');
      const emDia = !isNaN(venc) && !isNaN(pago) && pago <= venc;

      if (emDia) {
        const mainId = ids[0];
        addPoints(db, login, 25, 'pagamento', `Fatura ${mainId} paga em dia`);
        ids.forEach(id => { if (!c.awardedInvoices.includes(id)) c.awardedInvoices.push(id); });
        novos++;
      }
    }

    // streak = faturas distintas pontuadas como pagas no prazo (ver comentário em concederPontosMP).
    c.streak = c.awardedInvoices.length;

    // Helper: conceder missão automática uma única vez
    function autoMission(id, tipo = 'missao') {
      const m = MISSIONS[id];
      if (!m || c.completedMissions.includes(id)) return;
      addPoints(db, login, m.pts, tipo, `🎯 Missão: ${m.label}`);
      c.completedMissions.push(id);
      novos++;
    }

    // Missões de pagamento / streak
    if (c.streak >= 1)  autoMission('pagamento_1',  'pagamento');
    if (c.streak >= 5)  autoMission('pagamento_5',  'pagamento');
    if (c.streak >= 10) autoMission('pagamento_10', 'pagamento');
    if (c.streak >= 3)  autoMission('streak_3',     'streak');
    if (c.streak >= 6)  autoMission('streak_6',     'streak');
    if (c.streak >= 9)  autoMission('streak_9',     'streak');
    if (c.streak >= 12) autoMission('streak_12',    'streak');
    if (c.streak >= 15) autoMission('maratonista',  'streak');
    if (c.streak >= 18) autoMission('streak_18',    'streak');
    if (c.streak >= 24) autoMission('streak_24',    'streak');

    // Missões de indicação
    const totalRef = (c.referrals || []).length;
    if (totalRef >= 1)  autoMission('indicar_1',  'indicacao');
    if (totalRef >= 2)  autoMission('indicar_2',  'indicacao');
    if (totalRef >= 3)  autoMission('indicar_3',  'indicacao');
    if (totalRef >= 5)  autoMission('indicar_5',  'indicacao');
    if (totalRef >= 7)  autoMission('indicar_7',  'indicacao');
    if (totalRef >= 10) autoMission('indicar_10', 'indicacao');
    if (totalRef >= 15) autoMission('indicar_15', 'indicacao');
    if (totalRef >= 20) autoMission('indicar_20', 'indicacao');

    // Missões de conquista (missões completadas e resgates)
    const totalMissoes  = (c.completedMissions || []).length;
    const totalResgates = (c.redeemed        || []).length;
    if (totalMissoes  >= 5)  autoMission('missoes_5',   'conquista');
    if (totalMissoes  >= 10) autoMission('missoes_10',  'conquista');
    if (totalMissoes  >= 15) autoMission('missoes_15',  'conquista');
    if (totalMissoes  >= 20) autoMission('missoes_20',  'conquista');
    if (totalResgates >= 1)  autoMission('resgatar_1',  'conquista');
    if (totalResgates >= 3)  autoMission('colecionador', 'conquista');

    // Missões de nível — verificar DEPOIS de todos os bônus acima serem somados
    if (c.totalEarned >= 500)  autoMission('clube_prata',    'conquista');
    if (c.totalEarned >= 1500) autoMission('clube_ouro',     'conquista');
    if (c.totalEarned >= 3000) autoMission('clube_diamante', 'conquista');

    if (novos > 0) saveReferrals(db);
    const updated = db[login];
    res.json({ novos, pontos: updated.points, totalEarned: updated.totalEarned, streak: updated.streak });
  } catch (err) {
    res.json({ novos: 0, pontos: 0, erro: true });
  }
});

// Completar missão manualmente (speedtest, instalar_app, perfil_completo)
// ── Registrar resultado real de speedtest ──────────────────────────────────
app.post('/portal/speedtest/registrar', requireAuth, (req, res) => {
  const { dl, ul, ping, planSpeed } = req.body;
  const login = req.session.cliente.login;
  const now   = new Date();
  const db    = getClientData(login);
  const c     = db[login];

  const resultado = {
    ts:        now.toISOString(),
    hora:      now.getHours(),
    data:      now.toDateString(),
    dl:        Number(dl)  || 0,
    ul:        Number(ul)  || 0,
    ping:      Number(ping)|| 0,
    planSpeed: Number(planSpeed) || 0,
  };
  c.speedtests.push(resultado);
  c.speedtests = c.speedtests.slice(-100); // manter últimos 100

  // Verificar missões de speedtest com base nos dados reais
  const total  = c.speedtests.length;
  const dias   = [...new Set(c.speedtests.map(t => t.data))];
  const temManha = c.speedtests.some(t => t.hora >= 6 && t.hora < 12);
  const temNoite = c.speedtests.some(t => t.hora >= 20 && t.hora < 23);

  function autoST(id) {
    const m = MISSIONS[id];
    if (!m || (c.completedMissions || []).includes(id)) return;
    addPoints(db, login, m.pts, 'missao', `🎯 Missão: ${m.label}`);
    c.completedMissions.push(id);
  }

  if (total >= 1)  autoST('speedtest');
  if (total >= 3)  autoST('speedtest_3x');
  if (total >= 5)  autoST('speedtest_5x');
  if (total >= 10) autoST('speedtest_10x');
  if (temManha)    autoST('speedtest_manha');
  if (temNoite)    autoST('speedtest_noite');
  if (dias.length >= 3) autoST('speedtest_semana');

  // Missões de score (validar contra plano)
  if (resultado.planSpeed > 0) {
    const ratio = resultado.dl / resultado.planSpeed;
    if (ratio >= 0.9) autoST('speedtest_excelente');
    if (ratio >= 1.0) autoST('speedtest_100');
  }

  saveReferrals(db);
  const updated = db[login];
  res.json({
    success: true,
    pontos: updated.points,
    missoesConcluidas: c.completedMissions,
    totalTestes: total,
  });
});

// ── Registrar visita a seção (validação real de missões de navegação) ────────
app.post('/portal/visita', requireAuth, (req, res) => {
  const { secao } = req.body;
  const login = req.session.cliente.login;

  // Mapa: seção → id da missão correspondente
  const secaoMissao = {
    faturas:     'ver_fatura',
    conexao:     'ver_conexao',
    velocidade:  'ver_velocidade_sec',
    perfil:      'ver_perfil_sec',
    suporte:     'ver_suporte_sec',
    indicacoes:  'ver_clube',
    desafios:    'ver_desafios',
    historico:   'ver_historico',
    dashboard:   null, // sem missão específica
  };

  const missaoId = secaoMissao[secao];
  if (!missaoId) return res.json({ ok: true }); // seção sem missão

  const db = getClientData(login);
  const c  = db[login];

  // Registrar visita
  if (!c.visitedSections.includes(secao)) {
    c.visitedSections.push(secao);
  }

  // Conceder missão se ainda não completada
  let novosPts = 0;
  let label = '';
  if (!(c.completedMissions || []).includes(missaoId)) {
    const m = MISSIONS[missaoId];
    if (m) {
      addPoints(db, login, m.pts, 'missao', `🎯 Missão: ${m.label}`);
      c.completedMissions.push(missaoId);
      novosPts = m.pts;
      label = m.label;
    }
  }

  // Verificar missão "explorador" (todas as seções visitadas)
  const EXPLORER_SECS = ['faturas','suporte','conexao','velocidade','indicacoes','perfil'];
  if (EXPLORER_SECS.every(s => c.visitedSections.includes(s))) {
    const mEx = MISSIONS['explorador'];
    if (mEx && !(c.completedMissions || []).includes('explorador')) {
      addPoints(db, login, mEx.pts, 'missao', `🎯 Missão: ${mEx.label}`);
      c.completedMissions.push('explorador');
    }
  }

  saveReferrals(db);
  const updated = db[login];
  res.json({
    ok: true,
    missao: missaoId,
    novosPts,
    label,
    pontos: updated.points,
    jaCompleta: novosPts === 0,
  });
});

// ── Completar missão com validação real server-side ────────────────────────
app.post('/portal/clube/missao', requireAuth, async (req, res) => {
  const { tipo } = req.body;
  const login = req.session.cliente.login;

  const m = MISSIONS[tipo];
  // Missão auto (validada pelo sincronizar) → ignora silenciosamente
  if (!m || m.auto) return res.json({ jaCompleta: true, pontos: 0 });

  const db = getClientData(login);
  const c  = db[login];

  if ((c.completedMissions || []).includes(tipo)) {
    return res.json({ jaCompleta: true, pontos: c.points });
  }

  // ── Validação por tipo de missão ──────────────────────────────────────────
  const now   = new Date();
  const hora  = now.getHours();

  // Speedtest: validado agora via /portal/speedtest/registrar
  // As missões de speedtest só chegam aqui se foram explicitamente solicitadas — aprovar direto
  // (o /speedtest/registrar é a fonte de verdade)
  const SPEEDTEST_MISSIONS = ['speedtest','speedtest_3x','speedtest_5x','speedtest_10x',
                               'speedtest_manha','speedtest_noite','speedtest_100','speedtest_excelente','speedtest_semana'];
  if (SPEEDTEST_MISSIONS.includes(tipo)) {
    // Só concede se há pelo menos um teste registrado
    if (c.speedtests.length === 0) {
      return res.status(400).json({ error: 'Complete um teste de velocidade real primeiro.' });
    }
    // Validação específica
    const total = c.speedtests.length;
    const dias  = [...new Set(c.speedtests.map(t => t.data))];
    if (tipo === 'speedtest_3x'   && total < 3)  return res.status(400).json({ error: 'Faça pelo menos 3 testes.' });
    if (tipo === 'speedtest_5x'   && total < 5)  return res.status(400).json({ error: 'Faça pelo menos 5 testes.' });
    if (tipo === 'speedtest_10x'  && total < 10) return res.status(400).json({ error: 'Faça pelo menos 10 testes.' });
    if (tipo === 'speedtest_manha'  && !c.speedtests.some(t => t.hora >= 6  && t.hora < 12)) return res.status(400).json({ error: 'Nenhum teste matinal encontrado.' });
    if (tipo === 'speedtest_noite'  && !c.speedtests.some(t => t.hora >= 20 && t.hora < 23)) return res.status(400).json({ error: 'Nenhum teste noturno encontrado.' });
    if (tipo === 'speedtest_semana' && dias.length < 3) return res.status(400).json({ error: 'Teste em pelo menos 3 dias diferentes.' });
    if (tipo === 'speedtest_excelente' && !c.speedtests.some(t => t.planSpeed > 0 && t.dl / t.planSpeed >= 0.9)) return res.status(400).json({ error: 'Nenhum teste com ≥90% do plano.' });
    if (tipo === 'speedtest_100'   && !c.speedtests.some(t => t.planSpeed > 0 && t.dl / t.planSpeed >= 1.0)) return res.status(400).json({ error: 'Nenhum teste com 100% do plano.' });
  }

  // Login 3x — validado pelo loginHistory
  if (tipo === 'login_3x') {
    if ((c.loginHistory || []).length < 3) {
      return res.status(400).json({ error: 'Faça login pelo menos 3 vezes.' });
    }
  }

  // Uso em 3 dias diferentes — validado pelo loginHistory
  if (tipo === 'uso_semanal') {
    const diasLogin = [...new Set((c.loginHistory || []).map(l => l.data))];
    if (diasLogin.length < 3) {
      return res.status(400).json({ error: 'Acesse o portal em pelo menos 3 dias diferentes.' });
    }
  }

  // Acesso noturno — validado pelo loginHistory (algum login após 22h)
  if (tipo === 'acesso_noturno') {
    const temNoturno = (c.loginHistory || []).some(l => l.hora >= 22);
    if (!temNoturno) {
      return res.status(400).json({ error: 'Nenhum acesso noturno (após 22h) registrado.' });
    }
  }

  // Navegação — validadas via /portal/visita (apenas reprocessa aqui se necessário)
  const NAV_MISSIONS = ['ver_fatura','ver_conexao','ver_velocidade_sec','ver_perfil_sec',
                        'ver_suporte_sec','ver_clube','ver_desafios','ver_historico','explorador'];
  if (NAV_MISSIONS.includes(tipo)) {
    const secaoMap = {
      ver_fatura: 'faturas', ver_conexao: 'conexao', ver_velocidade_sec: 'velocidade',
      ver_perfil_sec: 'perfil', ver_suporte_sec: 'suporte', ver_clube: 'indicacoes',
      ver_desafios: 'desafios', ver_historico: 'historico',
    };
    const secNecessaria = secaoMap[tipo];
    if (secNecessaria && !(c.visitedSections || []).includes(secNecessaria)) {
      return res.status(400).json({ error: 'Você precisa visitar a seção primeiro.' });
    }
    if (tipo === 'explorador') {
      const EXPLORER = ['faturas','suporte','conexao','velocidade','indicacoes','perfil'];
      if (!EXPLORER.every(s => (c.visitedSections || []).includes(s))) {
        return res.status(400).json({ error: 'Visite todas as seções do portal.' });
      }
    }
  }

  // Primeiro login — valida que tem pelo menos 1 login registrado
  if (tipo === 'primeiro_login') {
    if ((c.loginHistory || []).length < 1) {
      return res.status(400).json({ error: 'Nenhum login registrado.' });
    }
  }

  // Abrir chamado — valida no MK-Auth que existe pelo menos 1 chamado
  if (tipo === 'abrir_chamado') {
    try {
      const token = await getJWT();
      const r = await axios.get(`${MK_URL}/chamado/listar/pagina=1/cliente=${login}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const chamados = Array.isArray(r.data) ? r.data : (r.data?.registros || []);
      if (chamados.length === 0) {
        return res.status(400).json({ error: 'Abra um chamado de suporte primeiro.' });
      }
    } catch {
      return res.status(500).json({ error: 'Não foi possível verificar seus chamados.' });
    }
  }

  // Mudar dados — valida que os dados de contato existem no MK
  if (tipo === 'mudar_dados') {
    try {
      const token = await getJWT();
      const r = await axios.get(`${MK_URL}/cliente/show/${login}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = r.data;
      if (!d.email && !d.fone && !d.celular) {
        return res.status(400).json({ error: 'Atualize seus dados de contato no perfil primeiro.' });
      }
    } catch {
      return res.status(500).json({ error: 'Não foi possível verificar seus dados.' });
    }
  }

  // Ativar notificações — valida que tem push subscription registrada
  if (tipo === 'ativar_notif') {
    const sub = sqliteDb.prepare('SELECT 1 FROM push_subscriptions WHERE login = ?').get(login);
    if (!sub) {
      return res.status(400).json({ error: 'Ative as notificações push primeiro.' });
    }
  }

  // Perfil completo — valida dados reais via API MK-Auth
  if (tipo === 'perfil_completo') {
    try {
      const token = await getJWT();
      const r = await axios.get(`${MK_URL}/cliente/show/${login}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = r.data;
      const preenchido = d.email && (d.fone || d.celular) && d.endereco && d.cidade;
      if (!preenchido) {
        return res.status(400).json({ error: 'Preencha e-mail, telefone, endereço e cidade no perfil.' });
      }
    } catch {
      return res.status(500).json({ error: 'Não foi possível verificar seu perfil.' });
    }
  }

  // Missão aprovada — conceder pontos
  addPoints(db, login, m.pts, 'missao', `🎯 Missão: ${m.label}`);
  c.completedMissions.push(tipo);
  saveReferrals(db);

  res.json({ success: true, pts: m.pts, pontos: db[login].points, label: m.label });
});

// Resgatar pontos (desconto, upgrade ou mês)
app.post('/portal/clube/resgatar', requireAuth, async (req, res) => {
  const { tipo } = req.body;
  const login = req.session.cliente.login;
  const nome  = req.session.cliente.nome;
  const email = req.session.cliente.email || '';

  const RESGATES = {
    // ── Básico ──────────────────────────────────────────────────────────
    desconto:           { pontos: 100,  label: 'Desconto 10% na fatura',         assunto: 'Financeiro' },
    desconto_20:        { pontos: 180,  label: 'Desconto 20% na fatura',         assunto: 'Financeiro' },
    desconto_30:        { pontos: 260,  label: 'Desconto 30% na fatura',         assunto: 'Financeiro' },
    desconto_40:        { pontos: 340,  label: 'Desconto 40% na fatura',         assunto: 'Financeiro' },
    desconto_50:        { pontos: 420,  label: 'Desconto 50% na fatura',         assunto: 'Financeiro' },
    desconto_80:        { pontos: 650,  label: 'Desconto 80% na fatura',         assunto: 'Financeiro' },
    // ── Médio ───────────────────────────────────────────────────────────
    velocidade_dobro_7d:{ pontos: 220,  label: 'Dobro da velocidade por 7 dias',       assunto: 'Comercial'  },
    upgrade:            { pontos: 300,  label: 'Upgrade de velocidade 30 dias',         assunto: 'Comercial'  },
    plano_up_7d:        { pontos: 370,  label: 'Plano superior por 7 dias',             assunto: 'Comercial'  },
    indicacao_dobro:    { pontos: 350,  label: 'Indicações em dobro (2 próx.)',         assunto: 'Comercial'  },
    plano_up_15d:       { pontos: 470,  label: 'Plano superior por 15 dias',            assunto: 'Comercial'  },
    ponto_extra_15d:    { pontos: 500,  label: 'Ponto de acesso extra por 15 dias',     assunto: 'Comercial'  },
    roteador_wifi6:     { pontos: 560,  label: 'Upgrade para roteador Wi-Fi 6 (30d)',   assunto: 'Comercial'  },
    ponto_extra_30d:    { pontos: 620,  label: 'Ponto de acesso extra por 30 dias',     assunto: 'Comercial'  },
    // ── Premium ─────────────────────────────────────────────────────────
    mes_gratis:         { pontos: 800,  label: '1 mês grátis',                  assunto: 'Financeiro' },
    upgrade_90d:        { pontos: 850,  label: 'Upgrade de velocidade 90 dias', assunto: 'Comercial'  },
    plano_up_30d:       { pontos: 950,  label: 'Plano superior por 30 dias',    assunto: 'Comercial'  },
    desconto_100:       { pontos: 1050, label: 'Desconto 100% na fatura',       assunto: 'Financeiro' },
    plano_up_60d:       { pontos: 1300, label: 'Plano superior por 60 dias',    assunto: 'Comercial'  },
    dois_meses:         { pontos: 1500, label: '2 meses grátis',                assunto: 'Financeiro' },
    tres_meses:         { pontos: 1800, label: '3 meses grátis',                assunto: 'Financeiro' },
    cliente_vip:        { pontos: 2000, label: 'Status Cliente VIP 12 meses',   assunto: 'Comercial'  },
  };

  const opcao = RESGATES[tipo];
  if (!opcao) return res.status(400).json({ error: 'Tipo de resgate inválido.' });

  const db = getClientData(login);
  const c  = db[login];
  if ((c.points || 0) < opcao.pontos) {
    return res.status(400).json({ error: `Você precisa de ${opcao.pontos} pontos para este resgate.` });
  }

  const isDescontoFatura = tipoResgateEhDescontoNaFatura(tipo);
  /** @type {{ uuid: string, datavenc: string|null, referencia: string|null }|null} */
  let tituloAlvoMeta = null;
  if (isDescontoFatura) {
    const cfd0 = normalizarClubFaturaDesconto(c.clubFaturaDesconto);
    if (cfd0.pendente) {
      return res.status(400).json({
        code: 'LEMON_CLUBE_DESCONTO_FATURA_PENDENTE',
        error:
          'Você já tem um desconto na fatura pendente. Pague a fatura indicada no portal (Mercado Pago) ou aguarde a baixa antes de resgatar outro desconto.',
      });
    }
    const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
    if (cpfLimpo.length < 11) {
      return res.status(400).json({
        error: 'Atualize o CPF no cadastro para vincular o desconto a uma fatura em aberto.',
      });
    }
    try {
      tituloAlvoMeta = await tituloAlvoDescontoClubeCompleto(cpfLimpo, mkGet);
    } catch (_) {
      return res.status(500).json({ error: 'Não foi possível consultar suas faturas no momento.' });
    }
    if (!tituloAlvoMeta || !tituloAlvoMeta.uuid) {
      return res.status(400).json({
        error: 'Não há fatura em aberto ou vencida para vincular este desconto. Aguarde a geração da cobrança.',
      });
    }
  }

  const msgs = {
    desconto:           `🎁 Resgate: Desconto 10% na fatura\n\nPontos: ${opcao.pontos}\nAplicar desconto de 10% sobre o valor da próxima fatura (valor da cobrança).`,
    desconto_20:        `🎁 Resgate: Desconto 20% na fatura\n\nPontos: ${opcao.pontos}\nAplicar desconto de 20% sobre o valor da próxima fatura (valor da cobrança).`,
    desconto_30:        `🎁 Resgate: Desconto 30% na fatura\n\nPontos: ${opcao.pontos}\nAplicar desconto de 30% sobre o valor da próxima fatura (valor da cobrança).`,
    desconto_40:        `🎁 Resgate: Desconto 40% na fatura\n\nPontos: ${opcao.pontos}\nAplicar desconto de 40% sobre o valor da próxima fatura (valor da cobrança).`,
    desconto_50:        `🎁 Resgate: Desconto 50% na fatura\n\nPontos: ${opcao.pontos}\nAplicar desconto de 50% sobre o valor da próxima fatura (valor da cobrança).`,
    desconto_80:        `🎁 Resgate: Desconto 80% na fatura\n\nPontos: ${opcao.pontos}\nAplicar desconto de 80% sobre o valor da próxima fatura (valor da cobrança).`,
    velocidade_dobro_7d:`⚡ Resgate: Dobro da Velocidade 7 dias\n\nPontos: ${opcao.pontos}\nDobrar a velocidade do plano atual por 7 dias — Lemon Club.`,
    upgrade:            `⚡ Resgate: Upgrade de Velocidade 30 dias\n\nPontos: ${opcao.pontos}\nUpgrade temporário de velocidade por 30 dias — Lemon Club.`,
    plano_up_7d:        `🚀 Resgate: Plano Superior 7 dias\n\nPontos: ${opcao.pontos}\nAtivar plano imediatamente superior por 7 dias — Lemon Club.`,
    indicacao_dobro:    `🤝 Resgate: Indicações em Dobro\n\nPontos: ${opcao.pontos}\nAtivar bônus de indicação dobrado (200 pts por indicação) para as próximas 2 indicações do cliente.`,
    plano_up_15d:       `🚀 Resgate: Plano Superior 15 dias\n\nPontos: ${opcao.pontos}\nAtivar plano imediatamente superior por 15 dias — Lemon Club.`,
    ponto_extra_15d:    `📶 Resgate: Ponto de Acesso Extra 15 dias\n\nPontos: ${opcao.pontos}\nInstalar ponto de acesso adicional na residência por 15 dias — Lemon Club.`,
    roteador_wifi6:     `📡 Resgate: Roteador Wi-Fi 6 (30 dias)\n\nPontos: ${opcao.pontos}\nUpgrade para roteador Wi-Fi 6 de alta performance por 30 dias — Lemon Club.`,
    ponto_extra_30d:    `📶 Resgate: Ponto de Acesso Extra 30 dias\n\nPontos: ${opcao.pontos}\nInstalar ponto de acesso adicional na residência por 30 dias — Lemon Club.`,
    mes_gratis:         `🌟 Resgate: 1 Mês Grátis\n\nPontos: ${opcao.pontos}\nDesconto de 1 mensalidade completa — Lemon Club.`,
    upgrade_90d:        `⚡ Resgate: Upgrade de Velocidade 90 dias\n\nPontos: ${opcao.pontos}\nUpgrade temporário de velocidade por 90 dias — Lemon Club Premium.`,
    plano_up_30d:       `🚀 Resgate: Plano Superior 30 dias\n\nPontos: ${opcao.pontos}\nAtivar plano imediatamente superior por 30 dias — Lemon Club Premium.`,
    desconto_100:       `🎁 Resgate: Desconto 100% na fatura\n\nPontos: ${opcao.pontos}\nDesconto integral (100%) sobre o valor da próxima fatura — Lemon Club Premium.`,
    plano_up_60d:       `🚀 Resgate: Plano Superior 60 dias\n\nPontos: ${opcao.pontos}\nAtivar plano imediatamente superior por 60 dias — Lemon Club Premium.`,
    dois_meses:         `🏆 Resgate: 2 Meses Grátis\n\nPontos: ${opcao.pontos}\nDesconto de 2 mensalidades completas — Lemon Club Elite.`,
    tres_meses:         `👑 Resgate: 3 Meses Grátis\n\nPontos: ${opcao.pontos}\nDesconto de 3 mensalidades completas — Lemon Club Elite.`,
    cliente_vip:        `💎 Resgate: Status Cliente VIP 12 meses\n\nPontos: ${opcao.pontos}\nAtivação de status VIP com prioridade máxima por 12 meses — Lemon Club Elite.`,
  };

  try {
    const token = await getJWT();
    await axios.post(`${MK_URL}/chamado/inserir`, {
      login, nome, email,
      assunto: opcao.assunto,
      prioridade: 'normal',
      mensagem: msgs[tipo]
    }, { headers: { Authorization: `Bearer ${token}` } });

    c.points -= opcao.pontos;
    c.redeemed = c.redeemed || [];
    const redeemEntry = { data: new Date().toISOString(), tipo, label: opcao.label, pontos: opcao.pontos };
    if (tipo === 'indicacao_dobro') { redeemEntry.usosRestantes = 2; redeemEntry.usado = false; }
    c.redeemed.unshift(redeemEntry);
    c.log = c.log || [];
    c.log.unshift({ data: new Date().toISOString(), pontos: -opcao.pontos, tipo: 'resgate', descricao: opcao.label });
    c.log = c.log.slice(0, 100);

    if (isDescontoFatura) {
      if (!tituloAlvoMeta || !tituloAlvoMeta.uuid) {
        c.points += opcao.pontos;
        c.redeemed.shift();
        c.log.shift();
        saveReferrals(db);
        return res.status(400).json({
          error: 'Não há fatura em aberto para vincular o desconto. Seus pontos não foram debitados.',
        });
      }
      const pct = faturaDescontoTipoPercent(tipo);
      c.clubFaturaDesconto = normalizarClubFaturaDesconto(c.clubFaturaDesconto);
      c.clubFaturaDesconto = {
        pendente: {
          percent: pct,
          tipo,
          label: opcao.label,
          desde: new Date().toISOString(),
          titulo_uuid_alvo: tituloAlvoMeta.uuid,
          titulo_alvo_datavenc: tituloAlvoMeta.datavenc || undefined,
          titulo_alvo_referencia: tituloAlvoMeta.referencia || undefined,
        },
        aplicados: c.clubFaturaDesconto.aplicados || [],
      };
    }

    saveReferrals(db);

    // Notifica cliente via WhatsApp
    setImmediate(() => notificarResgate(login, nome, opcao.label, opcao.pontos, c.points));

    res.json({
      success: true,
      pontosRestantes: c.points,
      label: opcao.label,
      faturaDesconto: isDescontoFatura
        ? {
            percent: faturaDescontoTipoPercent(tipo),
            titulo_uuid_alvo: c.clubFaturaDesconto?.pendente?.titulo_uuid_alvo || null,
            titulo_alvo_datavenc: c.clubFaturaDesconto?.pendente?.titulo_alvo_datavenc || null,
            titulo_alvo_referencia: c.clubFaturaDesconto?.pendente?.titulo_alvo_referencia || null,
          }
        : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao processar resgate.' });
  }
});

// Formulário "Quero ser cliente" — abre chamado interno
app.post('/portal/interesse', async (req, res) => {
  const { nome, telefone, endereco, plano } = req.body;
  try {
    const token = await getJWT();
    const mensagem = [
      `🌟 Solicitação de novo cliente`,
      ``,
      `Nome: ${nome}`,
      `Telefone: ${telefone}`,
      `Endereço: ${endereco}`,
      `Plano de interesse: ${plano}`,
    ].join('\n');

    await axios.post(`${MK_URL}/chamado/inserir`, {
      login: 'lemontechnology',
      nome,
      assunto: 'Outros',
      prioridade: 'normal',
      mensagem
    }, { headers: { Authorization: `Bearer ${token}` } });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar interesse.' });
  }
});

// Sessão ativa?
app.get('/portal/session', (req, res) => {
  if (req.session.cliente) {
    res.json({ logado: true, nome: req.session.cliente.nome });
  } else {
    res.json({ logado: false });
  }
});

// ===== CONEXÃO / MIKROTIK =====
app.get('/portal/conexao', requireAuth, async (req, res) => {
  const login = req.session.cliente.login;
  try {
    const data = await getMikrotikConexao(login);
    res.json(data);
  } catch (err) {
    // Se MikroTik não responder, retorna offline sem derrubar o portal
    res.json({ online: false, erro: 'Não foi possível consultar a rede.', detalhe: err.message });
  }
});

// ===== CARTEIRA (cartões salvos — Mercado Pago Customers API) =====
// Lógica de cliente MP: lib/mercadopago-wallet.js

app.get('/portal/carteira', requireAuth, async (req, res) => {
  const login = req.session.cliente.login;
  try {
    const rows = sqliteDb.prepare(
      `SELECT id, mp_customer_id, mp_card_id, last_four, payment_method_id, holder_name, created_at
       FROM wallet_cards WHERE login = ? ORDER BY datetime(created_at) DESC`
    ).all(login);
    res.json({ cards: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/portal/carteira/cartao', requireAuth, async (req, res) => {
  if (!MP_TOKEN) return res.status(503).json({ error: 'Mercado Pago não configurado no servidor.' });
  if (!mpChavesMercadoPagoAlinhadas()) {
    return res.status(400).json({
      error:
        'Credenciais Mercado Pago incoerentes: use Public Key e Access Token no mesmo modo (sandbox TEST- ou produção APP_USR). Reinicie o servidor após corrigir o .env.',
    });
  }
  const login = req.session.cliente.login;
  const cardToken = (req.body.cardToken || req.body.card_token_id || '').trim();
  if (!cardToken) return res.status(400).json({ error: 'Envie cardToken (token gerado no navegador com MercadoPago.js).' });

  try {
    const token = await getJWT();
    const mkCli = await axios.get(`${MK_URL}/cliente/show/${login}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const customerId = await mpWalletGetOrCreateCustomer(login, mkCli.data, req.session.cliente.nome);

    const cardRes = await axios.post(
      `${MP_BASE}/v1/customers/${customerId}/cards`,
      { token: cardToken },
      {
        headers: {
          Authorization: `Bearer ${MP_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `wallet-${login}-${Date.now()}`,
        },
      }
    );
    const c = cardRes.data;
    const mpCardId = String(c.id);
    const last4    = c.last_four_digits || '****';
    const pmId       = c.payment_method?.id || c.payment_method_id || '';
    const holder     = c.cardholder?.name || c.cardholder_name || '';

    try {
      sqliteDb.prepare(`
        INSERT INTO wallet_cards (login, mp_customer_id, mp_card_id, last_four, payment_method_id, holder_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(login, customerId, mpCardId, last4, pmId, holder);
    } catch (dbErr) {
      if (dbErr.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw dbErr;
      return res.status(400).json({ error: 'Este cartão já está salvo na sua carteira.' });
    }

    const row = sqliteDb.prepare(
      'SELECT id, mp_customer_id, mp_card_id, last_four, payment_method_id, holder_name, created_at FROM wallet_cards WHERE login = ? AND mp_card_id = ?'
    ).get(login, mpCardId);

    res.json({
      ok: true,
      card: row,
      cartaoValidadoPeloMp: true,
      ambiente: mpAccessTokenEhTeste() ? 'teste' : 'producao',
    });
  } catch (e) {
    const err = e.response?.data;
    console.error('[Carteira]', err || e.message);
    let msg = err?.message || err?.error || err?.cause?.[0]?.description || e.message;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    if (mpAccessTokenEhTeste() && /rejected|invalid|card/i.test(String(msg))) {
      msg +=
        ' No sandbox use só cartões de teste do Mercado Pago (ex.: Mastercard 5031 4332 1540 6351, CVV 123, titular APRO).';
    }
    if (!mpAccessTokenEhTeste() && /rejected|invalid|card|token/i.test(String(msg))) {
      msg += ' Em produção use cartão real; cartões de teste só funcionam com credenciais TEST- no .env.';
    }
    res.status(e.response?.status || 500).json({ error: msg });
  }
});

app.delete('/portal/carteira/cartao/:id', requireAuth, async (req, res) => {
  if (!MP_TOKEN) return res.status(503).json({ error: 'Mercado Pago não configurado no servidor.' });
  const login = req.session.cliente.login;
  const localId = parseInt(req.params.id, 10);
  if (!localId) return res.status(400).json({ error: 'ID inválido' });

  const row = sqliteDb.prepare(
    'SELECT mp_customer_id, mp_card_id FROM wallet_cards WHERE id = ? AND login = ?'
  ).get(localId, login);
  if (!row) return res.status(404).json({ error: 'Cartão não encontrado' });

  try {
    await axios.delete(`${MP_BASE}/v1/customers/${row.mp_customer_id}/cards/${row.mp_card_id}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
  } catch (e) {
    if (e.response?.status !== 404) {
      console.warn('[Carteira] MP delete card:', e.response?.data || e.message);
    }
  }
  sqliteDb.prepare('DELETE FROM wallet_cards WHERE id = ? AND login = ?').run(localId, login);
  res.json({ ok: true });
});

// ===== SPEED TEST =====

// Buffer aleatório pré-gerado (não comprimível por equipamentos de rede)
const ST_CHUNK_SIZE = 131072; // 128KB por chunk
const speedChunk = crypto.randomBytes(ST_CHUNK_SIZE);

// Ping endpoint (resposta mínima, sem body desnecessário)
app.get('/speedtest/ping', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache');
  res.json({ ok: true, ts: Date.now() });
});

// Download endpoint — streaming de bytes aleatórios (até 100MB por stream)
app.get('/speedtest/download', (req, res) => {
  const mb = Math.min(parseInt(req.query.mb) || 10, 100);
  const total = mb * 1024 * 1024;
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Length': total,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  let sent = 0;
  function send() {
    if (sent >= total) { res.end(); return; }
    const size = Math.min(ST_CHUNK_SIZE, total - sent);
    const ok = res.write(speedChunk.slice(0, size));
    sent += size;
    if (ok) setImmediate(send);
    else res.once('drain', send);
  }
  send();
});

// Upload endpoint — drena o body e retorna bytes recebidos + tempo servidor
app.post('/speedtest/upload', (req, res) => {
  const t0 = Date.now();
  let received = 0;
  req.on('data', c => { received += c.length; });
  req.on('end', () => {
    res.set('Cache-Control', 'no-store');
    res.json({ received, elapsed: Date.now() - t0 });
  });
});

// ============================================================
// ===== ADMIN DASHBOARD =====
// ============================================================

function requireAdmin(req, res, next) {
  if (!req.session.adminLogado) return res.status(401).json({ error: 'Não autorizado.' });
  next();
}

// Servir página admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Login admin
app.post('/admin/login', (req, res) => {
  if (!String(ADMIN_PASS || '').trim()) {
    return res.status(503).json({ error: 'Painel admin desabilitado: defina ADMIN_PASS no .env e reinicie o servidor.' });
  }
  const { usuario, senha } = req.body;
  if (usuario === ADMIN_USER && senha === ADMIN_PASS) {
    req.session.adminLogado = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Usuário ou senha incorretos.' });
});

// Logout admin
app.post('/admin/logout', (req, res) => {
  req.session.adminLogado = false;
  res.json({ success: true });
});

// Verificar sessão admin
app.get('/admin/portal-avisos', requireAdmin, (req, res) => {
  try {
    res.json({ avisos: readPortalAvisosDb() });
  } catch (e) {
    res.status(500).json({ error: 'Não foi possível ler os avisos.' });
  }
});

app.put('/admin/portal-avisos', requireAdmin, (req, res) => {
  const raw = req.body;
  const arr = Array.isArray(raw?.avisos) ? raw.avisos : Array.isArray(raw) ? raw : null;
  if (!arr) {
    return res.status(400).json({ error: 'Envie { "avisos": [ ... ] } com um array.' });
  }
  const sanitized = arr.map(sanitizePortalAvisoItem).filter(Boolean).slice(0, 20);
  try {
    replacePortalAvisosDb(sanitized);
    res.json({ success: true, avisos: readPortalAvisosDb() });
  } catch (e) {
    res.status(500).json({ error: 'Não foi possível gravar os avisos.' });
  }
});

app.get('/admin/push/stats', requireAdmin, (req, res) => {
  try {
    const total = sqliteDb.prepare('SELECT COUNT(*) as c FROM push_subscriptions').get().c;
    res.json({ total });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao ler estatísticas push.' });
  }
});

app.post('/admin/push/enviar', requireAdmin, async (req, res) => {
  const { title, body, url, login } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ error: 'Campos title e body são obrigatórios.' });
  }
  const payload = {
    title: String(title).slice(0, 120),
    body: String(body).slice(0, 500),
    url: url ? String(url).slice(0, 500) : '/',
  };
  try {
    const result = login
      ? await pushLib.sendPushToLogin(String(login).trim(), payload)
      : await pushLib.sendPushBroadcast(payload, null, { filterAvisosLemon: true });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Falha ao enviar push.' });
  }
});

app.get('/admin/me', requireAdmin, (req, res) => {
  res.json({ logado: true, usuario: ADMIN_USER });
});

// Stats gerais
app.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    // ── Stats locais (SQLite) ──
    const clientes   = sqliteDb.prepare('SELECT COUNT(*) as n FROM clients').get().n;
    const totalPts   = sqliteDb.prepare('SELECT SUM(total_earned) as s FROM clients').get().s || 0;
    const topCliente = sqliteDb.prepare('SELECT login, points FROM clients ORDER BY points DESC LIMIT 1').get();
    const mediaStreakRow = sqliteDb.prepare('SELECT AVG(streak) as m FROM clients').get();
    const mediaStreak = Math.round(mediaStreakRow?.m || 0);

    const rows = sqliteDb.prepare('SELECT completed_missions FROM clients').all();
    let totalMissoes = 0;
    for (const r of rows) { try { totalMissoes += JSON.parse(r.completed_missions).length; } catch {} }

    const refRows = sqliteDb.prepare('SELECT referrals FROM clients').all();
    let totalReferrals = 0;
    for (const r of refRows) { try { totalReferrals += JSON.parse(r.referrals).length; } catch {} }

    const redRows = sqliteDb.prepare('SELECT redeemed FROM clients').all();
    let totalResgates = 0;
    for (const r of redRows) { try { totalResgates += JSON.parse(r.redeemed).length; } catch {} }

    // Distribuição de níveis (usa total_earned, não saldo atual)
    const nivelRows = sqliteDb.prepare('SELECT total_earned FROM clients').all();
    const niveis = { Bronze: 0, Prata: 0, Ouro: 0, Diamante: 0 };
    for (const r of nivelRows) {
      const te = r.total_earned || 0;
      if (te >= 3000) niveis.Diamante++;
      else if (te >= 1500) niveis.Ouro++;
      else if (te >= 500) niveis.Prata++;
      else niveis.Bronze++;
    }

    // Top 5 clientes por pontos
    const top5 = sqliteDb.prepare('SELECT login, points, streak FROM clients ORDER BY points DESC LIMIT 5').all();

    // ── Stats MK-Auth (paralelo para ser rápido) ──
    const mkSafe = async (path) => { try { return await mkGet(path); } catch { return {}; } };

    // Mês atual para filtros (ex: "2026-04")
    const agora   = new Date();
    const anoMes  = `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,'0')}`;
    const mesLabel = agora.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

    // Helper: filtra array por datavenc no mês atual
    const doMes = (arr) => (arr || []).filter(t => (t.datavenc || t.data || '').startsWith(anoMes));
    const somaValor = (arr) => arr.reduce((s, t) => s + (parseFloat(t.valor) || 0), 0);

    // Busca paralela base
    const [mkCli, mkCh, mkChAb, mkPl, mkCaixaPg1] = await Promise.all([
      mkSafe('cliente/listar/pagina=1'),
      mkSafe('chamado/listar/pagina=1'),
      mkSafe('chamado/listar/pagina=1/status=aberto'),
      mkSafe('plano/listar/pagina=1'),
      mkSafe('caixa/listar/pagina=1'),
    ]);

    // ── Caixa: busca registros recentes para stats do mês ────────────────────
    // API retorna crescente (pág 1 = mais antigo, última pág = mais recente).
    // Usamos limite=1000 na última página para garantir cobertura total do mês.
    const totalMovimentos = mkCaixaPg1.total_registros || 0;
    // Recalcula total_paginas com limite=1000 para saber a última pág correta
    const caixaUltMeta  = await mkSafe('caixa/listar/pagina=1&limite=1000');
    const totalPagsCaixa = caixaUltMeta.total_paginas || 1;
    const caixaUltResp  = totalPagsCaixa > 1
      ? await mkSafe(`caixa/listar/pagina=${totalPagsCaixa}&limite=1000`)
      : caixaUltMeta;

    let movRecentes = [], receitaMes = 0, saidaMes = 0, pagosMes = 0;
    // Inverte para processar do mais recente para o mais antigo
    const caixaRecentes = [...(caixaUltResp.caixa || [])].reverse();
    for (const m of caixaRecentes) {
      const dataReg = (m.data || '').slice(0, 7); // YYYY-MM
      if (dataReg === anoMes) {
        const ent = parseFloat(m.entrada) || 0;
        const sai = parseFloat(m.saida)   || 0;
        receitaMes += ent;
        saidaMes   += sai;
        if (ent > 0) pagosMes++;
      }
      if (movRecentes.length < 10) movRecentes.push(m);
    }

    // Títulos: abertos com vencimento no mês atual + todos os vencidos (inadimplência geral)
    const [mkTitAberto, mkTitVenc] = await Promise.all([
      mkSafe(`titulo/listar/pagina=1&status=aberto&limite=500`),
      mkSafe(`titulo/listar/pagina=1&status=vencido&limite=500`),
    ]);

    // Abertos COM vencimento no mês corrente = "a receber este mês"
    const titAbertoMes = doMes(mkTitAberto.titulos);
    // Vencidos no mês corrente = inadimplentes com vencimento recente
    const titVencMes   = doMes(mkTitVenc.titulos);

    // Totais gerais (count + soma de valor de todos os títulos buscados)
    const totalAbertos       = mkTitAberto.total_registros || (mkTitAberto.titulos || []).length;
    const totalVencidos      = mkTitVenc.total_registros   || (mkTitVenc.titulos   || []).length;
    const valorTotalAbertos  = somaValor(mkTitAberto.titulos || []);
    const valorTotalVencidos = somaValor(mkTitVenc.titulos   || []);

    // Receita do mês vem do caixa (entradas filtradas por data)
    // receitaMes já calculado acima a partir do caixa

    res.json({
      clientes, totalPts, totalMissoes, totalReferrals, totalResgates,
      topCliente, mediaStreak, niveis, top5,
      mk: {
        total:           mkCli.total_registros  || 0,
        chamados:        mkCh.total_registros   || 0,
        chamadosAbertos: mkChAb.total_registros || 0,
        planos:          mkPl.total_registros   || (mkPl.dados || []).length || 0,
        caixa: { receitaMes, saidaMes, movRecentes, totalMovimentos },
        titulos: {
          mesLabel,
          // A receber este mês (abertos com vencimento no mês)
          aReceberMes:      titAbertoMes.length,
          valorAReceberMes: somaValor(titAbertoMes),
          // Inadimplentes com vencimento neste mês
          vencidosMes:      titVencMes.length,
          valorVencidoMes:  somaValor(titVencMes),
          // Receita e contagem de pagamentos do mês (do caixa)
          receitaMes,
          pagosMes,
          // Totais gerais
          totalAbertos, totalVencidos,
          valorTotalAbertos, valorTotalVencidos,
        }
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Listar todos os clientes
app.get('/admin/clientes', requireAdmin, (req, res) => {
  try {
    const { busca = '' } = req.query;
    const rows = sqliteDb.prepare(
      `SELECT login, points, total_earned, streak,
              completed_missions, referrals, redeemed, updated_at
       FROM clients
       WHERE login LIKE ?
       ORDER BY points DESC`
    ).all(`%${busca}%`);

    const clientes = rows.map(r => ({
      login:       r.login,
      points:      r.points,
      totalEarned: r.total_earned,
      streak:      r.streak,
      missoes:     (() => { try { return JSON.parse(r.completed_missions).length; } catch { return 0; } })(),
      referrals:   (() => { try { return JSON.parse(r.referrals).length; } catch { return 0; } })(),
      resgates:    (() => { try { return JSON.parse(r.redeemed).length; } catch { return 0; } })(),
      nivel:       getLevel(r.total_earned).label,
      updatedAt:   r.updated_at,
    }));
    res.json({ clientes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Detalhes de um cliente
app.get('/admin/cliente/:login', requireAdmin, (req, res) => {
  try {
    const row = stmtGet.get(req.params.login);
    if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });
    const c = rowToClient(row);
    const nivel = getLevel(c.totalEarned);
    res.json({ login: row.login, ...c, nivel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Adicionar ou remover pontos manualmente
app.post('/admin/cliente/:login/pontos', requireAdmin, (req, res) => {
  try {
    const { pts, motivo } = req.body;
    const quantidade = parseInt(pts);
    if (!quantidade || isNaN(quantidade)) return res.status(400).json({ error: 'Quantidade inválida.' });

    const row = stmtGet.get(req.params.login);
    if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const db = { [row.login]: rowToClient(row) };
    addPoints(db, row.login, quantidade, 'admin', `👨‍💼 Admin: ${motivo || 'Ajuste manual'}`);
    saveReferrals(db);
    res.json({ success: true, points: db[row.login].points });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Resetar pontos e/ou missões de um cliente
app.post('/admin/cliente/:login/reset', requireAdmin, (req, res) => {
  try {
    const { resetPontos, resetMissoes, resetTudo } = req.body;
    const row = stmtGet.get(req.params.login);
    if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const db = { [row.login]: rowToClient(row) };
    const c  = db[row.login];

    if (resetTudo) {
      c.points = 0; c.totalEarned = 0; c.streak = 0;
      c.completedMissions = []; c.awardedInvoices = [];
      c.referrals = []; c.redeemed = []; c.log = [];
      c.speedtests = []; c.loginHistory = []; c.visitedSections = [];
    } else {
      if (resetPontos)  { c.points = 0; c.totalEarned = 0; c.log = []; }
      if (resetMissoes) { c.completedMissions = []; c.awardedInvoices = []; c.speedtests = []; c.visitedSections = []; }
    }

    saveReferrals(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Completar missão manualmente para um cliente
app.post('/admin/cliente/:login/missao', requireAdmin, (req, res) => {
  try {
    const { missaoId } = req.body;
    const m = MISSIONS[missaoId];
    if (!m) return res.status(400).json({ error: 'Missão inválida.' });

    const row = stmtGet.get(req.params.login);
    if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const db = { [row.login]: rowToClient(row) };
    const c  = db[row.login];

    if (c.completedMissions.includes(missaoId)) {
      return res.json({ jaCompleta: true });
    }

    addPoints(db, row.login, m.pts, 'missao', `🎯 Missão: ${m.label}`);
    c.completedMissions.push(missaoId);
    saveReferrals(db);
    res.json({ success: true, pts: m.pts, pontos: db[row.login].points });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Listar missões disponíveis
app.get('/admin/missoes', requireAdmin, (req, res) => {
  const lista = Object.entries(MISSIONS).map(([id, m]) => ({
    id, label: m.label, pts: m.pts, categoria: m.categoria, auto: !!m.auto
  }));
  res.json({ missoes: lista });
});

// ── Rotas MK-Auth via Admin (getJWT / mk* → lib/mk-api.js) ──────────────────────────────────

// ── Caixa ──
app.get('/admin/mk/caixa', requireAdmin, async (req, res) => {
  try {
    const { pagina = 1, limite = 50 } = req.query;
    const data = await mkGet(`caixa/listar/pagina=${pagina}&limite=${limite}`);
    res.json(data);
  } catch(e) {
    if (e.response?.status === 404) return res.json({ caixa: [], total_registros: 0, total_paginas: 1 });
    res.status(500).json({ error: e.response?.data?.mensagem || e.message });
  }
});

// ── Caixa Stats (mês atual calibrado) ────────────────────────────────────────
app.get('/admin/mk/caixa/stats', requireAdmin, async (req, res) => {
  try {
    const agora   = new Date();
    const anoMes  = `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,'0')}`;
    const mesLabel = agora.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

    // 1. Meta: total de registros e páginas com limite=1000
    const meta = await mkGet('caixa/listar/pagina=1&limite=1000');
    const totalRegistros = meta.total_registros || 0;
    const totalPags      = meta.total_paginas   || 1;

    // 2. Última página (mais recente) com limite=1000 — cobre o mês inteiro
    const ultResp = totalPags > 1
      ? await mkGet(`caixa/listar/pagina=${totalPags}&limite=1000`)
      : meta;
    const movsRecentes = [...(ultResp.caixa || [])].reverse(); // mais novo primeiro

    // 3. Agrega stats do mês e do dia de hoje
    let entMes = 0, saiMes = 0, countEntMes = 0, countSaiMes = 0;
    let entHoje = 0, saiHoje = 0;
    const hoje = agora.toISOString().slice(0, 10);

    // Distribuição diária (últimos 30 dias) para o gráfico
    const porDia = {};
    for (const m of [...movsRecentes].reverse()) {
      const data  = (m.data || '').slice(0, 10);
      const anoM  = (m.data || '').slice(0, 7);
      const ent   = parseFloat(m.entrada) || 0;
      const sai   = parseFloat(m.saida)   || 0;

      if (anoM === anoMes) {
        entMes += ent; saiMes += sai;
        if (ent > 0) countEntMes++;
        if (sai > 0) countSaiMes++;
      }
      if (data === hoje) { entHoje += ent; saiHoje += sai; }

      if (!porDia[data]) porDia[data] = { ent: 0, sai: 0 };
      porDia[data].ent += ent;
      porDia[data].sai += sai;
    }

    // 4. Mês anterior para comparação
    const mesAnt = agora.getMonth() === 0
      ? `${agora.getFullYear()-1}-12`
      : `${agora.getFullYear()}-${String(agora.getMonth()).padStart(2,'0')}`;
    let entMesAnt = 0, saiMesAnt = 0;

    // Busca página anterior ao mês atual (penúltima página pode ter dados do mês anterior)
    const penultResp = totalPags > 1
      ? await mkGet(`caixa/listar/pagina=${totalPags - 1}&limite=1000`)
      : { caixa: [] };
    for (const m of (penultResp.caixa || [])) {
      const anoM = (m.data || '').slice(0, 7);
      if (anoM === mesAnt) {
        entMesAnt += parseFloat(m.entrada) || 0;
        saiMesAnt += parseFloat(m.saida)   || 0;
      }
    }
    // Também verifica os registros do mês atual que podem ter dados do mês anterior
    for (const m of movsRecentes) {
      const anoM = (m.data || '').slice(0, 7);
      if (anoM === mesAnt) {
        entMesAnt += parseFloat(m.entrada) || 0;
        saiMesAnt += parseFloat(m.saida)   || 0;
      }
    }

    // 5. Dias ordenados (últimos 30)
    const diasOrdenados = Object.keys(porDia).sort().slice(-30);

    res.json({
      mesLabel, anoMes,
      totalRegistros,
      // Mês atual
      entMes, saiMes, saldoMes: entMes - saiMes,
      countEntMes, countSaiMes,
      // Hoje
      entHoje, saiHoje,
      // Mês anterior (para comparação)
      entMesAnt, saiMesAnt,
      varEntradas: entMesAnt > 0 ? ((entMes - entMesAnt) / entMesAnt * 100).toFixed(1) : null,
      // Gráfico diário
      grafico: diasOrdenados.map(d => ({
        dia: d.slice(5), // mm-dd
        ent: porDia[d].ent,
        sai: porDia[d].sai,
      })),
      // Últimos 10 movimentos
      ultimos: movsRecentes.slice(0, 10),
    });
  } catch(e) {
    if (e.response?.status === 404) return res.json({ entMes: 0, saiMes: 0, saldoMes: 0, countEntMes: 0, grafico: [], ultimos: [] });
    res.status(500).json({ error: e.response?.data?.mensagem || e.message });
  }
});

// ── Títulos ──
app.get('/admin/mk/titulos', requireAdmin, async (req, res) => {
  try {
    const { pagina = 1, limite = 100, status = '' } = req.query;
    // filtros com & após o / inicial: listar/pagina=1&status=pago&limite=100
    const filtroStatus = status ? `&status=${status}` : '';
    const data = await mkGet(`titulo/listar/pagina=${pagina}${filtroStatus}&limite=${limite}`);
    res.json(data);
  } catch(e) {
    if (e.response?.status === 404) return res.json({ titulos: [], total_registros: 0, total_paginas: 1 });
    res.status(500).json({ error: e.response?.data?.mensagem || e.message });
  }
});

// ── Clientes MK-Auth ──
app.get('/admin/mk/clientes', requireAdmin, async (req, res) => {
  const vazio = { clientes: [], total_registros: 0, total_paginas: 1 };
  async function mkGetSafe(path) {
    try { return await mkGet(path); }
    catch(e) {
      if (e.response?.status === 404) return vazio;
      throw e;
    }
  }
  try {
    const { pagina = 1, busca = '' } = req.query;
    if (!busca) {
      return res.json(await mkGetSafe(`cliente/listar/pagina=${pagina}`));
    }
    // MK-Auth aceita filtros como params de URL separados por / ou &
    // Testa por login (segmentos separados por /)
    const urlLogin = `cliente/listar/pagina=${pagina}/login=${encodeURIComponent(busca)}`;
    console.log('[MK busca] tentando:', urlLogin);
    const porLogin = await mkGetSafe(urlLogin);
    if (porLogin.clientes && porLogin.clientes.length) return res.json(porLogin);

    // Fallback: por nome
    const urlNome = `cliente/listar/pagina=${pagina}/nome=${encodeURIComponent(busca)}`;
    console.log('[MK busca] fallback:', urlNome);
    const porNome = await mkGetSafe(urlNome);
    if (porNome.clientes && porNome.clientes.length) return res.json(porNome);

    // Fallback 2: sem pagina no filtro (formato da doc: listar/login=x)
    const urlSemPagina = `cliente/listar/login=${encodeURIComponent(busca)}`;
    console.log('[MK busca] sem pagina:', urlSemPagina);
    const porLoginSemPag = await mkGetSafe(urlSemPagina);
    res.json(porLoginSemPag);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.get('/admin/mk/cliente/:login', requireAdmin, async (req, res) => {
  try {
    const data = await mkGet(`cliente/show/${req.params.login}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.put('/admin/mk/cliente/editar', requireAdmin, async (req, res) => {
  try {
    const data = await mkPut('cliente/editar', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.post('/admin/mk/cliente/inserir', requireAdmin, async (req, res) => {
  try {
    const data = await mkPost('cliente/inserir', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.delete('/admin/mk/cliente/:uuid', requireAdmin, async (req, res) => {
  try {
    const data = await mkDelete(`cliente/${req.params.uuid}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

// ── Chamados ──
app.get('/admin/mk/chamados', requireAdmin, async (req, res) => {
  try {
    const { pagina = 1, status = '' } = req.query;
    const path = status ? `chamado/listar/pagina=${pagina}/status=${status}` : `chamado/listar/pagina=${pagina}`;
    const data = await mkGet(path);
    res.json(data);
  } catch(e) {
    if (e.response?.status === 404) return res.json({ dados: [], total_paginas: 1 });
    res.status(500).json({ error: e.response?.data?.mensagem || e.message });
  }
});

app.get('/admin/mk/chamado/:numero', requireAdmin, async (req, res) => {
  try {
    const data = await mkGet(`chamado/show/${req.params.numero}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.post('/admin/mk/chamado/inserir', requireAdmin, async (req, res) => {
  try {
    const data = await mkPost('chamado/inserir', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.put('/admin/mk/chamado/editar', requireAdmin, async (req, res) => {
  try {
    const data = await mkPut('chamado/editar', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.put('/admin/mk/chamado/fechar', requireAdmin, async (req, res) => {
  try {
    const data = await mkPut('chamado/fechar', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.get('/admin/mk/chamado/reabrir/:numero', requireAdmin, async (req, res) => {
  try {
    const data = await mkGet(`chamado/reabrir/${req.params.numero}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.delete('/admin/mk/chamado/:numero', requireAdmin, async (req, res) => {
  try {
    const data = await mkDelete(`chamado/${req.params.numero}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

// ── Mensagens ──
app.post('/admin/mk/mensagem/email', requireAdmin, async (req, res) => {
  try {
    const data = await mkPost('mensagem/enviar_email', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.post('/admin/mk/mensagem/sms', requireAdmin, async (req, res) => {
  try {
    const data = await mkPost('mensagem/enviar_sms', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.post('/admin/mk/mensagem/zap', requireAdmin, async (req, res) => {
  try {
    const { login, mensagem } = req.body;
    if (!login || !mensagem) return res.status(400).json({ error: 'login e mensagem obrigatórios' });
    const ok = await enviarZapCliente(login, mensagem);
    res.json({ ok, mensagem: ok ? 'Enviado via Evolution API' : 'Falha no envio' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Faturas (títulos) ──
app.get('/admin/mk/faturas/abertas/:cpf', requireAdmin, async (req, res) => {
  try {
    const data = await mkGet(`titulo/aberto/${req.params.cpf}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.get('/admin/mk/faturas/vencidas/:cpf', requireAdmin, async (req, res) => {
  try {
    const data = await mkGet(`titulo/vencido/${req.params.cpf}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.put('/admin/mk/faturas/receber', requireAdmin, async (req, res) => {
  try {
    const data = await mkPut('titulo/receber', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.delete('/admin/mk/faturas/:uuid', requireAdmin, async (req, res) => {
  try {
    const data = await mkDelete(`titulo/${req.params.uuid}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

// ── Planos ──
app.get('/admin/mk/planos', requireAdmin, async (req, res) => {
  try {
    const data = await mkGet('plano/listar/pagina=1');
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.get('/admin/mk/plano/:uuid', requireAdmin, async (req, res) => {
  try {
    const data = await mkGet(`plano/show/${req.params.uuid}`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.put('/admin/mk/plano/editar', requireAdmin, async (req, res) => {
  try {
    const data = await mkPut('plano/editar', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

app.post('/admin/mk/plano/inserir', requireAdmin, async (req, res) => {
  try {
    const data = await mkPost('plano/inserir', req.body);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.response?.data?.mensagem || e.message }); }
});

// ── Limpeza de títulos antigos ────────────────────────────────────────────────

// Listar (preview) - títulos abertos antes de um ano
app.get('/admin/mk/titulos/limpeza/preview', requireAdmin, async (req, res) => {
  const { ateAno = 2022, status = 'aberto' } = req.query;
  const limite = 500;
  const encontrados = [];

  // Quais status buscar
  const statusList = status === 'ambos' ? ['aberto', 'vencido'] : [status];

  try {
    for (const st of statusList) {
      let pagina = 1, totalPags = 1;
      do {
        const d = await mkGet(`titulo/listar/pagina=${pagina}&status=${st}&limite=${limite}`);
        totalPags = d.total_paginas || 1;
        for (const t of (d.titulos || [])) {
          const ano = parseInt((t.datavenc || '').slice(0, 4));
          if (ano && ano <= parseInt(ateAno)) {
            encontrados.push({ uuid: t.uuid, login: t.login, valor: t.valor, datavenc: t.datavenc, tipo: t.tipo, status: st });
          }
        }
        pagina++;
        if (pagina > 50) break;
      } while (pagina <= totalPags);
    }

    const totalValor = encontrados.reduce((s, t) => s + (parseFloat(t.valor) || 0), 0);
    res.json({ total: encontrados.length, totalValor, titulos: encontrados.slice(0, 100) });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.mensagem || e.message });
  }
});

// Executar deleção — requer confirmação no body
app.delete('/admin/mk/titulos/limpeza', requireAdmin, async (req, res) => {
  const { confirmar, ateAno = 2022, status = 'aberto' } = req.body || {};
  if (confirmar !== 'CONFIRMAR') return res.status(400).json({ error: 'Confirmação inválida.' });

  const limite = 500;
  let deletados = 0, erros = 0;
  const logErros = [];

  const statusList = status === 'ambos' ? ['aberto', 'vencido'] : [status];

  try {
    // Coleta todos os UUIDs primeiro
    const uuids = [];
    for (const st of statusList) {
      let pagina = 1, totalPags = 1;
      do {
        const d = await mkGet(`titulo/listar/pagina=${pagina}&status=${st}&limite=${limite}`);
        totalPags = d.total_paginas || 1;
        for (const t of (d.titulos || [])) {
          const ano = parseInt((t.datavenc || '').slice(0, 4));
          if (ano && ano <= parseInt(ateAno)) uuids.push(t.uuid);
        }
        pagina++;
        if (pagina > 50) break;
      } while (pagina <= totalPags);
    }

    console.log(`[Limpeza] ${uuids.length} títulos a deletar (${status} até ${ateAno})`);

    for (const uuid of uuids) {
      try {
        await mkDelete(`titulo/${uuid}`);
        deletados++;
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {
        erros++;
        logErros.push({ uuid, erro: e.response?.data?.mensagem || e.message });
      }
    }

    console.log(`[Limpeza] Concluído: ${deletados} deletados, ${erros} erros`);
    res.json({ deletados, erros, logErros: logErros.slice(0, 20) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Sistema de Notificações WhatsApp ──────────────────────────────────────────

const PORTAL_URL = (process.env.PORTAL_URL || '').trim().replace(/^['"]|['"]$/g, '') || LEMON_PORTAL_PUBLIC;

function getTemplate(chave) {
  return sqliteDb.prepare('SELECT * FROM notif_templates WHERE chave = ?').get(chave);
}

function renderTemplate(mensagem, vars = {}) {
  return mensagem.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{${k}}`);
}

function logNotif({ login, tipo, canal = 'zap', mensagem, status = 'sent', erro = null }) {
  sqliteDb.prepare(`
    INSERT INTO notifications (login, tipo, canal, mensagem, status, erro)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(login, tipo, canal, mensagem, status, erro);
}

// ── Evolution API ──────────────────────────────────────────────────────────
const EVO_URL      = process.env.EVO_URL      || '';
const EVO_INSTANCE = process.env.EVO_INSTANCE || '';
const EVO_APIKEY   = process.env.EVO_APIKEY   || '';

// Cache login → número celular para evitar consulta repetida ao MK-Auth
const _celularCache = new Map();

// Formata número BR para WhatsApp (55 + DDD + número, sem formatação)
function formatarCelularBR(raw = '') {
  const digits = raw.replace(/\D/g, '');
  // Se já tem 55 na frente, mantém; senão adiciona
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`; // celular com DDD
  if (digits.length === 10) return `55${digits}`; // fixo com DDD
  if (digits.length === 9)  return `559${digits}`; // sem DDD — improvável
  return digits.length >= 8 ? `55${digits}` : null;
}

// Busca o número de celular do cliente no MK-Auth (com cache 5min)
async function getCelularCliente(login) {
  const cached = _celularCache.get(login);
  if (cached && (Date.now() - cached.ts) < 300_000) return cached.numero;

  // Tenta pelo login direto (usando mkGet que já cuida do JWT)
  try {
    const cli = await mkGet(`cliente/show/${login}`);
    const raw = cli?.celular || cli?.fone || cli?.telefone || '';
    const numero = formatarCelularBR(raw);
    if (numero) {
      _celularCache.set(login, { numero, ts: Date.now() });
      console.log(`[EVO] Celular de ${login}: ${numero}`);
      return numero;
    }
  } catch (e) {
    console.warn(`[EVO] Falha ao buscar celular de ${login} via show:`, e.message);
  }

  // Fallback: busca na listagem filtrada por login
  try {
    const res = await mkGet(`cliente/listar/pagina=1&login=${encodeURIComponent(login)}`);
    const cli = (res.clientes || []).find(c => c.login === login);
    const raw = cli?.celular || cli?.fone || cli?.telefone || '';
    const numero = formatarCelularBR(raw);
    if (numero) {
      _celularCache.set(login, { numero, ts: Date.now() });
      console.log(`[EVO] Celular de ${login} (via lista): ${numero}`);
      return numero;
    }
  } catch (e) {
    console.warn(`[EVO] Falha ao buscar celular de ${login} via lista:`, e.message);
  }

  console.warn(`[EVO] ⚠️ Nenhum celular encontrado para login "${login}" — verifique o cadastro no MK-Auth`);
  return null;
}

// Envia WhatsApp via Evolution API
async function enviarZapCliente(login, mensagem) {
  const canal = 'evolution';
  try {
    if (!EVO_URL || !EVO_INSTANCE || !EVO_APIKEY) {
      throw new Error('Evolution API não configurada no .env');
    }

    const numero = await getCelularCliente(login);
    if (!numero) {
      throw new Error(`Número de celular não encontrado para o login "${login}"`);
    }

    await axios.post(
      `${EVO_URL}/message/sendText/${EVO_INSTANCE}`,
      { number: numero, text: mensagem, delay: 1000 },
      { headers: { apikey: EVO_APIKEY, 'Content-Type': 'application/json' } }
    );

    logNotif({ login, tipo: 'zap', canal, mensagem, status: 'sent' });
    console.log(`[EVO] ✅ Enviado para ${login} (${numero})`);
    return true;
  } catch (e) {
    const erro = e.response?.data?.message || e.response?.data?.error || e.message;
    logNotif({ login, tipo: 'zap', canal, mensagem, status: 'error', erro });
    console.warn(`[EVO] ❌ Falha para ${login}: ${erro}`);
    return false;
  }
}

async function enviarBoasVindas(login, nome) {
  const tpl = getTemplate('boas_vindas');
  if (!tpl || !tpl.ativo) return;
  const msg = renderTemplate(tpl.mensagem, { nome, login, portal_url: PORTAL_URL });
  await enviarZapCliente(login, msg);
}

// Notifica cliente via WhatsApp após cadastro (ainda não tem acesso, usa celular do formulário)
async function notificarCadastro(login, nome, celular) {
  try {
    const tpl = getTemplate('boas_vindas_cadastro');
    if (!tpl || !tpl.ativo) return;
    const msg = renderTemplate(tpl.mensagem, { nome, login, portal_url: PORTAL_URL });

    // Pré-popula o cache com o celular do formulário para o enviarZapCliente usar
    if (celular) {
      const digits = celular.replace(/\D/g, '');
      if (digits.length >= 10) {
        const numero = digits.startsWith('55') ? digits : '55' + digits;
        _celularCache.set(login, { numero, ts: Date.now() });
      }
    }

    // Se ainda não tiver no cache, aguarda 3s para MK-Auth registrar e busca lá
    if (!_celularCache.has(login)) {
      await new Promise(r => setTimeout(r, 3000));
    }

    // Usa o enviarZapCliente padrão (Evolution API)
    await enviarZapCliente(login, msg);
  } catch (e) {
    console.warn(`[EVO Cadastro] ❌ Falha para ${login}:`, e.message);
  }
}

// Notifica cliente via WhatsApp após resgate de pontos
async function notificarResgate(login, nome, beneficio, pontosUsados, pontosRestantes) {
  try {
    const tpl = getTemplate('resgate_pontos');
    if (!tpl || !tpl.ativo) return;
    const data = new Date().toLocaleDateString('pt-BR');
    const msg = renderTemplate(tpl.mensagem, {
      nome, login, beneficio,
      pontos_usados: pontosUsados,
      pontos_restantes: pontosRestantes,
      data, portal_url: PORTAL_URL
    });
    await enviarZapCliente(login, msg);
    console.log(`[EVO Resgate] ✅ Notificação de resgate enviada para ${login}`);
  } catch (e) {
    console.warn(`[EVO Resgate] ❌ Falha para ${login}:`, e.message);
  }
}

async function enviarApresentacaoClube(login, nome) {
  const tpl = getTemplate('lemon_club');
  if (!tpl || !tpl.ativo) return;
  const msg = renderTemplate(tpl.mensagem, { nome, login, portal_url: PORTAL_URL });
  await enviarZapCliente(login, msg);
}

// Verifica se é o primeiro login no portal (nunca teve notificação de boas-vindas)
function isPrimeiroLogin(login) {
  const notif = sqliteDb.prepare(`SELECT id FROM notifications WHERE login = ? AND tipo = 'zap' LIMIT 1`).get(login);
  const hist  = sqliteDb.prepare(`SELECT login_history FROM clients WHERE login = ?`).get(login);
  if (notif) return false;
  if (hist) {
    try {
      const arr = JSON.parse(hist.login_history || '[]');
      if (arr.length > 1) return false; // mais de 1 entrada = não é primeiro
    } catch {}
  }
  return true;
}

// ── Rotas admin: Templates ───────────────────────────────────────────────────

app.get('/admin/notif/templates', requireAdmin, (req, res) => {
  const rows = sqliteDb.prepare('SELECT * FROM notif_templates ORDER BY id').all();
  res.json(rows);
});

app.put('/admin/notif/templates/:chave', requireAdmin, (req, res) => {
  const { chave } = req.params;
  const { titulo, mensagem, ativo } = req.body;
  sqliteDb.prepare(`
    UPDATE notif_templates SET titulo = ?, mensagem = ?, ativo = ?, updated_at = datetime('now')
    WHERE chave = ?
  `).run(titulo, mensagem, ativo ? 1 : 0, chave);
  res.json({ ok: true });
});

// ── Rotas admin: Envio manual ─────────────────────────────────────────────────

// Busca o nome real do cliente no MK-Auth pelo login
// Notifica com pontos incluídos na mensagem
async function notificarFaturaPagaComPontos(login, valor, resultado = {}) {
  try {
    const tpl = getTemplate('fatura_paga');
    if (!tpl || !tpl.ativo) return;
    const nome = await getNomeCliente(login);
    const data = new Date().toLocaleDateString('pt-BR');
    const valorFmt = parseFloat(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const db = getClientData(login);
    const totalPts = db[login]?.points || resultado.totalPts || 0;
    const streak   = db[login]?.streak || resultado.streak   || 0;

    // Adiciona linha de pontos à mensagem
    const extra = `\n🌟 Você ganhou *+25 pontos* no Lemon Club!\n💎 Total acumulado: *${totalPts} pontos* | Faturas em dia: *${streak}*`;
    const msg = renderTemplate(tpl.mensagem, { nome, login, valor: valorFmt, data, portal_url: PORTAL_URL }) + extra;
    await enviarZapCliente(login, msg);
  } catch (e) {
    console.warn(`[ZAP Pagamento+Pts] ❌ Falha:`, e.message);
  }
}


async function getNomeCliente(login) {
  try {
    // Tenta buscar direto pelo login na listagem
    const res = await mkGet(`cliente/listar/pagina=1&login=${encodeURIComponent(login)}`);
    const cli = (res.clientes || []).find(c => c.login === login);
    if (cli && cli.nome) return cli.nome;
  } catch {}
  try {
    // Fallback: show pelo próprio login (MK-Auth aceita login ou CPF)
    const cli = await mkGet(`cliente/show/${login}`);
    if (cli && cli.nome) return cli.nome;
  } catch {}
  return login; // último fallback: usa o login
}

// Enviar mensagem personalizada ou template para um cliente específico
app.post('/admin/notif/enviar', requireAdmin, async (req, res) => {
  const { login, mensagem } = req.body;
  if (!login || !mensagem) return res.status(400).json({ error: 'login e mensagem são obrigatórios' });
  const nome = await getNomeCliente(login);
  const msg  = renderTemplate(mensagem, { nome, login, portal_url: PORTAL_URL });
  const ok   = await enviarZapCliente(login, msg);
  res.json({ ok, mensagem: msg, nome });
});

// Enviar boas-vindas para um cliente específico
app.post('/admin/notif/boas-vindas/:login', requireAdmin, async (req, res) => {
  const { login } = req.params;
  try {
    const nome = await getNomeCliente(login);
    await enviarBoasVindas(login, nome);
    // 5s depois, envia apresentação do clube
    setTimeout(() => enviarApresentacaoClube(login, nome), 5000);
    res.json({ ok: true, nome });
  } catch (e) {
    res.status(500).json({ error: e.response?.data?.mensagem || e.message });
  }
});

// Disparo em massa: envia boas-vindas para clientes sem notificação
app.post('/admin/notif/disparo-massa', requireAdmin, async (req, res) => {
  const { template, logins } = req.body; // logins: array ou 'todos'
  if (!template) return res.status(400).json({ error: 'template obrigatório' });

  const tpl = getTemplate(template);
  if (!tpl || !tpl.ativo) return res.status(404).json({ error: 'Template não encontrado ou inativo' });

  let alvo = [];
  if (Array.isArray(logins) && logins.length) {
    alvo = logins;
  } else {
    // Busca clientes que nunca receberam notificação
    const comNotif = sqliteDb.prepare(`SELECT DISTINCT login FROM notifications`).all().map(r => r.login);
    const todos    = sqliteDb.prepare(`SELECT login FROM clients`).all().map(r => r.login);
    alvo = todos.filter(l => !comNotif.includes(l));
  }

  // Responde imediatamente, dispara em background
  res.json({ ok: true, total: alvo.length, mensagem: `Disparando para ${alvo.length} cliente(s)...` });

  (async () => {
    for (const login of alvo) {
      try {
        const nome = await getNomeCliente(login);
        const msg  = renderTemplate(tpl.mensagem, { nome, login, portal_url: PORTAL_URL });
        await enviarZapCliente(login, msg);
      } catch {}
      await new Promise(r => setTimeout(r, 500)); // delay 500ms entre envios
    }
    console.log(`[Disparo] Finalizado para ${alvo.length} clientes`);
  })();
});

// ── Rotas admin: Histórico ────────────────────────────────────────────────────

app.get('/admin/notif/historico', requireAdmin, (req, res) => {
  const { login, status, pagina = 1, limite = 50 } = req.query;
  const pg  = parseInt(pagina) || 1;
  const lim = parseInt(limite) || 50;
  const off = (pg - 1) * lim;

  let where = '1=1';
  const params = [];
  if (login)  { where += ' AND login LIKE ?'; params.push(`%${login}%`); }
  if (status) { where += ' AND status = ?';   params.push(status); }

  const total = sqliteDb.prepare(`SELECT COUNT(*) as n FROM notifications WHERE ${where}`).get(...params).n;
  const rows  = sqliteDb.prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
                        .all(...params, lim, off);
  res.json({ total, paginas: Math.ceil(total / lim), pagina: pg, rows });
});

app.get('/admin/notif/stats', requireAdmin, (req, res) => {
  const total   = sqliteDb.prepare(`SELECT COUNT(*) as n FROM notifications`).get().n;
  const enviados = sqliteDb.prepare(`SELECT COUNT(*) as n FROM notifications WHERE status='sent'`).get().n;
  const erros    = sqliteDb.prepare(`SELECT COUNT(*) as n FROM notifications WHERE status='error'`).get().n;
  const hoje     = sqliteDb.prepare(`SELECT COUNT(*) as n FROM notifications WHERE DATE(created_at)=DATE('now')`).get().n;
  const clientes = sqliteDb.prepare(`SELECT COUNT(DISTINCT login) as n FROM notifications`).get().n;
  res.json({ total, enviados, erros, hoje, clientes });
});

registerWatchBrasilRoutes(app, { requireAuth, requireAdmin });

registerMercadoPagoRoutes(app, {
  requireAuth,
  concederPontosMP,
  notificarFaturaPagaComPontos,
});

// Arquivos estáticos depois de todas as rotas de API (evita HTML no lugar de JSON em /portal/*)
app.use(express.static(path.join(__dirname, 'public')));

// Pedidos /portal/* órfãos → JSON em vez de index.html (quando o pedido chega ao Node)
app.use((req, res, next) => {
  if (req.path.startsWith('/portal/')) {
    return res.status(404).type('application/json').json({
      error: 'Rota não encontrada neste processo Node.',
      path: req.path,
    });
  }
  next();
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🍋 Lemon Portal rodando em http://localhost:${PORT}`);
  if (MP_TOKEN && MP_PUBKEY && !mpChavesMercadoPagoAlinhadas()) {
    console.warn(
      '[MP] ⚠️  Public Key e Access Token misturam sandbox (TEST-) e produção (APP_USR). Cartão na carteira e assinatura vão falhar até alinhar o .env.'
    );
  } else if (MP_TOKEN && MP_PUBKEY) {
    console.log(`[MP] Ambiente: ${mpAccessTokenEhTeste() ? 'SANDBOX (cartões de teste)' : 'PRODUÇÃO (cartão real)'}`);
  }
});

startMercadoPagoPendingJob(concederPontosMP, notificarFaturaPagaComPontos);
startPushFaturaReminderJob(getJWT, MK_URL);
