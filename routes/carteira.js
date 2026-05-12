'use strict';
const axios = require('axios');
const { requireAuth } = require('../lib/auth');
const config = require('../lib/config');
const { getJWT, mkGet } = require('../lib/mk-api');
const { sqliteDb } = require('../lib/database');
const { mpWalletGetOrCreateCustomer } = require('../lib/mercadopago-wallet');

const {
  MP_TOKEN,
  MP_BASE,
  MK_URL,
  mpChavesMercadoPagoAlinhadas,
  mpAccessTokenEhTeste,
  mpPortalOrigin,
} = config;
const {
  loadClubFaturaDesconto,
  valoresMpPermitidosParaTitulo,
  reconciliarPendenteDescontoClube,
  parseValorTituloMk,
} = require('../lib/clube-fatura-desconto');
const { aplicarJurosAtrasoTitulo } = require('../lib/juros-atraso-fatura');

function _extrairUuidTituloLista(t) {
  if (!t || typeof t !== 'object') return '';
  const pool = [t.uuid, t.dados?.uuid, t.titulo?.uuid, t.gwt_uuid, t.codigo_uuid, t.id, t.dados?.id, t.titulo?.id];
  for (const u of pool) {
    if (u != null && String(u).trim()) return String(u).trim();
  }
  return '';
}

async function _escolherTituloParaDebitoAutomatico(login, cpfLimpo, mkToken) {
  let lista = [];
  try {
    const ab = await axios.get(`${MK_URL}/titulo/aberto/${cpfLimpo}`, {
      headers: { Authorization: `Bearer ${mkToken}` },
    });
    const d = ab.data;
    lista = lista.concat(Array.isArray(d) ? d : d?.titulos || []);
  } catch (_) {}
  try {
    const ve = await axios.get(`${MK_URL}/titulo/vencido/${cpfLimpo}`, {
      headers: { Authorization: `Bearer ${mkToken}` },
    });
    const d = ve.data;
    lista = lista.concat(Array.isArray(d) ? d : d?.titulos || []);
  } catch (_) {}
  lista.sort((a, b) => new Date(a.datavenc || a.dados?.datavenc || 0) - new Date(b.datavenc || b.dados?.datavenc || 0));
  for (const raw of lista) {
    const uuid = _extrairUuidTituloLista(raw);
    if (!uuid) continue;
    let tituloMk;
    try {
      const sr = await axios.get(`${MK_URL}/titulo/show/${encodeURIComponent(uuid)}`, {
        headers: { Authorization: `Bearer ${mkToken}` },
      });
      tituloMk = sr.data;
    } catch {
      continue;
    }
    const loginTitulo = tituloMk?.login ?? tituloMk?.dados?.login;
    if (!loginTitulo || String(loginTitulo).toLowerCase() !== String(login).toLowerCase()) continue;
    return { uuid, tituloMk };
  }
  return null;
}

