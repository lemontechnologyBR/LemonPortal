/**
 * Rotas e job de pagamentos Mercado Pago (PIX, cartão, webhook, baixa).
 */
const express = require('express');
const axios = require('axios');
const config = require('../lib/config');
const { sqliteDb } = require('../lib/database');
const { getJWT, mkGet } = require('../lib/mk-api');
const {
  loadClubFaturaDesconto,
  valoresMpPermitidosParaTitulo,
  valorPedidoConferePermitidos,
  tentarConsumirDescontoClubePosBaixa,
  reconciliarPendenteDescontoClube,
  garantirUuidTituloPayload,
} = require('../lib/clube-fatura-desconto');
const { mpWalletGetOrCreateCustomer } = require('../lib/mercadopago-wallet');

const {
  MP_TOKEN,
  MP_PUBKEY,
  MP_BASE,
  MK_URL,
  mpChavesMercadoPagoAlinhadas,
  mpAccessTokenEhTeste,
  mpPortalOrigin,
  MP_PIX_EXPIRATION_MIN,
  MP_JOB_INTERVAL_MS,
  MP_JOB_MAX_ATTEMPTS,
} = config;

const MP_UUID_FATURA = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MK_TITULO_UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MK_TITULO_UUID_HEX32 = /^[0-9a-f]{32}$/i;

function mpRefPareceUuidTituloMk(ref) {
  const s = String(ref || '').trim();
  return MP_UUID_FATURA.test(s) || MK_TITULO_UUID_LOOSE.test(s) || MK_TITULO_UUID_HEX32.test(s);
}

function mpExternalRefTituloSeguro(ref) {
  const s = String(ref || '').trim();
  if (s.length < 1 || s.length > 256) return false;
  if (s.startsWith('LEMONSUB|')) return false;
  return !/[\r\n\x00]/.test(s);
}

function parseValorMkAuth(v) {
  if (v == null || v === '') return NaN;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  return parseFloat(s);
}

async function mkTituloPertenceAoCliente(tituloId, cliLogin, mkToken) {
  const id = String(tituloId || '').trim();
  if (!id || id.length > 256) return null;
  try {
    const r = await axios.get(`${MK_URL}/titulo/show/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${mkToken}` },
    });
    const d = r.data;
    const loginTitulo = d?.login ?? d?.dados?.login;
    if (loginTitulo == null) return null;
    if (String(loginTitulo).toLowerCase() !== String(cliLogin).toLowerCase()) return null;
    return garantirUuidTituloPayload(d, id);
  } catch {
    return null;
  }
}

async function escolherTituloParaCobrancaRecorrente(cpfLimpo, valorAlvo) {
  if (!cpfLimpo) return null;
  const v = parseFloat(valorAlvo);
  let lista = [];
  try {
    const ab = await mkGet(`titulo/aberto/${cpfLimpo}`);
    lista = lista.concat(ab.titulos || []);
  } catch {}
  try {
    const ve = await mkGet(`titulo/vencido/${cpfLimpo}`);
    lista = lista.concat(ve.titulos || []);
  } catch {}
  for (const t of lista) {
    if (!t?.uuid) continue;
    const tv = parseFloat(t.valor);
    if (!Number.isNaN(v) && !Number.isNaN(tv) && Math.abs(tv - v) < 0.02) return t.uuid;
  }
  lista.sort((a, b) => new Date(a.datavenc || 0) - new Date(b.datavenc || 0));
  const first = lista.find(t => t?.uuid);
  return first ? first.uuid : null;
}

