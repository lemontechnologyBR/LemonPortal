'use strict';

const axios = require('axios');
const { sqliteDb } = require('./database');
const pushLib = require('./push');
const { getPrefsForLogin } = require('./push-notif-prefs');

function ymdSaoPaulo(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Calcula diferença de dias entre data de vencimento e hoje,
 * usando exclusivamente o fuso horário de São Paulo nos dois lados
 * para evitar divergência entre o digest (ymdSaoPaulo) e o cálculo.
 */
function daysBetweenDueAndToday(dueStr) {
  const due = new Date(dueStr);
  if (Number.isNaN(due.getTime())) return null;
  const dueYmd = ymdSaoPaulo(due);
  const todayYmd = ymdSaoPaulo();
  // Interpreta ambas como datas locais puras (sem TZ) para diferença em dias
  const dueMs = new Date(dueYmd + 'T00:00:00').getTime();
  const todayMs = new Date(todayYmd + 'T00:00:00').getTime();
  return Math.round((dueMs - todayMs) / 86400000);
}

function titulosFromAbertoBody(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.titulos)) return data.titulos;
  return [];
}

function wasDigestSent(login, day) {
  return !!sqliteDb.prepare('SELECT 1 FROM push_fatura_digest WHERE login = ? AND day = ?').get(login, day);
}

function markDigestSent(login, day) {
  sqliteDb.prepare('INSERT OR IGNORE INTO push_fatura_digest (login, day) VALUES (?, ?)').run(login, day);
}

async function runTick(getJWT, MK_URL) {
  let token;
  try {
    token = await getJWT();
  } catch (e) {
    console.warn('[Push fatura] JWT MK indisponível:', e.message || e);
    return;
  }

  const today = ymdSaoPaulo();
  const rows = sqliteDb.prepare('SELECT DISTINCT login FROM push_subscriptions').all();

  for (const { login } of rows) {
    try {
      if (!getPrefsForLogin(login).faturaVencimento) continue;
      if (wasDigestSent(login, today)) continue;

      let cli;
      try {
        const r = await axios.get(`${MK_URL}/cliente/show/${encodeURIComponent(login)}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 20000,
        });
        cli = r.data;
      } catch (e) {
        console.warn(`[Push fatura] Erro ao buscar cliente "${login}" no MK:`, e.message || e);
        continue;
      }
      const cpfRaw = cli?.cpf_cnpj || cli?.cpfcnpj || login;
      const cpf = String(cpfRaw || '').replace(/\D/g, '') || String(login).replace(/\D/g, '') || login;

      let titulos = [];
      try {
        const ab = await axios.get(`${MK_URL}/titulo/aberto/${cpf}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 20000,
        });
        titulos = titulosFromAbertoBody(ab.data);
      } catch (e) {
        console.warn(`[Push fatura] Erro ao buscar títulos de "${login}" (CPF: ${cpf}) no MK:`, e.message || e);
        continue;
      }
      if (!titulos.length) continue;

      const sorted = titulos.filter((t) => t && t.datavenc).sort((a, b) => new Date(a.datavenc) - new Date(b.datavenc));
      const next = sorted[0];

      let body;
      // Títulos sem datavenc: aviso genérico de faturas em aberto
      if (!next) {
        body = `Você tem ${titulos.length} fatura(s) em aberto. Acesse o portal para ver valores e vencimentos.`;
      } else {
        const days = daysBetweenDueAndToday(next.datavenc);
        if (days === null) continue;
        // Janela alinhada com o banner do dashboard: 14 dias antes até 14 dias após
        if (days > 14 || days < -14) continue;

        if (days < 0) body = `Tem fatura em aberto (venceu há ${-days} dia(s)). Toque para ver no portal.`;
        else if (days === 0) body = 'Sua fatura vence hoje. Evite multas — acesse o portal para pagar.';
        else if (days === 1) body = 'Sua fatura vence amanhã. Confira valores e formas de pagamento no portal.';
        else if (days <= 7) body = `Sua fatura vence em ${days} dias. Confira no portal.`;
        else body = `Seu próximo vencimento é em ${days} dias. Consulte suas faturas no portal.`;
      }

      const payload = {
        title: 'Lemon — Faturas',
        body,
        url: '/?open=faturas',
        kind: 'fatura',
      };

      const out = await pushLib.sendPushToLogin(login, payload, { kind: 'fatura' });
      // Marca digest se enviou com sucesso OU se houve erros técnicos (não 404/410).
      // Evita chamadas repetidas ao MK no mesmo dia por falhas transitórias de push.
      // Só não marca se as subscrições foram removidas (usuário pode re-inscrever mais tarde).
      if (out.ok > 0 || out.err > 0) markDigestSent(login, today);
    } catch (e) {
      console.warn('[Push fatura] login', login, e.message || e);
    }
  }
}

function startPushFaturaReminderJob(getJWT, MK_URL) {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setTimeout(() => {
    runTick(getJWT, MK_URL).catch((e) => console.warn('[Push fatura] tick:', e.message || e));
  }, 120_000);
  setInterval(() => {
    runTick(getJWT, MK_URL).catch((e) => console.warn('[Push fatura] tick:', e.message || e));
  }, SIX_HOURS);
}

module.exports = { startPushFaturaReminderJob, runTick };
