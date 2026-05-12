/**
 * Rotas e job de pagamentos Mercado Pago (PIX, cartão, webhook, baixa).
 */
const express = require('express');
const crypto  = require('crypto');
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
const { aplicarJurosAtrasoTitulo } = require('../lib/juros-atraso-fatura');
const { mpWalletGetOrCreateCustomer } = require('../lib/mercadopago-wallet');

const {
  MP_TOKEN,
  MP_PUBKEY,
  MP_WEBHOOK_SECRET,
  MP_BASE,
  MK_URL,
  mpChavesMercadoPagoAlinhadas,
  mpAccessTokenEhTeste,
  mpPortalOrigin,
  MP_PIX_EXPIRATION_MIN,
  MP_JOB_INTERVAL_MS,
  MP_JOB_MAX_ATTEMPTS,
} = config;

function tituloPayloadParaCupomPortal(tituloRaw, uuidTitulo) {
  const payload = garantirUuidTituloPayload(tituloRaw && typeof tituloRaw === 'object' ? { ...tituloRaw } : {}, uuidTitulo);
  return aplicarJurosAtrasoTitulo(payload);
}

const MP_UUID_FATURA = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MK_TITULO_UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MK_TITULO_UUID_HEX32 = /^[0-9a-f]{32}$/i;

/**
 * Valida a assinatura HMAC-SHA256 enviada pelo Mercado Pago no header x-signature.
 * Retorna true se válida, false se inválida.
 * Se MP_WEBHOOK_SECRET não estiver configurado, loga aviso e aceita (modo legado).
 *
 * Documentação: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */
function validarAssinaturaWebhookMP(req) {
  if (!MP_WEBHOOK_SECRET) {
    console.warn('[MP Webhook] ⚠️  MP_WEBHOOK_SECRET não configurado — assinatura não validada. Configure no .env e no Painel MP.');
    return true;
  }

  const xSignature = String(req.headers['x-signature'] || '').trim();
  const xRequestId = String(req.headers['x-request-id'] || '').trim();
  const paymentId  = req.body?.data?.id;

  if (!xSignature) {
    console.warn('[MP Webhook] Header x-signature ausente — requisição rejeitada.');
    return false;
  }

  // Extrai ts= e v1= do header "ts=<timestamp>,v1=<hmac>"
  const partes = {};
  for (const seg of xSignature.split(',')) {
    const eq = seg.indexOf('=');
    if (eq > 0) partes[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim();
  }
  const ts = partes.ts;
  const v1 = partes.v1;

  if (!ts || !v1) {
    console.warn('[MP Webhook] Header x-signature mal-formado.');
    return false;
  }

  // Constrói o manifest conforme docs do MP
  const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts}`;
  const esperado = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');

  try {
    const bufEsperado = Buffer.from(esperado, 'hex');
    const bufRecebido = Buffer.from(v1, 'hex');
    if (bufEsperado.length !== bufRecebido.length) return false;
    return crypto.timingSafeEqual(bufEsperado, bufRecebido);
  } catch {
    return false;
  }
}

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

/** Fatura no Mercado Pago — pagamento único no cartão (POST /v1/payments + cardToken). */
async function portalMpPagamentoFatura(req, res) {
  const { tituloUuid, valor, descricao, cardToken, card_token_id, mpCustomerId } = req.body;
  const cli = req.session.cliente;
  if (!tituloUuid || !valor) return res.status(400).json({ error: 'Dados obrigatórios: tituloUuid, valor' });

  if (MP_TOKEN && MP_PUBKEY && !mpChavesMercadoPagoAlinhadas()) {
    return res.status(400).json({
      error:
        'Credenciais Mercado Pago incoerentes: alinhe Public Key e Access Token (sandbox ou produção) no .env e reinicie o servidor.',
    });
  }

  const cardTok = (cardToken || card_token_id || '').trim();
  if (!cardTok) {
    return res.status(400).json({
      error: 'Envie cardToken (token do cartão gerado no navegador com MercadoPago.js).',
    });
  }

  try {
    const token = await getJWT();
    const mkCli = await axios.get(`${MK_URL}/cliente/show/${cli.login}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cpfRaw = (mkCli.data.cpf_cnpj || '').replace(/\D/g, '');
    if (!cpfRaw || cpfRaw.length < 11) {
      return res.status(400).json({
        error: 'CPF não encontrado no cadastro. Atualize seus dados para pagar com cartão.',
      });
    }

    const origin = mpPortalOrigin();
    const notificationUrl = `${origin}/portal/pagamento/webhook`;

    const tokenStr = String(MP_TOKEN || '').trim();
    const isTestToken = tokenStr.startsWith('TEST-');

    let tituloMk = await mkTituloPertenceAoCliente(tituloUuid, cli.login, token);
    if (!tituloMk) {
      return res.status(400).json({
        error: 'Fatura não encontrada no MK-Auth ou não pertence à sua conta.',
      });
    }
    tituloMk = aplicarJurosAtrasoTitulo({ ...tituloMk });
    const valorTitulo = parseValorMkAuth(tituloMk.valor ?? tituloMk.dados?.valor);
    const valorPedido = Number(parseFloat(valor).toFixed(2));
    try {
      if (cpfRaw.length >= 11) await reconciliarPendenteDescontoClube(cli.login, cpfRaw, mkGet);
    } catch (_) {}
    const cfd = loadClubFaturaDesconto(cli.login);
    const permitidos = valoresMpPermitidosParaTitulo(tituloMk, cfd.pendente, tituloUuid);
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
    let savedPaymentMethodId = null;
    const reqCardId = (req.body.mpCardId || '').trim();
    if (mpCust) {
      const cartaoQuery = reqCardId
        ? 'SELECT payment_method_id FROM wallet_cards WHERE login = ? AND mp_customer_id = ? AND mp_card_id = ?'
        : 'SELECT payment_method_id FROM wallet_cards WHERE login = ? AND mp_customer_id = ? AND mp_card_id IS NOT NULL LIMIT 1';
      const cartaoParams = reqCardId ? [cli.login, mpCust, reqCardId] : [cli.login, mpCust];
      const temCartao = sqliteDb.prepare(cartaoQuery).get(...cartaoParams);
      if (!temCartao) {
        return res.status(400).json({
          error:
            'Cliente do cartão não confere com sua carteira. Remova o cartão na carteira e cadastre de novo no Mercado Pago.',
        });
      }
      savedPaymentMethodId = temCartao.payment_method_id || null;
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
    if (savedPaymentMethodId) {
      payPayload.payment_method_id = savedPaymentMethodId;
    }

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

    const MP_STATUS_DETAIL_PT = {
      cc_rejected_bad_filled_card_number: 'Número do cartão inválido. Verifique e tente novamente.',
      cc_rejected_bad_filled_date:        'Data de validade incorreta. Verifique o mês e ano.',
      cc_rejected_bad_filled_other:       'Dados do cartão inválidos. Confira todos os campos.',
      cc_rejected_bad_filled_security_code:'CVV incorreto. Verifique o código de segurança.',
      cc_rejected_blacklist:              'Cartão bloqueado. Entre em contato com o banco emissor.',
      cc_rejected_call_for_authorize:     'Pagamento requer autorização. Ligue para o banco emissor.',
      cc_rejected_card_disabled:          'Cartão desativado. Ative-o pelo seu banco ou use outro cartão.',
      cc_rejected_card_error:             'Não foi possível processar o cartão. Tente novamente.',
      cc_rejected_duplicated_payment:     'Pagamento duplicado detectado. A operação anterior ainda está em processamento.',
      cc_rejected_high_risk:              'Pagamento recusado por segurança. Tente outro cartão ou use o PIX.',
      cc_rejected_insufficient_amount:    'Saldo insuficiente no cartão. Use outro cartão ou pague via PIX.',
      cc_rejected_invalid_installments:   'Parcelamento não disponível para este cartão.',
      cc_rejected_max_attempts:           'Número máximo de tentativas atingido. Aguarde ou use outro cartão.',
      cc_rejected_other_reason:           'Cartão recusado. Contate o banco emissor ou use outro cartão.',
      rejected_by_bank:                   'Recusado pelo banco. Entre em contato com o banco emissor.',
      rejected_insufficient_data:         'Dados insuficientes. Verifique todos os campos e tente novamente.',
      pending_contingency:                'Pagamento em análise. Aguarde a confirmação.',
      pending_review_manual:              'Pagamento em análise manual. Você será notificado.',
    };
    const rawDetail = payData.status_detail || payData.message || 'cc_rejected_other_reason';
    const detailKey = typeof rawDetail === 'string' ? rawDetail.trim() : '';
    const detailPt  = MP_STATUS_DETAIL_PT[detailKey] || rawDetail || 'Pagamento recusado pelo banco.';
    return res.status(400).json({
      error: typeof detailPt === 'string' ? detailPt : JSON.stringify(detailPt),
      mpId: payData.id,
      status: payData.status,
      status_detail: detailKey,
    });
  } catch (e) {
    const err = e.response?.data;
    console.error('[MP Fatura]', err || e.message);
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
  app.post('/portal/pagamento/fatura/cartao', requireAuth, portalMpPagamentoFatura);

  app.post('/portal/pagamento/pix', requireAuth, async (req, res) => {
    const { tituloUuid, valor, descricao } = req.body;
    const cli = req.session.cliente;
    if (!tituloUuid || !valor) return res.status(400).json({ error: 'Dados obrigatórios: tituloUuid, valor' });

    try {
      const token = await getJWT();
      const rawT = await mkTituloPertenceAoCliente(tituloUuid, cli.login, token);
      if (!rawT) {
        return res.status(400).json({ error: 'Fatura não encontrada no MK-Auth ou não pertence à sua conta.' });
      }
      const tituloMk = aplicarJurosAtrasoTitulo({ ...rawT });
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
      const permitidos = valoresMpPermitidosParaTitulo(tituloMk, cfd.pendente, tituloUuid);
      if (
        permitidos.length > 0 &&
        !Number.isNaN(valorTitulo) &&
        !Number.isNaN(valorPedido) &&
        !valorPedidoConferePermitidos(valorPedido, permitidos)
      ) {
        return res.status(400).json({ error: 'Valor enviado não confere com o valor da fatura. Atualize a lista de faturas.' });
      }
      const emailRaw = String(mkCli.data.email || '').trim();
      // O MP valida formato e domínio do e-mail; evita TLDs inexistentes como .lemon
      const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw) ? emailRaw : `cliente.${cli.login}@lemon.com.br`;
      const nomes = (mkCli.data.nome || cli.nome || 'Cliente').split(' ');
      const firstName = nomes[0];
      const lastName = nomes.slice(1).join(' ') || nomes[0];

      // MP exige mínimo ~30 min de expiração para PIX em produção
      const expiraEm = new Date(Date.now() + MP_PIX_EXPIRATION_MIN * 60_000).toISOString();
      const payload = {
        transaction_amount: parseFloat(valor),
        description: descricao || `Mensalidade Internet - ${cli.login}`,
        payment_method_id: 'pix',
        external_reference: tituloUuid,
        date_of_expiration: expiraEm,
        notification_url: `${mpPortalOrigin()}/portal/pagamento/webhook`,
        payer: {
          email: emailValido,
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
      // Extrai a causa detalhada que o MP inclui em err.cause[]
      let msg = err?.message || e.message;
      if (Array.isArray(err?.cause) && err.cause.length > 0) {
        const causas = err.cause.map(c => c.description || c.code).filter(Boolean).join('; ');
        if (causas) msg = `${msg} — ${causas}`;
      }
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
      res.status(e.response?.status || 500).json({ error: msg });
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
    // Valida assinatura HMAC antes de qualquer processamento
    if (!validarAssinaturaWebhookMP(req)) {
      console.warn('[MP Webhook] Assinatura inválida — requisição ignorada. IP:', req.ip);
      return res.sendStatus(200); // 200 para o MP não retentar; bloqueia silenciosamente
    }

    res.sendStatus(200);
    const body = req.body || {};

    if ((body.type === 'subscription_preapproval' || body.topic === 'subscription_preapproval') && body.data?.id) {
      (async () => {
        const id = String(body.data.id);
        try {
          const pr = await axios.get(`${MP_BASE}/preapproval/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${MP_TOKEN}` },
          });
          const st = String(pr.data?.status || '');
          sqliteDb
            .prepare(`UPDATE mp_subscriptions SET status = ?, updated_at = datetime('now') WHERE preapproval_id = ?`)
            .run(st, id);
        } catch (e) {
          console.warn('[MP Webhook] preapproval sync:', e.response?.data || e.message);
        }
      })();
      return;
    }

    const dataId = body.data?.id != null ? String(body.data?.id) : '';
    const paymentId = dataId;
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
          tentarConsumirDescontoClubePosBaixa(
            loginCliente,
            tituloUuid,
            parseFloat(valor),
            tituloPayloadParaCupomPortal(tituloPre, tituloUuid),
          );
          await notificarFaturaPagaComPontos(loginCliente, valor, resultado, forma);
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
        const resultado = concederPontosMP(loginCliente, tituloUuid);
        tentarConsumirDescontoClubePosBaixa(
          loginCliente,
          tituloUuid,
          valorFinal,
          tituloPayloadParaCupomPortal(tituloMk, tituloUuid),
        );
        setImmediate(() => notificarFaturaPagaComPontos(loginCliente, valorFinal, resultado, forma));
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
  let tituloMkPayload = null;

  try {
    const mkToken = await getJWT();
    try {
      const sr = await axios.get(`${MK_URL}/titulo/show/${encodeURIComponent(titulo_uuid)}`, {
        headers: { Authorization: `Bearer ${mkToken}` },
      });
      tituloMkPayload = sr.data;
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
  tentarConsumirDescontoClubePosBaixa(login, titulo_uuid, valorBaixa, tituloPayloadParaCupomPortal(tituloMkPayload, titulo_uuid));
  setImmediate(() => notificarFaturaPagaComPontos(login, valorBaixa, resultado, forma));

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