async function resolverTituloUuidDoPagamentoMp(pag) {
  const ref = String(pag.external_reference || '').trim();
  if (mpRefPareceUuidTituloMk(ref)) return ref;
  if (mpExternalRefTituloSeguro(ref)) return ref;

  if (ref.startsWith('LEMONSUB|')) {
    const parts = ref.split('|');
    const login = parts[1];
    const cpf = (parts[2] || '').replace(/\D/g, '');
    if (cpf) {
      const u = await escolherTituloParaCobrancaRecorrente(cpf, pag.transaction_amount);
      if (u) return u;
    }
    if (login) {
      const sub = sqliteDb
        .prepare('SELECT cpf_limpo FROM mp_subscriptions WHERE login = ? ORDER BY datetime(created_at) DESC LIMIT 1')
        .get(login);
      if (sub?.cpf_limpo) {
        return escolherTituloParaCobrancaRecorrente(sub.cpf_limpo, pag.transaction_amount);
      }
    }
  }
  const preId = pag.metadata?.preapproval_id || pag.preapproval_id;
  if (preId) {
    const sub = sqliteDb.prepare('SELECT cpf_limpo FROM mp_subscriptions WHERE preapproval_id = ?').get(String(preId));
    if (sub?.cpf_limpo) {
      return escolherTituloParaCobrancaRecorrente(sub.cpf_limpo, pag.transaction_amount);
    }
  }
  return null;
}

function mpFormaPagamentoDaTransacao(pag) {
  if (!pag || typeof pag !== 'object') return 'pix';
  const pt = String(pag.payment_type_id || '').toLowerCase();
  if (pt === 'credit_card' || pt === 'debit_card') return 'cartao';
  const ref = String(pag.external_reference || '');
  if (ref.startsWith('LEMONSUB|')) return 'cartao';
  return 'pix';
}

function mpTentarReservarBaixa(mpId) {
  try {
    const r = sqliteDb.prepare('INSERT OR IGNORE INTO mp_baixa_applied (mp_id) VALUES (?)').run(String(mpId));
    return r.changes > 0;
  } catch {
    return false;
  }
}

function mpLiberarReservaBaixa(mpId) {
  try {
    sqliteDb.prepare('DELETE FROM mp_baixa_applied WHERE mp_id = ?').run(String(mpId));
  } catch (_) {}
}