function registerCarteiraRoutes(app) {
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
      const pmId     = c.payment_method?.id || c.payment_method_id || '';
      const holder   = c.cardholder?.name || c.cardholder_name || '';

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
      const status = e.response?.status;
      if (status !== 404) {
        console.warn('[Carteira] MP delete card:', e.response?.data || e.message);
        if (status >= 500 || !status) {
          return res.status(502).json({ error: 'Não foi possível remover o cartão no Mercado Pago no momento. Tente novamente.' });
        }
      }
    }
    sqliteDb.prepare('DELETE FROM wallet_cards WHERE id = ? AND login = ?').run(localId, login);
    res.json({ ok: true });
  });

  /**
   * Após guardar cartão na carteira: cria assinatura (preapproval) no Mercado Pago com o valor da
   * primeira fatura em aberto/vencida e devolve init_point para o cliente concluir no site do MP.
   */
  app.post('/portal/carteira/debito-automatico', requireAuth, async (req, res) => {
    if (!MP_TOKEN) return res.status(503).json({ error: 'Mercado Pago não configurado no servidor.' });
    if (!mpChavesMercadoPagoAlinhadas()) {
      return res.status(400).json({
        error:
          'Credenciais Mercado Pago incoerentes: use Public Key e Access Token no mesmo modo (sandbox ou produção).',
      });
    }

    const cli = req.session.cliente;
    const login = cli.login;
    const origin = mpPortalOrigin();
    const backUrl = `${origin}/portal`;
    const tokenStr = String(MP_TOKEN || '').trim();
    const isTestToken = tokenStr.startsWith('TEST-');
    if (
      !isTestToken &&
      /^http:\/\//i.test(backUrl) &&
      !/localhost|127\.0\.0\.1/i.test(backUrl)
    ) {
      return res.status(400).json({
        error:
          'Mercado Pago (produção) exige HTTPS no retorno. Defina PORTAL_URL com https:// no .env e reinicie o servidor.',
      });
    }

    try {
      const mkToken = await getJWT();
      const mkCli = await axios.get(`${MK_URL}/cliente/show/${login}`, {
        headers: { Authorization: `Bearer ${mkToken}` },
      });
      const cpfRaw = (mkCli.data.cpf_cnpj || '').replace(/\D/g, '');
      if (!cpfRaw || cpfRaw.length < 11) {
        return res.status(400).json({ error: 'CPF não encontrado no cadastro. Atualize seus dados antes de continuar.' });
      }
      const email = String(mkCli.data.email || cli.email || '').trim();
      if (!email) {
        return res.status(400).json({
          error: 'É necessário um e-mail no cadastro para autorizar débito automático no Mercado Pago.',
        });
      }

      try {
        if (cpfRaw.length >= 11) await reconciliarPendenteDescontoClube(login, cpfRaw, mkGet);
      } catch (_) {}

      const escolhido = await _escolherTituloParaDebitoAutomatico(login, cpfRaw, mkToken);
      if (!escolhido) {
        return res.status(400).json({
          error:
            'Não há fatura em aberto ou vencida para definir o valor mensal da assinatura. Abra uma fatura e pague, ou contacte o suporte.',
        });
      }
      const { uuid: tituloUuid, tituloMk: tituloMkRaw } = escolhido;
      const tituloMk = aplicarJurosAtrasoTitulo({ ...tituloMkRaw });
      const valorTitulo = parseValorTituloMk(tituloMk.valor ?? tituloMk.dados?.valor);
      if (!Number.isFinite(valorTitulo) || valorTitulo <= 0) {
        return res.status(400).json({ error: 'Não foi possível ler o valor da fatura para a assinatura.' });
      }
      const cfd = loadClubFaturaDesconto(login);
      const permitidos = valoresMpPermitidosParaTitulo(tituloMk, cfd.pendente, tituloUuid);
      let valorMensal = permitidos.length ? Math.min(...permitidos.filter((x) => Number.isFinite(x))) : valorTitulo;
      if (!Number.isFinite(valorMensal) || valorMensal <= 0) valorMensal = valorTitulo;

      const externalReference = `LEMONSUB|${login}|${cpfRaw}`;
      const startDate = new Date();
      startDate.setMinutes(startDate.getMinutes() + 30);

      const reason = (`Mensalidade Internet — ${login}`).slice(0, 230);
      const preBody = {
        reason,
        external_reference: externalReference,
        payer_email: email,
        back_url: backUrl,
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: Number(parseFloat(valorMensal).toFixed(2)),
          currency_id: 'BRL',
          start_date: startDate.toISOString(),
        },
      };

      const pr = await axios.post(`${MP_BASE}/preapproval`, preBody, {
        headers: {
          Authorization: `Bearer ${MP_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `carteira-sub-${login}-${Date.now()}`,
        },
      });
      const data = pr.data;
      const preapprovalId = data.id != null ? String(data.id) : '';
      const initPoint = data.init_point || data.sandbox_init_point || '';
      if (!preapprovalId || !initPoint) {
        console.error('[Carteira] preapproval sem init_point:', data);
        return res.status(502).json({
          error: data.message || data.cause?.[0]?.description || 'Mercado Pago não devolveu link de autorização.',
        });
      }

      try {
        sqliteDb
          .prepare(`
          INSERT INTO mp_subscriptions (preapproval_id, login, cpf_limpo, valor_mensal, titulo_uuid_ref, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(preapproval_id) DO UPDATE SET
            login = excluded.login,
            cpf_limpo = excluded.cpf_limpo,
            valor_mensal = excluded.valor_mensal,
            titulo_uuid_ref = excluded.titulo_uuid_ref,
            status = excluded.status,
            updated_at = datetime('now')
        `)
          .run(preapprovalId, login, cpfRaw, valorMensal, tituloUuid, String(data.status || 'pending'));
      } catch (dbErr) {
        console.warn('[Carteira] mp_subscriptions:', dbErr.message);
      }

      res.json({
        ok: true,
        initPoint,
        preapprovalId,
        valorMensal,
        tituloUuid,
      });
    } catch (e) {
      const err = e.response?.data;
      console.error('[Carteira] débito automático:', err || e.message);
      let msg = err?.message || err?.error || err?.cause?.[0]?.description || e.message;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
      res.status(e.response?.status || 500).json({ error: msg });
    }
  });
}

module.exports = { registerCarteiraRoutes };
