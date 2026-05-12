'use strict';
const axios = require('axios');
const { requireAuth } = require('../lib/auth');
const config = require('../lib/config');
const { getJWT, mkGet } = require('../lib/mk-api');
const { sqliteDb } = require('../lib/database');
const {
  MISSIONS,
  LEVELS,
  getLevel,
  getClientData,
  addPoints,
  saveClient,
} = require('../lib/clube');
const {
  reconciliarPendenteDescontoClube,
  normalizarClubFaturaDesconto,
  tipoResgateEhDescontoNaFatura,
  faturaDescontoTipoPercent,
  tituloAlvoDescontoClubeCompleto,
} = require('../lib/clube-fatura-desconto');
const { notificarResgate } = require('../lib/whatsapp');

const { MK_URL } = config;

const RESGATES = {
  // ── Básico ──────────────────────────────────────────────────────────
  desconto:           { pontos: 100,  label: 'Desconto 10% na fatura',         assunto: 'Financeiro' },
  desconto_20:        { pontos: 200,  label: 'Desconto 20% na fatura',         assunto: 'Financeiro' },
  desconto_30:        { pontos: 300,  label: 'Desconto 30% na fatura',         assunto: 'Financeiro' },
  desconto_40:        { pontos: 400,  label: 'Desconto 40% na fatura',         assunto: 'Financeiro' },
  desconto_50:        { pontos: 500,  label: 'Desconto 50% na fatura',         assunto: 'Financeiro' },
  desconto_80:        { pontos: 800,  label: 'Desconto 80% na fatura',         assunto: 'Financeiro' },
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
  desconto_100:       { pontos: 1000, label: 'Desconto 100% na fatura',       assunto: 'Financeiro' },
  plano_up_60d:       { pontos: 1300, label: 'Plano superior por 60 dias',    assunto: 'Comercial'  },
  dois_meses:         { pontos: 1500, label: '2 meses grátis',                assunto: 'Financeiro' },
  tres_meses:         { pontos: 1800, label: '3 meses grátis',                assunto: 'Financeiro' },
  cliente_vip:        { pontos: 2000, label: 'Status Cliente VIP 12 meses',   assunto: 'Comercial'  },
};

