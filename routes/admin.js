'use strict';
const path = require('path');
const { requireAdmin } = require('../lib/auth');
const config = require('../lib/config');
const { mkGet, mkPost, mkPut, mkDelete } = require('../lib/mk-api');
const { sqliteDb } = require('../lib/database');
const {
  MISSIONS,
  getLevel,
  getClientData,
  addPoints,
  saveClient,
  rowToClient,
  stmtGet,
} = require('../lib/clube');
const pushLib = require('../lib/push');
const { readPortalAvisosDb, replacePortalAvisosDb, sanitizePortalAvisoItem } = require('../lib/portal-avisos');
const {
  readSplashLoadingMensagensDb,
  replaceSplashLoadingMensagens,
} = require('../lib/splash-loading-msgs');
const { enviarZapCliente } = require('../lib/whatsapp');

const { ADMIN_USER, ADMIN_PASS } = config;

// ── Rate limiting in-memory (login admin) ─────────────────────────────────
const _loginAttempts = new Map();
const RL_WINDOW_MS = 15 * 60 * 1000; // 15 min
const RL_MAX       = 10;              // max 10 tentativas por janela por IP

function rlCheck(ip) {
  const now = Date.now();
  let e = _loginAttempts.get(ip);
  if (!e || now > e.reset) e = { count: 0, reset: now + RL_WINDOW_MS };
  e.count++;
  _loginAttempts.set(ip, e);
  return e.count <= RL_MAX;
}
// Limpa entradas expiradas a cada 30 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of _loginAttempts) if (now > e.reset) _loginAttempts.delete(ip);
}, 30 * 60 * 1000);

