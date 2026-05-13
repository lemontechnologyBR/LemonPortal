'use strict';
const axios = require('axios');
const { requireAuth } = require('../lib/auth');
const config = require('../lib/config');
const { getJWT } = require('../lib/mk-api');
const { enrichClienteComVelocidadePlano } = require('../lib/plano-match');
const pushLib = require('../lib/push');
const { mergePrefs, getPrefsForLogin } = require('../lib/push-notif-prefs');
const { sqliteDb } = require('../lib/database');
const {
  enriquecerListaFaturasClubePosReconciliar,
  enriquecerTituloComDescontoClubePosReconciliar,
  garantirUuidTituloPayload,
  reconciliarPendenteDescontoClube,
} = require('../lib/clube-fatura-desconto');
const { getMikrotikConexao } = require('../lib/mikrotik');
const { aplicarJurosAtrasoListaBody, aplicarJurosAtrasoTitulo } = require('../lib/juros-atraso-fatura');
const { getClientData, saveClient, awardPoints } = require('../lib/clube');
const {
  readPortalAvisosDb,
  sanitizePortalAvisoItem,
} = require('../lib/portal-avisos');
const { readSplashLoadingMensagensPublic } = require('../lib/splash-loading-msgs');
const {
  isPrimeiroLogin,
  enviarBoasVindas,
  enviarApresentacaoClube,
  notificarCadastro,
} = require('../lib/whatsapp');

const { MK_URL } = config;

