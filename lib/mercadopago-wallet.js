const axios = require('axios');
const config = require('./config');
const { sqliteDb } = require('./database');

const { MP_TOKEN, MP_BASE } = config;

/** Monta o body de POST/PUT /v1/customers a partir do retorno do MK-Auth (`cliente/show`). */
function mpMercadoPagoCustomerBodyFromMk(mkClienteData, login, nomeSessao) {
  const d = mkClienteData && typeof mkClienteData === 'object' ? mkClienteData : {};
  const nome = String(d.nome || nomeSessao || login || 'Cliente').trim();
  const parts = nome.split(/\s+/).filter(Boolean);
  const first_name = parts[0] || 'Cliente';
  const last_name = parts.slice(1).join(' ') || first_name;
  const email = (d.email && String(d.email).trim()) || `${login}@cliente.lemon`;
  const body = { email, first_name, last_name };
  const cpfRaw = String(d.cpf_cnpj || '').replace(/\D/g, '');
  if (cpfRaw.length >= 11) {
    body.identification = {
      type: cpfRaw.length > 11 ? 'CNPJ' : 'CPF',
      number: cpfRaw,
    };
  }
  const tel = String(d.celular || d.telefone || d.fone || d.phone || '').replace(/\D/g, '');
  if (tel.length >= 10) {
    body.phone = {
      area_code: tel.slice(0, 2),
      number: tel.slice(2),
    };
  }
  return body;
}

/**
 * Cliente Mercado Pago alinhado ao cadastro MK-Auth (mesmo usuário do portal).
 * Atualiza nome/e-mail/CPF/telefone no MP sempre que já existe vínculo local.
 */
async function mpWalletGetOrCreateCustomer(login, mkClienteData, nomeSessao) {
  const body = mpMercadoPagoCustomerBodyFromMk(mkClienteData, login, nomeSessao);

  const row = sqliteDb.prepare('SELECT mp_customer_id FROM wallet_customers WHERE login = ?').get(login);
  if (row?.mp_customer_id) {
    const cid = String(row.mp_customer_id);
    try {
      await axios.put(`${MP_BASE}/v1/customers/${cid}`, body, {
        headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.warn('[MP Customer] sync dados MK → MP:', e.response?.data || e.message);
    }
    return cid;
  }

  let customerId = null;
  try {
    const search = await axios.get(`${MP_BASE}/v1/customers/search`, {
      params: { email: body.email },
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
    const results = search.data?.results || [];
    if (results.length === 1) {
      customerId = results[0].id || null;
    } else if (results.length > 1) {
      // Prefere o customer com mais cartões para não perder histórico
      const sorted = [...results].sort((a, b) => (b.cards?.length || 0) - (a.cards?.length || 0));
      customerId = sorted[0].id || null;
      if (results.length > 1) {
        console.warn(`[MP Customer] ${results.length} customers com e-mail "${body.email}" — usando o com mais cartões (${sorted[0].id})`);
      }
    }
  } catch (_) {}

  if (!customerId) {
    const cr = await axios.post(`${MP_BASE}/v1/customers`, body, {
      headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
    });
    customerId = cr.data?.id;
  } else {
    try {
      await axios.put(`${MP_BASE}/v1/customers/${customerId}`, body, {
        headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.warn('[MP Customer] atualizar cliente encontrado por e-mail:', e.response?.data || e.message);
    }
  }

  if (!customerId) throw new Error('Não foi possível criar cliente no Mercado Pago');

  sqliteDb.prepare(
    "INSERT OR REPLACE INTO wallet_customers (login, mp_customer_id, updated_at) VALUES (?, ?, datetime('now'))"
  ).run(login, String(customerId));
  return String(customerId);
}

module.exports = { mpMercadoPagoCustomerBodyFromMk, mpWalletGetOrCreateCustomer };