async function portalMpAssinatura(req, res) {
  const { tituloUuid, valor, descricao, cardToken, card_token_id, hostedCheckout, mpCustomerId } = req.body;
  const cli = req.session.cliente;
  if (!tituloUuid || !valor) return res.status(400).json({ error: 'Dados obrigatórios: tituloUuid, valor' });

  if (MP_TOKEN && MP_PUBKEY && !mpChavesMercadoPagoAlinhadas()) {
    return res.status(400).json({
      error:
        'Credenciais Mercado Pago incoerentes: alinhe Public Key e Access Token (sandbox ou produção) no .env e reinicie o servidor.',
    });
  }

  const cardTok = (cardToken || card_token_id || '').trim();
  const usarHosted = hostedCheckout === true;

  if (!cardTok && !usarHosted) {
    return res.status(400).json({
      error:
        'Envie card_token_id (token do cartão gerado no navegador com MercadoPago.js e a public key) ou hostedCheckout:true para link externo.',
    });
  }

  try {
    const token = await getJWT();
    const mkCli = await axios.get(`${MK_URL}/cliente/show/${cli.login}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cpfRaw = (mkCli.data.cpf_cnpj || '').replace(/\D/g, '');
    if (!cpfRaw || cpfRaw.length < 11) {
      return res.status(400).json({ error: 'CPF não encontrado no cadastro. Atualize seus dados para usar assinatura no cartão.' });
    }
    const email = mkCli.data.email || `${cli.login}@cliente.lemon`;

    const origin = mpPortalOrigin();
    let backUrl = String(process.env.MP_BACK_URL || `${origin}/?faturas=1&mp_sub=ok`)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (!backUrl || /^(undefined|null)$/i.test(backUrl)) {
      backUrl = `${origin}/?faturas=1&mp_sub=ok`;
    }
    const notificationUrl = `${origin}/portal/pagamento/webhook`;

    const tokenStr = String(MP_TOKEN || '').trim();
    const isTestToken = tokenStr.startsWith('TEST-');

    if (cardTok) {
      const tituloMk = await mkTituloPertenceAoCliente(tituloUuid, cli.login, token);
      if (!tituloMk) {
        return res.status(400).json({
          error: 'Fatura não encontrada no MK-Auth ou não pertence à sua conta.',
        });
      }
      const valorTitulo = parseValorMkAuth(tituloMk.valor ?? tituloMk.dados?.valor);
      const valorPedido = Number(parseFloat(valor).toFixed(2));
      try {
        if (cpfRaw.length >= 11) await reconciliarPendenteDescontoClube(cli.login, cpfRaw, mkGet);
      } catch (_) {}
      const cfd = loadClubFaturaDesconto(cli.login);
      const permitidos = valoresMpPermitidosParaTitulo(valorTitulo, cfd.pendente, tituloUuid);
      if (
        permitidos.length > 0 &&
        !Number.isNaN(valorTitulo) &&
        !Number.isNaN(valorPedido) &&
        !valorPedidoConferePermitidos(valorPedido, permitidos)
      ) {
        return res.status(400).json({ error: 'Valor enviado não confere com o valor da fatura. Atualize a lista de faturas.' });
      }
      if (
        !isTestToken &&
        /^http:\/\//i.test(notificationUrl) &&
        !/localhost|127\.0\.0\.1/i.test(notificationUrl)
      ) {
        return res.status(400).json({
          error:
            'Mercado Pago (produção) exige webhook em HTTPS. Defina PORTAL_URL com https:// no .env e reinicie o servidor.',
        });
      }
      const uuidRef = String(tituloUuid).trim();
      const mpCust = String(mpCustomerId || '').trim();
      const customerIdDoMk = await mpWalletGetOrCreateCustomer(cli.login, mkCli.data, cli.nome);

      let payerPayload;
      if (mpCust) {
        const temCartao = sqliteDb
          .prepare(
            'SELECT 1 FROM wallet_cards WHERE login = ? AND mp_customer_id = ? AND mp_card_id IS NOT NULL LIMIT 1'
          )
          .get(cli.login, mpCust);
        if (!temCartao) {
          return res.status(400).json({
            error:
              'Cliente do cartão não confere com sua carteira. Remova o cartão na carteira e cadastre de novo no Mercado Pago.',
          });
        }
        payerPayload = { type: 'customer', id: mpCust };
      } else {
        payerPayload = { type: 'customer', id: customerIdDoMk };
      }
      const payPayload = {
        transaction_amount: Number(parseFloat(valor).toFixed(2)),
        token: cardTok,
        description: (descricao || `Mensalidade Internet — ${cli.login}`).slice(0, 230),
        installments: 1,
        payer: payerPayload,
        external_reference: uuidRef,
        notification_url: notificationUrl,
        binary_mode: true,
        metadata: { portal_login: cli.login },
      };

      const mpPay = await axios.post(`${MP_BASE}/v1/payments`, payPayload, {
        headers: {
          Authorization: `Bearer ${MP_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `card-${cli.login}-${uuidRef}-${Date.now()}`,
        },
      });
      const payData = mpPay.data;

      if (payData.status === 'approved') {
        return res.json({
          ok: true,
          modo: 'pagamento_cartao',
          mpId: payData.id,
          status: payData.status,
          tituloUuid: uuidRef,
          valor: payData.transaction_amount ?? parseFloat(valor),
        });
      }

      if (
        payData.status === 'pending' ||
        payData.status === 'in_process' ||
        payData.status === 'authorized'
      ) {
        try {
          sqliteDb
            .prepare(`
            INSERT OR IGNORE INTO pending_payments (mp_id, login, titulo_uuid, valor, status)
            VALUES (?, ?, ?, ?, 'pending')
          `)
            .run(String(payData.id), cli.login, uuidRef, parseFloat(valor));
        } catch (dbErr) {
          console.warn('[MP Cartão] Erro ao salvar pendente:', dbErr.message);
        }
        return res.json({
          ok: true,
          modo: 'pagamento_cartao_pendente',
          mpId: payData.id,
          status: payData.status,
          tituloUuid: uuidRef,
          valor: payData.transaction_amount ?? parseFloat(valor),
          pollBaixa: true,
        });
      }

      const detail = payData.status_detail || payData.message || 'Pagamento recusado';
      return res.status(400).json({
        error: typeof detail === 'string' ? detail : JSON.stringify(detail),
        mpId: payData.id,
        status: payData.status,
      });
    }

    const extRef = `LEMONSUB|${cli.login}|${cpfRaw}`;
    const startAt = new Date(Date.now() + 120_000).toISOString();
    const endAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

    if (!isTestToken && /^http:\/\//i.test(backUrl) && !/localhost|127\.0\.0\.1/i.test(backUrl)) {
      return res.status(400).json({
        error:
          'Mercado Pago (produção) exige back_url em HTTPS. Defina PORTAL_URL ou MP_BACK_URL com https:// no .env e reinicie o servidor.',
      });
    }

    const payload = {
      back_url: backUrl,
      reason: (descricao || `Mensalidade Internet — ${cli.login}`).slice(0, 230),
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        start_date: startAt,
        end_date: endAt,
        transaction_amount: parseFloat(valor),
        currency_id: 'BRL',
      },
      payer_email: email,
      external_reference: extRef,
      notification_url: notificationUrl,
      status: 'pending',
    };

    const mpRes = await axios.post(`${MP_BASE}/preapproval`, payload, {
      headers: {
        Authorization: `Bearer ${MP_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `sub-${cli.login}-${tituloUuid}-${Date.now()}`,
      },
    });
    const data = mpRes.data;

    if (!data.init_point) {
      console.error('[MP Assinatura] Resposta sem init_point:', data);
      return res.status(500).json({ error: 'Mercado Pago não retornou link de checkout.' });
    }

    const subStatus = data.status || 'pending';
    try {
      sqliteDb
        .prepare(`
        INSERT INTO mp_subscriptions (preapproval_id, login, cpf_limpo, valor_mensal, titulo_uuid_ref, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `)
        .run(String(data.id), cli.login, cpfRaw, parseFloat(valor), tituloUuid, subStatus);
    } catch (dbErr) {
      console.warn('[MP Assinatura] Erro ao salvar registro:', dbErr.message);
    }

    res.json({
      ok: true,
      preapprovalId: data.id,
      status: subStatus,
      initPoint: data.init_point || null,
      modo: 'hosted',
    });
  } catch (e) {
    const err = e.response?.data;
    console.error('[MP Assinatura]', err || e.message);
    let msg = err?.message || err?.error || err?.cause?.[0]?.description || e.message;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    if (/back_url/i.test(msg)) {
      msg +=
        ' Configure PORTAL_URL (URL pública do portal, ex.: https://portal.suaempresa.com) ou MP_BACK_URL com a URL completa de retorno; reinicie o Node.';
    }
    if (mpAccessTokenEhTeste() && /rejected|invalid|card|token|preapproval|payment/i.test(String(msg))) {
      msg +=
        ' No sandbox use só cartões de teste do Mercado Pago (ex.: Mastercard 5031 4332 1540 6351, CVV 123, titular APRO).';
    }
    if (!mpAccessTokenEhTeste() && /rejected|invalid|card|token|preapproval|payment/i.test(String(msg))) {
      msg += ' Em produção use cartão real; cartões de teste só funcionam com credenciais TEST- no .env.';
    }
    res.status(e.response?.status || 500).json({ error: msg });
  }
}

function registerMercadoPagoRoutes(app, { requireAuth, concederPontosMP, notificarFaturaPagaComPontos }) {
  app.post('/portal/pagamento/assinatura', requireAuth, portalMpAssinatura);
  app.post('/portal/mp/assinatura', requireAuth, portalMpAssinatura);

  app.post('/portal/pagamento/pix', requireAuth, async (req, res) => {
    const { tituloUuid, valor, descricao } = req.body;
    const cli = req.session.cliente;
    if (!tituloUuid || !valor) return res.status(400).json({ error: 'Dados obrigatórios: tituloUuid, valor' });

    try {
      const token = await getJWT();
      const tituloMk = await mkTituloPertenceAoCliente(tituloUuid, cli.login, token);
      if (!tituloMk) {
        return res.status(400).json({ error: 'Fatura não encontrada no MK-Auth ou não pertence à sua conta.' });
      }
      const mkCli = await axios.get(`${MK_URL}/cliente/show/${cli.login}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cpf = (mkCli.data.cpf_cnpj || '').replace(/\D/g, '');
      try {
        if (cpf.length >= 11) await reconciliarPendenteDescontoClube(cli.login, cpf, mkGet);
      } catch (_) {}

      const valorTitulo = parseValorMkAuth(tituloMk.valor ?? tituloMk.dados?.valor);
      const valorPedido = Number(parseFloat(valor).toFixed(2));
      const cfd = loadClubFaturaDesconto(cli.login);
      const permitidos = valoresMpPermitidosParaTitulo(valorTitulo, cfd.pendente, tituloUuid);
      if (
        permitidos.length > 0 &&
        !Number.isNaN(valorTitulo) &&
        !Number.isNaN(valorPedido) &&
        !valorPedidoConferePermitidos(valorPedido, permitidos)
      ) {
        return res.status(400).json({ error: 'Valor enviado não confere com o valor da fatura. Atualize a lista de faturas.' });
      }
      const email = mkCli.data.email || `${cli.login}@cliente.lemon`;
      const nomes = (mkCli.data.nome || cli.nome || 'Cliente').split(' ');
      const firstName = nomes[0];
      const lastName = nomes.slice(1).join(' ') || nomes[0];

      const expiraEm = new Date(Date.now() + MP_PIX_EXPIRATION_MIN * 60_000).toISOString();
      const payload = {
        transaction_amount: parseFloat(valor),
        description: descricao || `Mensalidade Internet - ${cli.login}`,
        payment_method_id: 'pix',
        external_reference: tituloUuid,
        date_of_expiration: expiraEm,
        notification_url: `${mpPortalOrigin()}/portal/pagamento/webhook`,
        payer: {
          email,
          first_name: firstName,
          last_name: lastName,
          identification: cpf ? { type: 'CPF', number: cpf } : undefined,
        },
        metadata: { portal_login: cli.login },
      };

      const mpRes = await axios.post(`${MP_BASE}/v1/payments`, payload, {
        headers: {
          Authorization: `Bearer ${MP_TOKEN}`,
          'X-Idempotency-Key': `${tituloUuid}-${Date.now()}`,
          'Content-Type': 'application/json',
        },
      });

      const data = mpRes.data;
      const pix = data.point_of_interaction?.transaction_data;

      try {
        sqliteDb
          .prepare(`
          INSERT OR IGNORE INTO pending_payments (mp_id, login, titulo_uuid, valor, status)
          VALUES (?, ?, ?, ?, 'pending')
        `)
          .run(String(data.id), cli.login, tituloUuid, parseFloat(valor));
        console.log(`[MP] Pagamento ${data.id} registrado como pendente para ${cli.login}`);
      } catch (dbErr) {
        console.warn('[MP] Erro ao salvar pendente:', dbErr.message);
      }

      res.json({
        mpId: data.id,
        status: data.status,
        qrCode: pix?.qr_code,
        qrBase64: pix?.qr_code_base64,
        expira: data.date_of_expiration,
        valor: data.transaction_amount,
      });
    } catch (e) {
      const err = e.response?.data;
      console.error('[MP PIX]', err || e.message);
      res.status(500).json({ error: err?.message || e.message });
    }
  });

  app.get('/portal/pagamento/status/:mpId', requireAuth, async (req, res) => {
    const cli = req.session.cliente;
    const mpId = String(req.params.mpId || '').trim();
    if (!/^\d+$/.test(mpId)) {
      return res.status(400).json({ error: 'mpId inválido' });
    }
    try {
      const mpRes = await axios.get(`${MP_BASE}/v1/payments/${mpId}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      const pag = mpRes.data;
      const metaLogin = pag.metadata?.portal_login;
      const pending = sqliteDb.prepare('SELECT login FROM pending_payments WHERE mp_id = ?').get(mpId);
      const podeVer =
        (metaLogin && String(metaLogin).toLowerCase() === String(cli.login).toLowerCase()) ||
        (pending && pending.login === cli.login);
      if (!podeVer) {
        return res.status(403).json({ error: 'Pagamento não encontrado ou acesso negado.' });
      }
      const { id, status, status_detail, external_reference, transaction_amount } = pag;
      res.json({ id, status, status_detail, external_reference, valor: transaction_amount });
    } catch (e) {
      res.status(500).json({ error: e.response?.data?.message || e.message });
    }
  });

  app.post('/portal/pagamento/webhook', express.json(), async (req, res) => {
    res.sendStatus(200);
    const body = req.body;
    const paymentId = body.data?.id;
    const typeOk = body.type === 'payment' || (typeof body.action === 'string' && body.action.startsWith('payment'));
    if (!paymentId || !typeOk) return;

    try {
      const mpRes = await axios.get(`${MP_BASE}/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      const pag = mpRes.data;
      if (pag.status !== 'approved') return;

      if (!mpTentarReservarBaixa(paymentId)) {
        console.log('[MP Webhook] Pagamento já baixado anteriormente:', paymentId);
        try {
          sqliteDb.prepare('DELETE FROM pending_payments WHERE mp_id = ?').run(String(paymentId));
        } catch (_) {}
        return;
      }

      const valor = pag.transaction_amount;
      let tituloUuid;
      try {
        tituloUuid = await resolverTituloUuidDoPagamentoMp(pag);
        if (!tituloUuid) {
          console.warn('[MP Webhook] Pagamento aprovado sem título resolvível:', paymentId, pag.external_reference);
          mpLiberarReservaBaixa(paymentId);
          return;
        }

        const forma = mpFormaPagamentoDaTransacao(pag);
        const token = await getJWT();
        let tituloPre = null;
        try {
          const sr = await axios.get(`${MK_URL}/titulo/show/${encodeURIComponent(tituloUuid)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          tituloPre = sr.data;
        } catch (_) {}
        const valorBaseMk = parseValorMkAuth(tituloPre?.valor ?? tituloPre?.dados?.valor);

        const mkRes = await axios.put(
          `${MK_URL}/titulo/receber`,
          {
            uuid: tituloUuid,
            valor: parseFloat(valor).toFixed(2),
            forma,
            coletor: 'Mercado Pago',
          },
          { headers: { Authorization: `Bearer ${token}` } },
        );

        console.log(
          `[MP Webhook] ✅ Baixa (${forma}) — Título ${tituloUuid} | R$ ${valor} | MK:`,
          mkRes.data?.mensagem || mkRes.data?.status,
        );

        const loginCliente = tituloPre?.login || tituloPre?.dados?.login;
        if (loginCliente) {
          const resultado = concederPontosMP(loginCliente, tituloUuid);
          tentarConsumirDescontoClubePosBaixa(loginCliente, tituloUuid, parseFloat(valor), valorBaseMk);
          await notificarFaturaPagaComPontos(loginCliente, valor, resultado);
        }
      } catch (inner) {
        mpLiberarReservaBaixa(paymentId);
        throw inner;
      }
      try {
        sqliteDb.prepare('DELETE FROM pending_payments WHERE mp_id = ?').run(String(paymentId));
      } catch (_) {}
    } catch (e) {
      console.error('[MP Webhook] Erro:', e.response?.data || e.message);
    }
  });

  app.post('/portal/pagamento/baixa', requireAuth, async (req, res) => {
    const { mpId, tituloUuid, valor } = req.body;
    const cli = req.session.cliente;
    if (!mpId || !tituloUuid) return res.status(400).json({ error: 'mpId e tituloUuid obrigatórios' });

    try {
      const mkToken = await getJWT();
      const tituloMk = await mkTituloPertenceAoCliente(tituloUuid, cli.login, mkToken);
      if (!tituloMk) {
        return res.status(403).json({ error: 'Fatura não encontrada ou não pertence à sua conta.' });
      }

      const mpRes = await axios.get(`${MP_BASE}/v1/payments/${mpId}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      if (mpRes.data.status !== 'approved') {
        return res.status(400).json({ error: 'Pagamento ainda não aprovado no Mercado Pago' });
      }

      const pag = mpRes.data;
      const ref = String(pag.external_reference || '').trim();
      const metaLogin = pag.metadata?.portal_login;
      const pending = sqliteDb.prepare('SELECT login FROM pending_payments WHERE mp_id = ?').get(String(mpId));
      const pagamentoDoCliente =
        (pending && pending.login === cli.login) ||
        (metaLogin && String(metaLogin).toLowerCase() === String(cli.login).toLowerCase()) ||
        (ref === String(tituloUuid).trim());
      if (!pagamentoDoCliente) {
        return res.status(403).json({ error: 'Pagamento não vinculado à sua sessão.' });
      }

      if (!mpTentarReservarBaixa(mpId)) {
        return res.json({ ok: true, mensagem: 'Baixa já havia sido processada' });
      }

      const valorFinal = mpRes.data.transaction_amount || parseFloat(valor) || 0;
      const forma = mpFormaPagamentoDaTransacao(mpRes.data);

      let mkRes;
      try {
        mkRes = await axios.put(
          `${MK_URL}/titulo/receber`,
          {
            uuid: tituloUuid,
            valor: valorFinal.toFixed(2),
            forma,
            coletor: 'Mercado Pago',
          },
          { headers: { Authorization: `Bearer ${mkToken}` } },
        );
      } catch (putErr) {
        mpLiberarReservaBaixa(mpId);
        throw putErr;
      }

      console.log(`[MP Baixa] ✅ Título ${tituloUuid} | R$ ${valorFinal} (${forma}) | ${mkRes.data?.mensagem || 'ok'}`);

      const loginCliente = req.session?.cliente?.login;
      if (loginCliente) {
        const valorBaseMk = parseValorMkAuth(tituloMk.valor ?? tituloMk.dados?.valor);
        const resultado = concederPontosMP(loginCliente, tituloUuid);
        tentarConsumirDescontoClubePosBaixa(loginCliente, tituloUuid, valorFinal, valorBaseMk);
        setImmediate(() => notificarFaturaPagaComPontos(loginCliente, valorFinal, resultado));
      }
      try {
        sqliteDb.prepare('DELETE FROM pending_payments WHERE mp_id = ?').run(String(mpId));
      } catch (_) {}

      res.json({ ok: true, mensagem: mkRes.data?.mensagem || 'Baixa realizada com sucesso' });
    } catch (e) {
      const err = e.response?.data;
      console.error('[MP Baixa] Erro:', err || e.message);
      res.status(500).json({ error: err?.mensagem || e.message });
    }
  });

  app.get('/portal/pagamento/config', requireAuth, (req, res) => {
    const teste = mpAccessTokenEhTeste();
    const chavesOk = mpChavesMercadoPagoAlinhadas();
    res.json({
      publicKey: MP_PUBKEY,
      ambiente: teste ? 'teste' : 'producao',
      chavesAlinhadas: chavesOk,
      cartoesSandbox: teste
        ? {
            master: '5031 4332 1540 6351',
            visa: '4509 9535 6623 3704',
            cvv: '123',
            titular: 'APRO',
            cpf: '12345678909',
          }
        : null,
      dica:
        !chavesOk
          ? 'Corrija o .env: Public Key e Access Token devem ser ambos de teste (TEST-) ou ambos de produção (APP_USR).'
          : teste
            ? 'Sandbox: ao adicionar cartão ou pagar fatura, use só os cartões de teste indicados abaixo.'
            : null,
    });
  });
}

async function processarPagamentoConfirmado(row, pagData, concederPontosMP, notificarFaturaPagaComPontos) {
  const { mp_id, login, titulo_uuid, valor } = row;
  console.log(`[JOB MP] ✅ Pagamento ${mp_id} aprovado para ${login} — processando...`);

  const lock = sqliteDb
    .prepare(`
    UPDATE pending_payments SET status='paid', updated_at=datetime('now')
    WHERE mp_id=? AND status='pending'
  `)
    .run(mp_id);
  if (lock.changes === 0) return;

  if (!mpTentarReservarBaixa(mp_id)) {
    try {
      sqliteDb.prepare('DELETE FROM pending_payments WHERE mp_id = ?').run(mp_id);
    } catch (_) {}
    return;
  }

  const forma = mpFormaPagamentoDaTransacao(pagData);
  const valorBaixa = parseFloat(pagData.transaction_amount ?? valor);
  let valorBaseMk = NaN;

  try {
    const mkToken = await getJWT();
    try {
      const sr = await axios.get(`${MK_URL}/titulo/show/${encodeURIComponent(titulo_uuid)}`, {
        headers: { Authorization: `Bearer ${mkToken}` },
      });
      valorBaseMk = parseValorMkAuth(sr.data?.valor ?? sr.data?.dados?.valor);
    } catch (_) {}

    await axios.put(
      `${MK_URL}/titulo/receber`,
      {
        uuid: titulo_uuid,
        valor: valorBaixa,
        forma,
        coletor: 'Mercado Pago',
      },
      { headers: { Authorization: `Bearer ${mkToken}` } },
    );
    console.log(`[JOB MP] Baixa MK-Auth OK (${forma}) para uuid ${titulo_uuid}`);
  } catch (e) {
    mpLiberarReservaBaixa(mp_id);
    console.warn(`[JOB MP] ⚠️ Falha baixa MK-Auth:`, e.response?.data || e.message);
    try {
      sqliteDb.prepare(`UPDATE pending_payments SET status='pending', updated_at=datetime('now') WHERE mp_id=?`).run(mp_id);
    } catch (_) {}
    return;
  }

  const resultado = concederPontosMP(login, titulo_uuid);
  tentarConsumirDescontoClubePosBaixa(login, titulo_uuid, valorBaixa, valorBaseMk);
  setImmediate(() => notificarFaturaPagaComPontos(login, valorBaixa, resultado));

  try {
    sqliteDb.prepare('DELETE FROM pending_payments WHERE mp_id = ?').run(mp_id);
  } catch (_) {}
}

async function checarPagamentosPendentes(concederPontosMP, notificarFaturaPagaComPontos) {
  let pendentes;
  try {
    const limiteMin = MP_PIX_EXPIRATION_MIN + 4;
    const desde = `-${limiteMin} minutes`;
    pendentes = sqliteDb
      .prepare(`
      SELECT * FROM pending_payments
      WHERE status = 'pending'
        AND tentativas < ?
        AND created_at > datetime('now', ?)
    `)
      .all(MP_JOB_MAX_ATTEMPTS, desde);
  } catch {
    return;
  }

  if (!pendentes.length) return;

  console.log(`[JOB MP] Verificando ${pendentes.length} pagamento(s) pendente(s)...`);

  for (const row of pendentes) {
    try {
      sqliteDb.prepare(`
        UPDATE pending_payments SET tentativas=tentativas+1, updated_at=datetime('now') WHERE mp_id=?
      `).run(row.mp_id);

      const mpRes = await axios.get(`${MP_BASE}/v1/payments/${row.mp_id}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      const status = mpRes.data.status;

      if (status === 'approved') {
        await processarPagamentoConfirmado(row, mpRes.data, concederPontosMP, notificarFaturaPagaComPontos);
      } else if (['cancelled', 'rejected', 'refunded', 'charged_back'].includes(status)) {
        sqliteDb.prepare('DELETE FROM pending_payments WHERE mp_id = ?').run(row.mp_id);
        console.log(`[JOB MP] Pagamento ${row.mp_id} removido da fila (status: ${status})`);
      }
    } catch (e) {
      console.warn(`[JOB MP] Erro ao verificar ${row.mp_id}:`, e.message);
    }
  }
}

function limparFilaPagamentosMp() {
  try {
    const limiteMin = MP_PIX_EXPIRATION_MIN + 4;
    const desde = `-${limiteMin} minutes`;
    sqliteDb
      .prepare(`
      DELETE FROM pending_payments
      WHERE status = 'pending'
        AND (tentativas >= ? OR created_at <= datetime('now', ?))
    `)
      .run(MP_JOB_MAX_ATTEMPTS, desde);
    sqliteDb.prepare(`DELETE FROM pending_payments WHERE status != 'pending'`).run();
    sqliteDb.prepare(`DELETE FROM mp_subscriptions WHERE datetime(created_at) < datetime('now', '-120 days')`).run();
  } catch (e) {
    console.warn('[JOB MP] Limpeza fila:', e.message);
  }
}

function startMercadoPagoPendingJob(concederPontosMP, notificarFaturaPagaComPontos) {
  console.log(`[JOB MP] Monitor de PIX (${MP_PIX_EXPIRATION_MIN} min) — ciclo: ${MP_JOB_INTERVAL_MS / 1000}s`);
  setTimeout(() => {
    checarPagamentosPendentes(concederPontosMP, notificarFaturaPagaComPontos);
    limparFilaPagamentosMp();
    setInterval(() => {
      checarPagamentosPendentes(concederPontosMP, notificarFaturaPagaComPontos);
      limparFilaPagamentosMp();
    }, MP_JOB_INTERVAL_MS);
  }, 10_000);
}

module.exports = { registerMercadoPagoRoutes, startMercadoPagoPendingJob };