function registerPortalRoutes(app) {
  // ── Auth ───────────────────────────────────────────────────────────────────

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

      const db = getClientData(cliente.login);
      const c  = db[cliente.login];
      const now = new Date();
      const isFirst = isPrimeiroLogin(cliente.login);
      c.loginHistory.push({
        ts:   now.toISOString(),
        hora: now.getHours(),
        data: now.toDateString(),
      });
      c.loginHistory = c.loginHistory.slice(-100);
      saveClient(cliente.login, c);

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

  app.post('/portal/logout', (req, res) => {
    req.session.destroy(err => {
      if (err) console.warn('[Logout] Erro ao destruir sessão:', err.message);
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });

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

  // ── Perfil ─────────────────────────────────────────────────────────────────

  app.put('/portal/perfil', requireAuth, async (req, res) => {
    const { email, telefone, celular, endereco, numero, bairro, cidade, estado, cep, complemento } = req.body;
    const cliente = req.session.cliente;

    try {
      const token = await getJWT();
      const editRes = await axios.put(`${MK_URL}/cliente/editar`, {
        uuid: cliente.uuid,
        email, telefone, celular, endereco, numero, bairro, cidade, estado, cep, complemento
      }, { headers: { Authorization: `Bearer ${token}` } });

      const body = editRes.data;
      if (body?.error) throw new Error(body.error?.text || 'Permissão negada');

      return res.json({ success: true, modo: 'direto' });
    } catch (errEdit) {
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

  // ── Faturas ────────────────────────────────────────────────────────────────

  app.get('/portal/faturas/abertas', requireAuth, async (req, res) => {
    try {
      const token = await getJWT();
      const cpf = req.session.cliente.cpf_cnpj || req.session.cliente.login;
      const r = await axios.get(`${MK_URL}/titulo/aberto/${cpf}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const login = req.session.cliente.login;
      const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
      let body = aplicarJurosAtrasoListaBody(r.data);
      body = await enriquecerListaFaturasClubePosReconciliar(
        body, login,
        cpfLimpo.length >= 11 ? cpfLimpo : '',
        require('../lib/mk-api').mkGet,
      );
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao buscar faturas abertas.' });
    }
  });

  app.get('/portal/faturas/vencidas', requireAuth, async (req, res) => {
    try {
      const token = await getJWT();
      const cpf = req.session.cliente.cpf_cnpj || req.session.cliente.login;
      const r = await axios.get(`${MK_URL}/titulo/vencido/${cpf}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const login = req.session.cliente.login;
      const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
      let body = aplicarJurosAtrasoListaBody(r.data);
      body = await enriquecerListaFaturasClubePosReconciliar(
        body, login,
        cpfLimpo.length >= 11 ? cpfLimpo : '',
        require('../lib/mk-api').mkGet,
      );
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao buscar faturas vencidas.' });
    }
  });

  app.get('/portal/faturas/pagas', requireAuth, async (req, res) => {
    try {
      const token = await getJWT();
      const login = req.session.cliente.login;
      const r = await axios.get(`${MK_URL}/titulo/pago/${login}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
      // Faturas pagas não precisam de cálculo de juros — pulamos aplicarJurosAtrasoListaBody.
      const body = await enriquecerListaFaturasClubePosReconciliar(
        r.data, login,
        cpfLimpo.length >= 11 ? cpfLimpo : '',
        require('../lib/mk-api').mkGet,
      );
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao buscar histórico de faturas.' });
    }
  });

  app.get('/portal/faturas/:uuid', requireAuth, async (req, res) => {
    try {
      const token = await getJWT();
      const urlTitulo = String(req.params.uuid || '').trim();
      const r = await axios.get(`${MK_URL}/titulo/show/${encodeURIComponent(urlTitulo)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const login = req.session.cliente.login;
      const cpfLimpo = String(req.session.cliente.cpf_cnpj || '').replace(/\D/g, '');
      let body = garantirUuidTituloPayload(r.data, urlTitulo);
      body = aplicarJurosAtrasoTitulo(body);
      body = await enriquecerTituloComDescontoClubePosReconciliar(
        body, login,
        cpfLimpo.length >= 11 ? cpfLimpo : '',
        require('../lib/mk-api').mkGet,
      );
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao buscar fatura.' });
    }
  });

  // ── Avisos ─────────────────────────────────────────────────────────────────

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

  /** Mensagens rotativas no splash (loading) — público, sem sessão. */
  app.get('/portal/splash-mensagens', (req, res) => {
    try {
      res.json({ mensagens: readSplashLoadingMensagensPublic() });
    } catch (e) {
      res.status(500).json({ error: 'Erro ao ler mensagens do splash.' });
    }
  });

  // ── Push / Notificações ────────────────────────────────────────────────────

  app.get('/portal/push/public-key', requireAuth, (req, res) => {
    try {
      res.json({ publicKey: pushLib.getPublicVapidKey() });
    } catch (e) {
      res.status(500).json({ error: 'Chave push indisponível.' });
    }
  });

  app.post('/portal/push/subscribe', requireAuth, (req, res) => {
    try {
      const login = req.session.cliente.login;
      pushLib.savePushSubscription(login, req.body, req.get('user-agent'));
      res.json({ success: true });
      // Notificação de boas-vindas (evita iOS exibir "from Lemon" vazio)
      setImmediate(() => {
        const nome = (req.session.cliente.nome || '').split(' ')[0] || 'cliente';
        pushLib.sendPushPayload(
          { endpoint: req.body.endpoint, keys: { p256dh: req.body.keys?.p256dh, auth: req.body.keys?.auth } },
          {
            title: '🍋 Notificações ativadas!',
            body: `Olá, ${nome}! Você receberá avisos de faturas e novidades da Lemon aqui.`,
            url: '/',
            kind: 'boas_vindas',
          }
        ).catch(() => {});
      });
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
      const endpoint = String(req.query.endpoint || '').trim();
      // hasSubscription = verdadeiro somente se ESTE dispositivo (endpoint) está inscrito
      let hasSubscription = false;
      if (endpoint) {
        const row = sqliteDb.prepare(
          'SELECT 1 FROM push_subscriptions WHERE login = ? AND endpoint = ?'
        ).get(login, endpoint);
        hasSubscription = !!row;
      } else {
        // Fallback sem endpoint: verifica se há qualquer subscrição para o login
        const row = sqliteDb.prepare('SELECT COUNT(*) as c FROM push_subscriptions WHERE login = ?').get(login);
        hasSubscription = (row?.c || 0) > 0;
      }
      res.json({ prefs, hasSubscription });
    } catch (e) {
      res.status(500).json({ error: 'Erro ao ler preferências.' });
    }
  });

  app.put('/portal/notificacoes/prefs', requireAuth, (req, res) => {
    try {
      const login = req.session.cliente.login;
      const body = req.body || {};
      const patch = {};
      if (typeof body.faturaVencimento    === 'boolean') patch.faturaVencimento    = body.faturaVencimento;
      if (typeof body.avisosLemon         === 'boolean') patch.avisosLemon         = body.avisosLemon;
      if (typeof body.zapFaturaVencimento === 'boolean') patch.zapFaturaVencimento = body.zapFaturaVencimento;
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'Envie faturaVencimento, avisosLemon e/ou zapFaturaVencimento (boolean).' });
      }
      const db = getClientData(login);
      const c = db[login];
      c.pushNotifPrefs = mergePrefs({ ...mergePrefs(c.pushNotifPrefs), ...patch });
      saveClient(login, c);
      res.json({ prefs: c.pushNotifPrefs });
    } catch (e) {
      res.status(500).json({ error: 'Erro ao gravar preferências.' });
    }
  });

  // ── Chamados ───────────────────────────────────────────────────────────────

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

  // ── Cadastro ───────────────────────────────────────────────────────────────

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

      const msgPlano = plano
        ? `Novo cliente cadastrado via portal.\nPlano solicitado: ${plano}\nAguardando ativação.`
        : `Novo cliente cadastrado via portal.\nAguardando ativação.`;

      const regiao = String(regiao_condominio || '').trim();
      const tipoMoradia = regiao === 'Real Parque' ? 'Condomínio' : 'Casas';
      const msgRegiao = regiao ? `\n\n${tipoMoradia} / região: ${regiao}` : '';
      const endRp = String(endereco_indicado_rp || '').trim();
      const msgEndRp = endRp ? `\n\nEndereço indicado (Real Parque): ${endRp}` : '';
      const msgRef = ref ? `\n\n🎁 Indicado por: ${ref}` : '';

      try {
        await axios.post(`${MK_URL}/chamado/inserir`, {
          login, nome,
          email: email || '',
          assunto: 'Cadastro',
          prioridade: 'normal',
          mensagem: msgPlano + msgRegiao + msgEndRp + msgRef
        }, { headers: { Authorization: `Bearer ${token}` } });
      } catch (_) {}

      if (ref && ref !== login) {
        // Valida que o ref é um login existente no MK-Auth antes de conceder pontos
        const refLimpo = String(ref).trim().slice(0, 64);
        if (refLimpo && /^[a-zA-Z0-9._\-]+$/.test(refLimpo)) {
          setImmediate(async () => {
            try {
              const tkRef = await getJWT();
              await axios.get(`${MK_URL}/cliente/show/${encodeURIComponent(refLimpo)}`, {
                headers: { Authorization: `Bearer ${tkRef}` },
              });
              // Chegou aqui: cliente existe no MK → pontua
              awardPoints(refLimpo, login, nome);
              console.log(`[Indicação] +pts para ${refLimpo} por indicar ${login}`);
            } catch (e) {
              // Cliente não existe ou MK indisponível — não pontua, não quebra o cadastro
              const status = e.response?.status;
              if (status === 404) {
                console.warn(`[Indicação] ref="${refLimpo}" não encontrado no MK-Auth — indicação ignorada`);
              } else {
                console.warn(`[Indicação] Erro ao validar ref="${refLimpo}":`, e.message);
              }
            }
          });
        }
      }

      setImmediate(() => notificarCadastro(login, nome, celular));

      res.json({ success: true });
    } catch (err) {
      const msg = err.response?.data?.mensagem || err.response?.data?.message || 'Erro ao cadastrar. Verifique os dados.';
      res.status(err.response?.status || 500).json({ error: msg });
    }
  });

  // ── Misc ───────────────────────────────────────────────────────────────────

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

  app.get('/portal/session', (req, res) => {
    if (req.session.cliente) {
      res.json({ logado: true, nome: req.session.cliente.nome });
    } else {
      res.json({ logado: false });
    }
  });

  app.get('/portal/conexao', requireAuth, async (req, res) => {
    const login = req.session.cliente.login;
    try {
      const data = await getMikrotikConexao(login);
      res.json(data);
    } catch (err) {
      res.json({ online: false, erro: 'Não foi possível consultar a rede.', detalhe: err.message });
    }
  });
}

module.exports = { registerPortalRoutes };
