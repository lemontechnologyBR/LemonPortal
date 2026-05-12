'use strict';

/**
 * Job de lembretes de fatura via WhatsApp (Evolution API).
 * Roda a cada 6h; envia no máximo 1 mensagem por login por dia.
 * Só age em logins com preferência `zapFaturaVencimento = true` (opt-in).
 * Janela: 7 dias antes até 14 dias após o vencimento.
 */

const axios = require('axios');
const { sqliteDb } = require('./database');
const { getPrefsForLogin } = require('./push-notif-prefs');
const { getTemplate, renderTemplate, enviarZapCliente } = require('./whatsapp');
const config = require('./config');

const PORTAL_URL = (process.env.PORTAL_URL || '').trim().replace(/^['"]|['"]$/g, '')
  || config.LEMON_PORTAL_PUBLIC
  || '';

// ── Helpers de data (mesma lógica do push job — fuso São Paulo) ──────────────

function ymdSaoPaulo(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function daysBetweenDueAndToday(dueStr) {
  const due = new Date(dueStr);
  if (Number.isNaN(due.getTime())) return null;
  const dueMs  = new Date(ymdSaoPaulo(due) + 'T00:00:00').getTime();
  const todayMs = new Date(ymdSaoPaulo()   + 'T00:00:00').getTime();
  return Math.round((dueMs - todayMs) / 86400000);
}

function titulosFromAbertoBody(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.titulos)) return data.titulos;
  return [];
}

// ── Digest diário ─────────────────────────────────────────────────────────────

function wasDigestSent(login, day) {
  return !!sqliteDb
    .prepare('SELECT 1 FROM zap_fatura_digest WHERE login = ? AND day = ?')
    .get(login, day);
}

function markDigestSent(login, day) {
  sqliteDb
    .prepare('INSERT OR IGNORE INTO zap_fatura_digest (login, day) VALUES (?, ?)')
    .run(login, day);
}

// ── Tick principal ────────────────────────────────────────────────────────────

async function runTick(getJWT, MK_URL) {
  const tpl = getTemplate('fatura_vencimento');
  if (!tpl || !tpl.ativo) {
    // Template desativado = job pausado (admin pode ligar/desligar)
    return;
  }

  let token;
  try {
    token = await getJWT();
  } catch (e) {
    console.warn('[Zap fatura] JWT MK indisponível:', e.message || e);
    return;
  }

  const today = ymdSaoPaulo();
  // Itera sobre todos os clientes cadastrados no portal
  const rows = sqliteDb.prepare('SELECT login FROM clients').all();

  for (const { login } of rows) {
    try {
      if (!getPrefsForLogin(login).zapFaturaVencimento) continue;
      if (wasDigestSent(login, today)) continue;

      // Busca dados do cliente no MK
      let cli;
      try {
        const r = await axios.get(`${MK_URL}/cliente/show/${encodeURIComponent(login)}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 20000,
        });
        cli = r.data;
      } catch (e) {
        const status = e.response?.status;
        if (status === 404) {
          // Cliente removido do MK — marca digest para não tentar novamente hoje
          markDigestSent(login, today);
          console.warn(`[Zap fatura] Cliente "${login}" não encontrado no MK — ignorando`);
        } else {
          console.warn(`[Zap fatura] Erro ao buscar cliente "${login}" no MK:`, e.message || e);
        }
        continue;
      }

      const cpfRaw = cli?.cpf_cnpj || cli?.cpfcnpj || login;
      const cpf = String(cpfRaw || '').replace(/\D/g, '') || String(login).replace(/\D/g, '') || login;
      const nome = cli?.nome || login;

      // Busca títulos em aberto
      let titulos = [];
      try {
        const ab = await axios.get(`${MK_URL}/titulo/aberto/${cpf}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 20000,
        });
        titulos = titulosFromAbertoBody(ab.data);
      } catch (e) {
        console.warn(`[Zap fatura] Erro ao buscar títulos de "${login}" (CPF: ${cpf}):`, e.message || e);
        continue;
      }

      if (!titulos.length) continue;

      // Ordena pelo vencimento mais próximo
      const sorted = titulos
        .filter((t) => t && t.datavenc)
        .sort((a, b) => new Date(a.datavenc) - new Date(b.datavenc));

      let situacao, datavenc, valor;

      if (!sorted.length) {
        // Títulos sem datavenc: aviso genérico
        situacao = `${titulos.length} fatura(s) em aberto`;
        datavenc = '—';
        valor    = '—';
      } else {
        const next = sorted[0];
        const days = daysBetweenDueAndToday(next.datavenc);
        if (days === null) continue;

        // Janela: 7 dias antes até 14 dias após vencimento
        if (days > 7 || days < -14) continue;

        datavenc = new Date(next.datavenc + 'T00:00:00').toLocaleDateString('pt-BR');
        const valorNum = parseFloat(next.valor || next.valor_original || 0);
        valor = valorNum > 0
          ? valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
          : '—';

        if (days < 0)      situacao = `em atraso (venceu há ${-days} dia(s))`;
        else if (days === 0) situacao = 'vence hoje';
        else if (days === 1) situacao = 'vence amanhã';
        else                situacao = `vence em ${days} dias`;
      }

      const msg = renderTemplate(tpl.mensagem, {
        nome, login, situacao, datavenc, valor, portal_url: PORTAL_URL,
      });

      const sent = await enviarZapCliente(login, msg);
      // Marca digest independente do resultado para não reenviar no mesmo dia
      markDigestSent(login, today);
      if (sent) {
        console.log(`[Zap fatura] ✅ Lembrete enviado para "${login}" (${situacao})`);
      }
    } catch (e) {
      console.warn('[Zap fatura] Erro para login', login, '—', e.message || e);
    }
  }
}

// ── Registro do job ───────────────────────────────────────────────────────────

function startZapFaturaReminderJob(getJWT, MK_URL) {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  // Inicia 150s após o servidor subir (30s depois do push job em 120s)
  setTimeout(() => {
    runTick(getJWT, MK_URL).catch((e) => console.warn('[Zap fatura] tick:', e.message || e));
  }, 150_000);
  setInterval(() => {
    runTick(getJWT, MK_URL).catch((e) => console.warn('[Zap fatura] tick:', e.message || e));
  }, SIX_HOURS);
}

module.exports = { startZapFaturaReminderJob, runTick };