function registerClubeRoutes(app) {
  // ── Stats ──────────────────────────────────────────────────────────────────

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
        ? (() => {
            const dv = cfd.pendente.titulo_alvo_datavenc || null;
            const uuid = cfd.pendente.titulo_uuid_alvo || null;
            let faturaAlvoVencida = false;
            if (uuid && dv) {
              const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
              const dvDate = new Date(dv); dvDate.setHours(0, 0, 0, 0);
              faturaAlvoVencida = dvDate < hoje;
            }
            return {
              percent:                   cfd.pendente.percent,
              label:                     cfd.pendente.label,
              titulo_uuid_alvo:          uuid,
              titulo_alvo_datavenc:      dv,
              titulo_alvo_referencia:    cfd.pendente.titulo_alvo_referencia || null,
              desde:                     cfd.pendente.desde || null,
              aplicado:                  cfd.pendente.aplicado === true,
              // aplicavel = tem fatura alvo vinculada, não venceu, e ainda não foi aplicado
              aplicavel: !!(uuid && !faturaAlvoVencida && !cfd.pendente.aplicado),
              faturaAlvoVencida,
            };
          })()
        : null,
      faturaDescontoAplicados: (cfd.aplicados || []).slice(-20).reverse().map((a) => ({
        tituloUuid: a.tituloUuid,
        percent: a.percent,
        label: a.label,
        valor_desconto: a.valor_desconto,
        valor_pago: a.valor_pago,
        data: a.data,
      })),
    });
  });

  // ── Sincronizar ────────────────────────────────────────────────────────────

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
          addPoints(db, login, 50, 'pagamento', `Fatura ${mainId} paga em dia`);
          ids.forEach(id => { if (!c.awardedInvoices.includes(id)) c.awardedInvoices.push(id); });
          novos++;
        }
      }

      c.streak = c.awardedInvoices.length;

      function autoMission(id, tipo = 'missao') {
        const m = MISSIONS[id];
        if (!m || c.completedMissions.includes(id)) return;
        addPoints(db, login, m.pts, tipo, `🎯 Missão: ${m.label}`);
        c.completedMissions.push(id);
        novos++;
      }

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

      const totalRef = (c.referrals || []).length;
      if (totalRef >= 1)  autoMission('indicar_1',  'indicacao');
      if (totalRef >= 2)  autoMission('indicar_2',  'indicacao');
      if (totalRef >= 3)  autoMission('indicar_3',  'indicacao');
      if (totalRef >= 5)  autoMission('indicar_5',  'indicacao');
      if (totalRef >= 7)  autoMission('indicar_7',  'indicacao');
      if (totalRef >= 10) autoMission('indicar_10', 'indicacao');
      if (totalRef >= 15) autoMission('indicar_15', 'indicacao');
      if (totalRef >= 20) autoMission('indicar_20', 'indicacao');

      const totalMissoes  = (c.completedMissions || []).length;
      const totalResgates = (c.redeemed        || []).length;
      if (totalMissoes  >= 5)  autoMission('missoes_5',   'conquista');
      if (totalMissoes  >= 10) autoMission('missoes_10',  'conquista');
      if (totalMissoes  >= 15) autoMission('missoes_15',  'conquista');
      if (totalMissoes  >= 20) autoMission('missoes_20',  'conquista');
      if (totalResgates >= 1)  autoMission('resgatar_1',  'conquista');
      if (totalResgates >= 3)  autoMission('colecionador', 'conquista');

      if (c.totalEarned >= 500)  autoMission('clube_prata',    'conquista');
      if (c.totalEarned >= 1500) autoMission('clube_ouro',     'conquista');
      if (c.totalEarned >= 3000) autoMission('clube_diamante', 'conquista');

      if (novos > 0) saveClient(login, c);
      res.json({ novos, pontos: c.points, totalEarned: c.totalEarned, streak: c.streak });
    } catch (err) {
      res.json({ novos: 0, pontos: 0, erro: true });
    }
  });

  // ── Speedtest registrar ────────────────────────────────────────────────────

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
    c.speedtests = c.speedtests.slice(-100);

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

    if (resultado.planSpeed > 0) {
      const ratio = resultado.dl / resultado.planSpeed;
      if (ratio >= 0.9) autoST('speedtest_excelente');
      if (ratio >= 1.0) autoST('speedtest_100');
    }

    saveClient(login, c);
    res.json({
      success: true,
      pontos: c.points,
      missoesConcluidas: c.completedMissions,
      totalTestes: total,
    });
  });

  // ── Visita (missões de navegação) ──────────────────────────────────────────

  app.post('/portal/visita', requireAuth, (req, res) => {
    const { secao } = req.body;
    const login = req.session.cliente.login;

    const secaoMissao = {
      faturas:     'ver_fatura',
      conexao:     'ver_conexao',
      velocidade:  'ver_velocidade_sec',
      perfil:      'ver_perfil_sec',
      suporte:     'ver_suporte_sec',
      indicacoes:  'ver_clube',
      desafios:    'ver_desafios',
      historico:   'ver_historico',
      dashboard:   null,
    };

    const missaoId = secaoMissao[secao];
    if (!missaoId) return res.json({ ok: true });

    const db = getClientData(login);
    const c  = db[login];

    if (!c.visitedSections.includes(secao)) {
      c.visitedSections.push(secao);
    }

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

    const EXPLORER_SECS = ['faturas','suporte','conexao','velocidade','indicacoes','perfil'];
    if (EXPLORER_SECS.every(s => c.visitedSections.includes(s))) {
      const mEx = MISSIONS['explorador'];
      if (mEx && !(c.completedMissions || []).includes('explorador')) {
        addPoints(db, login, mEx.pts, 'missao', `🎯 Missão: ${mEx.label}`);
        c.completedMissions.push('explorador');
      }
    }

    saveClient(login, c);
    res.json({
      ok: true,
      missao: missaoId,
      novosPts,
      label,
      pontos: c.points,
      jaCompleta: novosPts === 0,
    });
  });

  // ── Missão manual ──────────────────────────────────────────────────────────

  app.post('/portal/clube/missao', requireAuth, async (req, res) => {
    const { tipo } = req.body;
    const login = req.session.cliente.login;

    const m = MISSIONS[tipo];
    if (!m || m.auto) return res.json({ jaCompleta: true, pontos: 0 });

    const db = getClientData(login);
    const c  = db[login];

    if ((c.completedMissions || []).includes(tipo)) {
      return res.json({ jaCompleta: true, pontos: c.points });
    }

    const SPEEDTEST_MISSIONS = ['speedtest','speedtest_3x','speedtest_5x','speedtest_10x',
                                 'speedtest_manha','speedtest_noite','speedtest_100','speedtest_excelente','speedtest_semana'];
    if (SPEEDTEST_MISSIONS.includes(tipo)) {
      if (c.speedtests.length === 0) {
        return res.status(400).json({ error: 'Complete um teste de velocidade real primeiro.' });
      }
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

    if (tipo === 'login_3x') {
      if ((c.loginHistory || []).length < 3) {
        return res.status(400).json({ error: 'Faça login pelo menos 3 vezes.' });
      }
    }

    if (tipo === 'uso_semanal') {
      const diasLogin = [...new Set((c.loginHistory || []).map(l => l.data))];
      if (diasLogin.length < 3) {
        return res.status(400).json({ error: 'Acesse o portal em pelo menos 3 dias diferentes.' });
      }
    }

    if (tipo === 'acesso_noturno') {
      const temNoturno = (c.loginHistory || []).some(l => l.hora >= 22);
      if (!temNoturno) {
        return res.status(400).json({ error: 'Nenhum acesso noturno (após 22h) registrado.' });
      }
    }

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

    if (tipo === 'primeiro_login') {
      if ((c.loginHistory || []).length < 1) {
        return res.status(400).json({ error: 'Nenhum login registrado.' });
      }
    }

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

    if (tipo === 'ativar_notif') {
      const sub = sqliteDb.prepare('SELECT 1 FROM push_subscriptions WHERE login = ?').get(login);
      if (!sub) {
        return res.status(400).json({ error: 'Ative as notificações push primeiro.' });
      }
    }

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

    addPoints(db, login, m.pts, 'missao', `🎯 Missão: ${m.label}`);
    c.completedMissions.push(tipo);
    saveClient(login, c);

    res.json({ success: true, pts: m.pts, pontos: c.points, label: m.label });
  });

  // ── Resgatar ───────────────────────────────────────────────────────────────

  app.post('/portal/clube/resgatar', requireAuth, async (req, res) => {
    const { tipo } = req.body;
    const login = req.session.cliente.login;
    const nome  = req.session.cliente.nome;
    const email = req.session.cliente.email || '';

    const opcao = RESGATES[tipo];
    if (!opcao) return res.status(400).json({ error: 'Tipo de resgate inválido.' });

    const db = getClientData(login);
    const c  = db[login];
    if ((c.points || 0) < opcao.pontos) {
      return res.status(400).json({ error: `Você precisa de ${opcao.pontos} pontos para este resgate.` });
    }

    const isDescontoFatura = tipoResgateEhDescontoNaFatura(tipo);
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
      // Sem fatura em aberto: permite resgate, o cupom fica "sem alvo" até a regularização
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
        const pct = faturaDescontoTipoPercent(tipo);
        c.clubFaturaDesconto = normalizarClubFaturaDesconto(c.clubFaturaDesconto);
        c.clubFaturaDesconto = {
          pendente: {
            percent: pct,
            tipo,
            label: opcao.label,
            desde: new Date().toISOString(),
            // null quando cliente não tem fatura em aberto no momento do resgate;
            // a reconciliação vinculará automaticamente quando uma fatura aparecer
            titulo_uuid_alvo: tituloAlvoMeta?.uuid || null,
            titulo_alvo_datavenc: tituloAlvoMeta?.datavenc || null,
            titulo_alvo_referencia: tituloAlvoMeta?.referencia || null,
          },
          aplicados: c.clubFaturaDesconto.aplicados || [],
        };
      }

      saveClient(login, c);

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

  // ── Aplicar cupom na fatura (ação explícita do cliente) ────────────────────

  app.post('/portal/clube/cupom/aplicar', requireAuth, async (req, res) => {
    const login = req.session.cliente.login;
    const db = getClientData(login);
    const c  = db[login];
    const cfd = normalizarClubFaturaDesconto(c.clubFaturaDesconto);

    if (!cfd.pendente) {
      return res.status(400).json({ error: 'Nenhum cupom pendente para aplicar.' });
    }
    if (!cfd.pendente.titulo_uuid_alvo) {
      return res.status(400).json({
        error: 'Cupom sem fatura alvo. Regularize seus pagamentos para ativar o cupom.',
      });
    }
    // Verifica se a fatura alvo ainda não venceu
    const dv = cfd.pendente.titulo_alvo_datavenc;
    if (dv) {
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const dvDate = new Date(dv); dvDate.setHours(0, 0, 0, 0);
      if (dvDate < hoje) {
        return res.status(400).json({
          error: 'A fatura alvo deste cupom já venceu. Aguarde a reconciliação automática com uma nova fatura em aberto.',
        });
      }
    }

    cfd.pendente.aplicado = true;
    c.clubFaturaDesconto = cfd;
    saveClient(login, c);

    res.json({ ok: true, titulo_uuid_alvo: cfd.pendente.titulo_uuid_alvo });
  });
}

module.exports = { registerClubeRoutes, RESGATES };
