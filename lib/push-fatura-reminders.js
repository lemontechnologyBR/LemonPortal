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

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetweenDueAndToday(dueStr) {
  const due = new Date(dueStr);
  if (Number.isNaN(due.getTime())) return null;
  const ms = startOfLocalDay(due) - startOfLocalDay(new Date());
  return Math.round(ms / 86400000);
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
      } catch {
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
      } catch {
        continue;
      }
      if (!titulos.length) continue;

      const sorted = titulos.filter((t) => t && t.datavenc).sort((a, b) => new Date(a.datavenc) - new Date(b.datavenc));
      const next = sorted[0];
      if (!next) continue;

      const days = daysBetweenDueAndToday(next.datavenc);
      if (days === null) continue;
      if (days > 7 || days < -14) continue;

      let body;
      if (days < 0) body = `Tem fatura em aberto (venceu há ${-days} dia(s)). Toque para ver no portal.`;
      else if (days === 0) body = 'Sua fatura vence hoje. Evite multas — acesse o portal para pagar.';
      else if (days === 1) body = 'Sua fatura vence amanhã. Confira valores e formas de pagamento no portal.';
      else body = `Próximo vencimento em ${days} dias. Consulte suas faturas no portal.`;

      const payload = {
        title: 'Lemon — Faturas',
        body,
        url: '/?open=faturas',
      };

      const out = await pushLib.sendPushToLogin(login, payload, { kind: 'fatura' });
      if (out.ok > 0) markDigestSent(login, today);
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