function registerAdminRoutes(app) {
  // ── Auth Admin ─────────────────────────────────────────────────────────────

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
  });

  app.post('/admin/login', (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!rlCheck(ip)) {
      console.warn(`[Admin Login] Rate limit atingido para IP ${ip}`);
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
    }
    if (!String(ADMIN_PASS || '').trim()) {
      return res.status(503).json({ error: 'Painel admin desabilitado: defina ADMIN_PASS no .env e reinicie o servidor.' });
    }
    const { usuario, senha } = req.body;
    if (usuario === ADMIN_USER && senha === ADMIN_PASS) {
      // Regenera o ID de sessão após login para evitar session fixation
      req.session.regenerate((err) => {
        if (err) return res.status(500).json({ error: 'Erro ao iniciar sessão.' });
        req.session.adminLogado = true;
        res.json({ success: true });
      });
      return;
    }
    res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  });

  app.post('/admin/logout', (req, res) => {
    req.session.destroy(err => {
      if (err) console.warn('[Admin Logout] Erro ao destruir sessão:', err.message);
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });

  app.get('/admin/me', requireAdmin, (req, res) => {
    res.json({ logado: true, usuario: ADMIN_USER });
  });

  // ── Portal Avisos ──────────────────────────────────────────────────────────

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

  app.get('/admin/splash-mensagens', requireAdmin, (req, res) => {
    try {
      res.json({ mensagens: readSplashLoadingMensagensDb() });
    } catch (e) {
      res.status(500).json({ error: 'Não foi possível ler as mensagens do splash.' });
    }
  });

  app.put('/admin/splash-mensagens', requireAdmin, (req, res) => {
    const raw = req.body;
    const arr = Array.isArray(raw?.mensagens)
      ? raw.mensagens
      : Array.isArray(raw)
        ? raw
        : null;
    if (!arr) {
      return res.status(400).json({ error: 'Envie { "mensagens": [ "texto1", "texto2" ] }.' });
    }
    try {
      replaceSplashLoadingMensagens(arr);
      res.json({ success: true, mensagens: readSplashLoadingMensagensDb() });
    } catch (e) {
      res.status(500).json({ error: 'Não foi possível gravar as mensagens do splash.' });
    }
  });

  // ── Push ───────────────────────────────────────────────────────────────────

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

  // ── Stats Gerais ───────────────────────────────────────────────────────────

  app.get('/admin/stats', requireAdmin, async (req, res) => {
    try {
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

      const nivelRows = sqliteDb.prepare('SELECT total_earned FROM clients').all();
      const niveis = { Bronze: 0, Prata: 0, Ouro: 0, Diamante: 0 };
      for (const r of nivelRows) {
        const te = r.total_earned || 0;
        if (te >= 3000) niveis.Diamante++;
        else if (te >= 1500) niveis.Ouro++;
        else if (te >= 500) niveis.Prata++;
        else niveis.Bronze++;
      }

      const top5 = sqliteDb.prepare('SELECT login, points, streak FROM clients ORDER BY points DESC LIMIT 5').all();

      const mkSafe = async (p) => { try { return await mkGet(p); } catch { return {}; } };

      const agora   = new Date();
      const anoMes  = `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,'0')}`;
      const mesLabel = agora.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

      const doMes = (arr) => (arr || []).filter(t => (t.datavenc || t.data || '').startsWith(anoMes));
      const somaValor = (arr) => arr.reduce((s, t) => s + (parseFloat(t.valor) || 0), 0);

      const [mkCli, mkCh, mkChAb, mkPl, mkCaixaPg1] = await Promise.all([
        mkSafe('cliente/listar/pagina=1'),
        mkSafe('chamado/listar/pagina=1'),
        mkSafe('chamado/listar/pagina=1/status=aberto'),
        mkSafe('plano/listar/pagina=1'),
        mkSafe('caixa/listar/pagina=1'),
      ]);

      const totalMovimentos = mkCaixaPg1.total_registros || 0;
      const caixaUltMeta  = await mkSafe('caixa/listar/pagina=1&limite=1000');
      const totalPagsCaixa = caixaUltMeta.total_paginas || 1;
      const caixaUltResp  = totalPagsCaixa > 1
        ? await mkSafe(`caixa/listar/pagina=${totalPagsCaixa}&limite=1000`)
        : caixaUltMeta;

      let movRecentes = [], receitaMes = 0, saidaMes = 0, pagosMes = 0;
      const caixaRecentes = [...(caixaUltResp.caixa || [])].reverse();
      for (const m of caixaRecentes) {
        const dataReg = (m.data || '').slice(0, 7);
        if (dataReg === anoMes) {
          const ent = parseFloat(m.entrada) || 0;
          const sai = parseFloat(m.saida)   || 0;
          receitaMes += ent;
          saidaMes   += sai;
          if (ent > 0) pagosMes++;
        }
        if (movRecentes.length < 10) movRecentes.push(m);
      }

      const [mkTitAberto, mkTitVenc] = await Promise.all([
        mkSafe(`titulo/listar/pagina=1&status=aberto&limite=500`),
        mkSafe(`titulo/listar/pagina=1&status=vencido&limite=500`),
      ]);

      const titAbertoMes = doMes(mkTitAberto.titulos);
      const titVencMes   = doMes(mkTitVenc.titulos);

      const totalAbertos       = mkTitAberto.total_registros || (mkTitAberto.titulos || []).length;
      const totalVencidos      = mkTitVenc.total_registros   || (mkTitVenc.titulos   || []).length;
      const valorTotalAbertos  = somaValor(mkTitAberto.titulos || []);
      const valorTotalVencidos = somaValor(mkTitVenc.titulos   || []);

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
            aReceberMes:      titAbertoMes.length,
            valorAReceberMes: somaValor(titAbertoMes),
            vencidosMes:      titVencMes.length,
            valorVencidoMes:  somaValor(titVencMes),
            receitaMes,
            pagosMes,
            totalAbertos, totalVencidos,
            valorTotalAbertos, valorTotalVencidos,
          }
        }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Clientes Clube ─────────────────────────────────────────────────────────

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

  app.post('/admin/cliente/:login/pontos', requireAdmin, (req, res) => {
    try {
      const { pts, motivo } = req.body;
      const quantidade = parseInt(pts);
      if (!quantidade || isNaN(quantidade)) return res.status(400).json({ error: 'Quantidade inválida.' });

      const row = stmtGet.get(req.params.login);
      if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });

      const c = rowToClient(row);
      const db = { [row.login]: c };
      addPoints(db, row.login, quantidade, 'admin', `👨‍💼 Admin: ${motivo || 'Ajuste manual'}`);
      saveClient(row.login, c);
      res.json({ success: true, points: c.points });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/admin/cliente/:login/reset', requireAdmin, (req, res) => {
    try {
      const { resetPontos, resetMissoes, resetTudo } = req.body;
      const row = stmtGet.get(req.params.login);
      if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });

      const c = rowToClient(row);

      if (resetTudo) {
        c.points = 0; c.totalEarned = 0; c.streak = 0;
        c.completedMissions = []; c.awardedInvoices = [];
        c.referrals = []; c.redeemed = []; c.log = [];
        c.speedtests = []; c.loginHistory = []; c.visitedSections = [];
      } else {
        if (resetPontos)  { c.points = 0; c.totalEarned = 0; c.log = []; }
        if (resetMissoes) { c.completedMissions = []; c.awardedInvoices = []; c.speedtests = []; c.visitedSections = []; }
      }

      saveClient(row.login, c);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/admin/cliente/:login/missao', requireAdmin, (req, res) => {
    try {
      const { missaoId } = req.body;
      const m = MISSIONS[missaoId];
      if (!m) return res.status(400).json({ error: 'Missão inválida.' });

      const row = stmtGet.get(req.params.login);
      if (!row) return res.status(404).json({ error: 'Cliente não encontrado.' });

      const c = rowToClient(row);
      const db = { [row.login]: c };

      if (c.completedMissions.includes(missaoId)) {
        return res.json({ jaCompleta: true });
      }

      addPoints(db, row.login, m.pts, 'missao', `🎯 Missão: ${m.label}`);
      c.completedMissions.push(missaoId);
      saveClient(row.login, c);
      res.json({ success: true, pts: m.pts, pontos: c.points });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/admin/missoes', requireAdmin, (req, res) => {
    const lista = Object.entries(MISSIONS).map(([id, m]) => ({
      id, label: m.label, pts: m.pts, categoria: m.categoria, auto: !!m.auto
    }));
    res.json({ missoes: lista });
  });

  // ── MK-Auth Proxy ──────────────────────────────────────────────────────────

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

  app.get('/admin/mk/caixa/stats', requireAdmin, async (req, res) => {
    try {
      const agora   = new Date();
      const anoMes  = `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,'0')}`;
      const mesLabel = agora.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

      const meta = await mkGet('caixa/listar/pagina=1&limite=1000');
      const totalRegistros = meta.total_registros || 0;
      const totalPags      = meta.total_paginas   || 1;

      const ultResp = totalPags > 1
        ? await mkGet(`caixa/listar/pagina=${totalPags}&limite=1000`)
        : meta;
      const movsRecentes = [...(ultResp.caixa || [])].reverse();

      let entMes = 0, saiMes = 0, countEntMes = 0, countSaiMes = 0;
      let entHoje = 0, saiHoje = 0;
      const hoje = agora.toISOString().slice(0, 10);

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

      const mesAnt = agora.getMonth() === 0
        ? `${agora.getFullYear()-1}-12`
        : `${agora.getFullYear()}-${String(agora.getMonth()).padStart(2,'0')}`;
      let entMesAnt = 0, saiMesAnt = 0;

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
      for (const m of movsRecentes) {
        const anoM = (m.data || '').slice(0, 7);
        if (anoM === mesAnt) {
          entMesAnt += parseFloat(m.entrada) || 0;
          saiMesAnt += parseFloat(m.saida)   || 0;
        }
      }

      const diasOrdenados = Object.keys(porDia).sort().slice(-30);

      res.json({
        mesLabel, anoMes,
        totalRegistros,
        entMes, saiMes, saldoMes: entMes - saiMes,
        countEntMes, countSaiMes,
        entHoje, saiHoje,
        entMesAnt, saiMesAnt,
        varEntradas: entMesAnt > 0 ? ((entMes - entMesAnt) / entMesAnt * 100).toFixed(1) : null,
        grafico: diasOrdenados.map(d => ({
          dia: d.slice(5),
          ent: porDia[d].ent,
          sai: porDia[d].sai,
        })),
        ultimos: movsRecentes.slice(0, 10),
      });
    } catch(e) {
      if (e.response?.status === 404) return res.json({ entMes: 0, saiMes: 0, saldoMes: 0, countEntMes: 0, grafico: [], ultimos: [] });
      res.status(500).json({ error: e.response?.data?.mensagem || e.message });
    }
  });

  app.get('/admin/mk/titulos', requireAdmin, async (req, res) => {
    try {
      const { pagina = 1, limite = 100, status = '' } = req.query;
      const filtroStatus = status ? `&status=${status}` : '';
      const data = await mkGet(`titulo/listar/pagina=${pagina}${filtroStatus}&limite=${limite}`);
      res.json(data);
    } catch(e) {
      if (e.response?.status === 404) return res.json({ titulos: [], total_registros: 0, total_paginas: 1 });
      res.status(500).json({ error: e.response?.data?.mensagem || e.message });
    }
  });

  app.get('/admin/mk/clientes', requireAdmin, async (req, res) => {
    const vazio = { clientes: [], total_registros: 0, total_paginas: 1 };
    async function mkGetSafe(p) {
      try { return await mkGet(p); }
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
      const urlLogin = `cliente/listar/pagina=${pagina}/login=${encodeURIComponent(busca)}`;
      console.log('[MK busca] tentando:', urlLogin);
      const porLogin = await mkGetSafe(urlLogin);
      if (porLogin.clientes && porLogin.clientes.length) return res.json(porLogin);

      const urlNome = `cliente/listar/pagina=${pagina}/nome=${encodeURIComponent(busca)}`;
      console.log('[MK busca] fallback:', urlNome);
      const porNome = await mkGetSafe(urlNome);
      if (porNome.clientes && porNome.clientes.length) return res.json(porNome);

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

  app.get('/admin/mk/chamados', requireAdmin, async (req, res) => {
    try {
      const { pagina = 1, status = '' } = req.query;
      const p = status ? `chamado/listar/pagina=${pagina}/status=${status}` : `chamado/listar/pagina=${pagina}`;
      const data = await mkGet(p);
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

  // ── Limpeza de títulos ─────────────────────────────────────────────────────

  app.get('/admin/mk/titulos/limpeza/preview', requireAdmin, async (req, res) => {
    const { ateAno = 2022, status = 'aberto' } = req.query;
    const limite = 500;
    const encontrados = [];
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

  app.delete('/admin/mk/titulos/limpeza', requireAdmin, async (req, res) => {
    const { confirmar, ateAno = 2022, status = 'aberto' } = req.body || {};
    if (confirmar !== 'CONFIRMAR') return res.status(400).json({ error: 'Confirmação inválida.' });

    const limite = 500;
    let deletados = 0, erros = 0;
    const logErros = [];
    const statusList = status === 'ambos' ? ['aberto', 'vencido'] : [status];

    try {
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
}

module.exports = { registerAdminRoutes };
