'use strict';
const { requireAdmin } = require('../lib/auth');
const { sqliteDb } = require('../lib/database');
const {
  PORTAL_URL,
  getTemplate,
  renderTemplate,
  getNomeCliente,
  enviarZapCliente,
  enviarBoasVindas,
  enviarApresentacaoClube,
} = require('../lib/whatsapp');

function registerAdminNotifRoutes(app) {
  // ── Templates ──────────────────────────────────────────────────────────────

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

  // ── Envio Manual ───────────────────────────────────────────────────────────

  app.post('/admin/notif/enviar', requireAdmin, async (req, res) => {
    const { login, mensagem } = req.body;
    if (!login || !mensagem) return res.status(400).json({ error: 'login e mensagem são obrigatórios' });
    const nome = await getNomeCliente(login);
    const msg  = renderTemplate(mensagem, { nome, login, portal_url: PORTAL_URL });
    const ok   = await enviarZapCliente(login, msg);
    res.json({ ok, mensagem: msg, nome });
  });

  app.post('/admin/notif/boas-vindas/:login', requireAdmin, async (req, res) => {
    const { login } = req.params;
    try {
      const nome = await getNomeCliente(login);
      await enviarBoasVindas(login, nome);
      setTimeout(() => enviarApresentacaoClube(login, nome), 5000);
      res.json({ ok: true, nome });
    } catch (e) {
      res.status(500).json({ error: e.response?.data?.mensagem || e.message });
    }
  });

  app.post('/admin/notif/disparo-massa', requireAdmin, async (req, res) => {
    const { template, logins, apenasNaoNotificados = true } = req.body;
    if (!template) return res.status(400).json({ error: 'template obrigatório' });

    const tpl = getTemplate(template);
    if (!tpl || !tpl.ativo) return res.status(404).json({ error: 'Template não encontrado ou inativo' });

    let alvo = [];
    if (Array.isArray(logins) && logins.length) {
      alvo = logins.map(String).filter(Boolean);
    } else if (apenasNaoNotificados) {
      // Filtra clientes que nunca receberam ESTE template específico
      const jaReceberam = new Set(
        sqliteDb.prepare(`SELECT DISTINCT login FROM notifications WHERE tipo = ?`).all(template).map(r => r.login)
      );
      alvo = sqliteDb.prepare(`SELECT login FROM clients`).all()
        .map(r => r.login)
        .filter(l => !jaReceberam.has(l));
    } else {
      alvo = sqliteDb.prepare(`SELECT login FROM clients`).all().map(r => r.login);
    }

    res.json({ ok: true, total: alvo.length, mensagem: `Disparando para ${alvo.length} cliente(s)...` });

    // Roda em background; registra resultado detalhado no log
    (async () => {
      let enviados = 0, erros = 0;
      for (const login of alvo) {
        try {
          const nome = await getNomeCliente(login);
          const msg  = renderTemplate(tpl.mensagem, { nome, login, portal_url: PORTAL_URL });
          const ok   = await enviarZapCliente(login, msg);
          if (ok) enviados++; else erros++;
        } catch (e) {
          erros++;
          console.warn(`[Disparo] Erro para ${login}:`, e.message);
        }
        await new Promise(r => setTimeout(r, 500));
      }
      console.log(`[Disparo] "${template}" — total: ${alvo.length} | enviados: ${enviados} | erros: ${erros}`);
    })();
  });

  // ── Histórico ──────────────────────────────────────────────────────────────

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
    const total    = sqliteDb.prepare(`SELECT COUNT(*) as n FROM notifications`).get().n;
    const enviados = sqliteDb.prepare(`SELECT COUNT(*) as n FROM notifications WHERE status='sent'`).get().n;
    const erros    = sqliteDb.prepare(`SELECT COUNT(*) as n FROM notifications WHERE status='error'`).get().n;
    const hoje     = sqliteDb.prepare(`SELECT COUNT(*) as n FROM notifications WHERE DATE(created_at)=DATE('now')`).get().n;
    const clientes = sqliteDb.prepare(`SELECT COUNT(DISTINCT login) as n FROM notifications`).get().n;
    res.json({ total, enviados, erros, hoje, clientes });
  });
}

module.exports = { registerAdminNotifRoutes };
