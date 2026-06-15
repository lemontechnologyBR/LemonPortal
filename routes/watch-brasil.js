/**
 * Rotas Watch Brasil — portal cliente + admin (token).
 */

const axios = require('axios');
const watch = require('../lib/watch-brasil');
const watchPacotes = require('../lib/watch-pacotes');
const { MK_URL } = require('../lib/config');
const { getJWT } = require('../lib/mk-api');

/** Preenche session.cliente.plano a partir do MK (login antigo ou campo novo). */
async function enrichPlanoSessaoSeFaltar(req) {
  const c = req.session?.cliente;
  if (!c?.login || String(c.plano || '').trim()) return;
  if (!MK_URL) return;
  try {
    const token = await getJWT();
    const r = await axios.get(`${MK_URL}/cliente/show/${encodeURIComponent(c.login)}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 12_000,
      validateStatus: () => true,
    });
    if (r.status >= 400 || !r.data) return;
    const d = r.data;
    const p = d.plano || d.plano_nome || d.nome_plano || '';
    if (p) req.session.cliente.plano = String(p);
  } catch {
    /* silencioso */
  }
}

function registerWatchBrasilRoutes(app, { requireAuth, requireAdmin }) {
  const codeExchangeSecret = String(process.env.WATCH_CODE_EXCHANGE_SECRET || '').trim();

  /**
   * Troca code → token sem sessão admin (ex.: n8n após WATCH_REDIRECT_URI apontar para o webhook).
   * Header: X-Watch-Code-Secret: <WATCH_CODE_EXCHANGE_SECRET>
   * Body JSON: { "code": "..." }
   */
  if (codeExchangeSecret) {
    app.post('/portal/watch/oauth/exchange-code', async (req, res) => {
      const hdr = String(req.get('x-watch-code-secret') || '').trim();
      if (hdr !== codeExchangeSecret) {
        return res.status(401).json({ error: 'Segredo inválido ou ausente.' });
      }
      const code = String(req.body?.code || req.query?.code || '').trim();
      if (!code) return res.status(400).json({ error: 'code obrigatório no body JSON.' });
      try {
        await watch.exchangeCodeForToken(code);
        return res.json({ ok: true });
      } catch (e) {
        return res.status(502).json({ error: String(e.message || e) });
      }
    });

    /** Grava access_token na SQLite do portal (ex.: n8n já trocou o code na Watch). Mesmo header que exchange-code. */
    app.post('/portal/watch/oauth/save-token', async (req, res) => {
      const hdr = String(req.get('x-watch-code-secret') || '').trim();
      if (hdr !== codeExchangeSecret) {
        return res.status(401).json({ error: 'Segredo inválido ou ausente.' });
      }
      const accessToken = String(req.body?.accessToken || req.body?.token || '').trim();
      if (!accessToken) return res.status(400).json({ error: 'accessToken obrigatório no body JSON.' });
      try {
        watch.saveToken(accessToken, { manual: true, source: 'n8n_save_token' });
        return res.json({ ok: true });
      } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
      }
    });
  }

  /** Callback OAuth (público): a Watch redireciona aqui com ?code= */
  app.get('/portal/watch/oauth/callback', async (req, res) => {
    const err = req.query.error;
    if (err) {
      const desc = String(req.query.error_description || req.query.error_uri || '').trim();
      return res.status(400).type('text/plain; charset=utf-8').send(
        `OAuth Watch recusado: ${String(err)}${desc ? ` — ${desc}` : ''}`
      );
    }
    const code = req.query.code;
    if (!code) {
      return res.status(400).type('text/plain; charset=utf-8')
        .send('Parâmetro code ausente. Fluxo OAuth incompleto.');
    }
    try {
      await watch.exchangeCodeForToken(String(code));
      return res.redirect('/admin?watch=ok');
    } catch (e) {
      const msg = e.response?.data ? JSON.stringify(e.response.data) : String(e.message || e);
      return res.status(500).type('text/plain; charset=utf-8').send(`Erro ao obter token Watch: ${msg}`);
    }
  });

  app.get('/admin/watch/config', requireAdmin, (req, res) => {
    res.json({ ...watch.getPublicConfig(), tokenStatus: watch.getTokenStatus() });
  });

  /** Grava token manualmente (ex.: colado do Postman). Body: { "accessToken": "..." } */
  app.post('/admin/watch/token', requireAdmin, (req, res) => {
    const accessToken = String(req.body?.accessToken || req.body?.token || '').trim();
    if (!accessToken) return res.status(400).json({ error: 'accessToken obrigatório.' });
    try {
      watch.saveToken(accessToken, { manual: true });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /** Página HTML que faz POST para a Watch (auth_uri) — abrir logado no admin. */
  app.get('/admin/watch/oauth-form', requireAdmin, (req, res) => {
    if (!watch.isEnabled()) {
      return res.status(503).type('text/html; charset=utf-8')
        .send('<p>Watch desabilitado: defina WATCH_CLIENT_ID e WATCH_CLIENT_SECRET no .env (ou WATCH_CLIENT_SECRET_JSON).</p>');
    }
    const clientId = watch.oauthClientId();
    if (!clientId) {
      return res.status(503).type('text/html; charset=utf-8')
        .send('<p>Watch: client_id ausente. Defina WATCH_CLIENT_ID ou WATCH_CLIENT_SECRET_JSON.</p>');
    }
    const redir = watch.redirectUri();
    const authUri = watch.authUriResolved();
    const uid = String(req.query.uid || clientId || 'lemon-portal').slice(0, 120);

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Watch — autorizar</title></head>
<body>
<p>A redirecionar para a Watch Brasil…</p>
<form id="f" method="POST" action="${escapeHtml(authUri)}">
  <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
  <input type="hidden" name="redirect_url" value="${escapeHtml(redir)}">
  <input type="hidden" name="approval_prompt" value="auto">
  <input type="hidden" name="uid" value="${escapeHtml(uid)}">
</form>
<script>document.getElementById('f').submit();</script>
</body></html>`;
    res.type('text/html; charset=utf-8').send(html);
  });

  /** Cliente: indica se a integração está pronta no servidor (sem dados sensíveis). */
  app.get('/portal/watch/status', requireAuth, async (req, res) => {
    if (!watch.isEnabled()) {
      return res.json({ ok: false, reason: 'disabled' });
    }
    await enrichPlanoSessaoSeFaltar(req);
    const token = await watch.getValidAccessToken();
    const has = !!token;
    const pacoteId = watch.pacoteParaCliente(req.session.cliente);
    const pacoteOk = !!pacoteId;
    res.json({
      ok: has && pacoteOk,
      hasToken: has,
      pacoteResolvido: pacoteId || null,
      planoMk: String(req.session.cliente?.plano || ''),
      pacoteConfigured: pacoteOk,
    });
  });

  /** Catálogo de IDs (referência) + pacote resolvido para o cliente logado. */
  app.get('/portal/watch/catalogo', requireAuth, (req, res) => {
    res.json({
      pacotes: watchPacotes.listarPacotes(),
      planoMk: String(req.session.cliente?.plano || ''),
      pacoteResolvido: watch.pacoteParaCliente(req.session.cliente) || null,
    });
  });

  // ── Admin Watch API ──────────────────────────────────────────

  app.get('/admin/watch/pacotes', requireAdmin, async (req, res) => {
    try {
      const data = await watch.getPacotes(req.query.pPacote || '');
      res.json({ ok: true, data });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.get('/admin/watch/pacotes-all', requireAdmin, async (req, res) => {
    try {
      const ids = watchPacotes.listarPacotes().map(p => p.id);
      const results = await Promise.all(ids.map(id =>
        watch.getPacotes(id).then(d => {
          const list = d?.Result?.list || d?.result?.list || [];
          return list[0] || null;
        }).catch(() => null)
      ));
      res.json({ ok: true, data: results.filter(Boolean) });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.get('/admin/watch/ticket', requireAdmin, async (req, res) => {
    try {
      const data = await watch.getTicket({
        pPacote: req.query.pPacote || '',
        pAssinanteIDIntegracao: req.query.pAssinanteIDIntegracao || '',
        pEmailUsuario: req.query.pEmailUsuario || '',
      });
      res.json({ ok: true, data });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.post('/admin/watch/insert', requireAdmin, async (req, res) => {
    try {
      const data = await watch.insertTicket(req.body);
      res.json({ ok: true, data });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.post('/admin/watch/delete', requireAdmin, async (req, res) => {
    try {
      const data = await watch.deleteTicket(req.body.pTicket);
      res.json({ ok: true, data });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.post('/admin/watch/edit-phone', requireAdmin, async (req, res) => {
    try {
      const data = await watch.editPhone(req.body);
      res.json({ ok: true, data });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.post('/admin/watch/edit-email', requireAdmin, async (req, res) => {
    try {
      const data = await watch.editEmail(req.body);
      res.json({ ok: true, data });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.post('/admin/watch/resend-email', requireAdmin, async (req, res) => {
    try {
      const data = await watch.resendEmail(req.body.pTicket);
      res.json({ ok: true, data });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.post('/admin/watch/update-status', requireAdmin, async (req, res) => {
    try {
      const data = await watch.updateTicketStatus(req.body);
      res.json({ ok: true, data });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  /** Cliente: ativa Watch Free sozinho. */
  app.post('/portal/watch/ativar-free', requireAuth, async (req, res) => {
    if (!watch.isEnabled()) {
      return res.status(503).json({ error: 'Watch Brasil não configurado no servidor.' });
    }
    const cliente = req.session.cliente;
    const email = String(cliente.email || '').trim();
    const login = String(cliente.login || '').trim();
    if (!email) return res.status(400).json({ error: 'Seu cadastro não possui e-mail. Atualize seu perfil.' });
    if (!login) return res.status(400).json({ error: 'Login não encontrado na sessão.' });

    const WATCH_FREE_ID = '36887';

    try {
      const existing = await watch.getTicket({ pPacote: WATCH_FREE_ID, pAssinanteIDIntegracao: login, pEmailUsuario: email });
      const result = existing?.Result || existing?.result || existing;
      const list = Array.isArray(result) ? result : (result?.list || []);
      const ativo = list.find(t => t.Status === true || t.Status === 'true');
      if (ativo) {
        return res.json({ ok: true, jaAtivo: true, data: existing });
      }
    } catch { /* sem ticket, ok prosseguir */ }

    let phone = '';
    if (MK_URL) {
      try {
        const token = await getJWT();
        const r = await axios.get(`${MK_URL}/cliente/show/${encodeURIComponent(login)}`, {
          headers: { Authorization: `Bearer ${token}` }, timeout: 12_000, validateStatus: () => true,
        });
        if (r.data) {
          phone = String(r.data.fone || r.data.telefone || r.data.celular || r.data.cel || '').trim();
        }
      } catch { /* sem telefone, ok */ }
    }

    try {
      const data = await watch.insertTicket({
        pEmail: email,
        pAssinanteIDIntegracao: login,
        pPacote: WATCH_FREE_ID,
        pPhone: phone,
      });
      console.log('[Watch] ✅ Watch Free ativado para %s (%s)', login, email);
      res.json({ ok: true, data });
    } catch (e) {
      console.log('[Watch] ❌ Erro ao ativar Watch Free para %s: %s', login, e.message);
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  /** Cliente: consulta ticket na Watch (email + ID integração = login MK). */
  app.get('/portal/watch/ticket', requireAuth, async (req, res) => {
    if (!watch.isEnabled()) {
      return res.status(503).json({ error: 'Watch Brasil não configurado no servidor.' });
    }
    await enrichPlanoSessaoSeFaltar(req);
    const cliente = req.session.cliente;
    const pacote = watch.pacoteParaCliente(cliente);
    if (!pacote) {
      return res.status(503).json({
        error:
          'Não foi possível determinar o pacote Watch para o seu plano. Defina WATCH_PACOTE_ID no .env ou ajuste o mapa em lib/watch-pacotes.js / WATCH_PACOTE_MAP_JSON.',
      });
    }
    const email = String(cliente.email || '').trim();
    if (!email) {
      return res.status(400).json({ error: 'Cliente sem e-mail no cadastro. Atualize o perfil.' });
    }
    const pAssinanteIDIntegracao = String(cliente.login || '').trim();
    try {
      const data = await watch.getTicket({
        pPacote: String(pacote),
        pAssinanteIDIntegracao,
        pEmailUsuario: email,
      });
      const pacotesMap = {};
      watchPacotes.listarPacotes().forEach(p => { pacotesMap[String(p.id)] = p.nome; });
      res.json({ ok: true, data, pacotesMap });
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { registerWatchBrasilRoutes };
