'use strict';
const axios = require('axios');
const { sqliteDb } = require('./database');
const { mkGet } = require('./mk-api');
const config = require('./config');
const { getClientData } = require('./clube');

const PORTAL_URL = (process.env.PORTAL_URL || '').trim().replace(/^['"]|['"]$/g, '') || config.LEMON_PORTAL_PUBLIC;

const EVO_URL      = process.env.EVO_URL      || '';
const EVO_INSTANCE = process.env.EVO_INSTANCE || '';
const EVO_APIKEY   = process.env.EVO_APIKEY   || '';

// ── Helpers de template ────────────────────────────────────────────────────

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

// ── Celular ────────────────────────────────────────────────────────────────

const _celularCache = new Map();

function formatarCelularBR(raw = '') {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  if (digits.length === 9)  return `559${digits}`;
  return digits.length >= 8 ? `55${digits}` : null;
}

async function getCelularCliente(login) {
  const cached = _celularCache.get(login);
  if (cached && (Date.now() - cached.ts) < 300_000) return cached.numero;

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

// ── Envio Evolution API ────────────────────────────────────────────────────

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

// ── Notificações específicas ───────────────────────────────────────────────

async function getNomeCliente(login) {
  try {
    const res = await mkGet(`cliente/listar/pagina=1&login=${encodeURIComponent(login)}`);
    const cli = (res.clientes || []).find(c => c.login === login);
    if (cli && cli.nome) return cli.nome;
  } catch {}
  try {
    const cli = await mkGet(`cliente/show/${login}`);
    if (cli && cli.nome) return cli.nome;
  } catch {}
  return login;
}

async function enviarBoasVindas(login, nome) {
  const tpl = getTemplate('boas_vindas');
  if (!tpl || !tpl.ativo) return;
  const msg = renderTemplate(tpl.mensagem, { nome, login, portal_url: PORTAL_URL });
  await enviarZapCliente(login, msg);
}

async function enviarApresentacaoClube(login, nome) {
  const tpl = getTemplate('lemon_club');
  if (!tpl || !tpl.ativo) return;
  const msg = renderTemplate(tpl.mensagem, { nome, login, portal_url: PORTAL_URL });
  await enviarZapCliente(login, msg);
}

async function notificarCadastro(login, nome, celular) {
  try {
    const tpl = getTemplate('boas_vindas_cadastro');
    if (!tpl || !tpl.ativo) return;
    const msg = renderTemplate(tpl.mensagem, { nome, login, portal_url: PORTAL_URL });

    if (celular) {
      const digits = celular.replace(/\D/g, '');
      if (digits.length >= 10) {
        const numero = digits.startsWith('55') ? digits : '55' + digits;
        _celularCache.set(login, { numero, ts: Date.now() });
      }
    }

    if (!_celularCache.has(login)) {
      await new Promise(r => setTimeout(r, 3000));
    }

    await enviarZapCliente(login, msg);
  } catch (e) {
    console.warn(`[EVO Cadastro] ❌ Falha para ${login}:`, e.message);
  }
}

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

async function notificarFaturaPagaComPontos(login, valor, resultado = {}, forma = 'pix') {
  try {
    const tpl = getTemplate('fatura_paga');
    if (!tpl || !tpl.ativo) return;
    const nome = await getNomeCliente(login);
    const data = new Date().toLocaleDateString('pt-BR');
    const valorFmt = parseFloat(valor) > 0
      ? parseFloat(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
      : String(valor);
    const db = getClientData(login);
    const totalPts = db[login]?.points || resultado.totalPts || 0;
    const streak   = db[login]?.streak || resultado.streak   || 0;
    const formaFmt = forma === 'cartao' ? 'Cartão via Mercado Pago' : 'PIX via Mercado Pago';

    const extra = `\n🌟 Você ganhou *+50 pontos* no Lemon Club!\n💎 Total acumulado: *${totalPts} pontos* | Faturas em dia: *${streak}*`;
    const msg = renderTemplate(tpl.mensagem, { nome, login, valor: valorFmt, data, forma: formaFmt, portal_url: PORTAL_URL }) + extra;
    await enviarZapCliente(login, msg);
  } catch (e) {
    console.warn(`[ZAP Pagamento+Pts] ❌ Falha:`, e.message);
  }
}

function isPrimeiroLogin(login) {
  const notif = sqliteDb.prepare(`SELECT id FROM notifications WHERE login = ? AND tipo = 'zap' LIMIT 1`).get(login);
  const hist  = sqliteDb.prepare(`SELECT login_history FROM clients WHERE login = ?`).get(login);
  if (notif) return false;
  if (hist) {
    try {
      const arr = JSON.parse(hist.login_history || '[]');
      if (arr.length > 1) return false;
    } catch {}
  }
  return true;
}

module.exports = {
  PORTAL_URL,
  getTemplate,
  renderTemplate,
  logNotif,
  getCelularCliente,
  enviarZapCliente,
  getNomeCliente,
  enviarBoasVindas,
  enviarApresentacaoClube,
  notificarCadastro,
  notificarResgate,
  notificarFaturaPagaComPontos,
  isPrimeiroLogin,
};
