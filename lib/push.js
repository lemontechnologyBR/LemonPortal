'use strict';

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { sqliteDb } = require('./database');
const { getPrefsForLogin } = require('./push-notif-prefs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');

function loadVapidPair() {
  const pub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const j = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      if (j.publicKey && j.privateKey) return j;
    }
  } catch (_) {}
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const keys = webpush.generateVAPIDKeys();
  const pair = { publicKey: keys.publicKey, privateKey: keys.privateKey };
  fs.writeFileSync(VAPID_FILE, JSON.stringify(pair, null, 2), 'utf8');
  console.log(
    '[Push] Par VAPID gerado em data/vapid.json — em produção define VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no .env.'
  );
  return pair;
}

let _vapidConfigured = false;
function ensureVapid() {
  if (_vapidConfigured) return;
  const pair = loadVapidPair();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:contato@lemontechnology.com.br').trim();
  webpush.setVapidDetails(subject, pair.publicKey, pair.privateKey);
  _vapidConfigured = true;
}

function getPublicVapidKey() {
  return loadVapidPair().publicKey;
}

function savePushSubscription(login, sub, userAgent) {
  const endpoint = String(sub.endpoint || '').trim();
  const p256dh = String(sub.keys?.p256dh || '').trim();
  const auth = String(sub.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) throw new Error('Subscription incompleta');
  const ua = String(userAgent || '').slice(0, 400);
  sqliteDb
    .prepare(
      `INSERT INTO push_subscriptions (login, endpoint, p256dh, auth, user_agent, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET
         login = excluded.login,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         updated_at = datetime('now')`
    )
    .run(login, endpoint, p256dh, auth, ua);
}

function removePushSubscription(login, endpoint) {
  if (endpoint) {
    sqliteDb.prepare('DELETE FROM push_subscriptions WHERE login = ? AND endpoint = ?').run(login, endpoint);
  } else {
    sqliteDb.prepare('DELETE FROM push_subscriptions WHERE login = ?').run(login);
  }
}

function _subscriptionFromRow(row) {
  return { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
}

async function sendPushPayload(subscription, payloadObj) {
  ensureVapid();
  const body = JSON.stringify(payloadObj);
  await webpush.sendNotification(subscription, body, { TTL: 86_400, urgency: 'normal' });
}

async function sendPushToLogin(login, payload, opts = {}) {
  if (opts.kind === 'fatura' && !getPrefsForLogin(login).faturaVencimento) {
    return { ok: 0, skipped: 1, removed: 0, err: 0 };
  }
  ensureVapid();
  const rows = sqliteDb.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE login = ?').all(login);
  const out = { ok: 0, removed: 0, err: 0 };
  for (const row of rows) {
    try {
      await sendPushPayload(_subscriptionFromRow(row), payload);
      out.ok += 1;
    } catch (e) {
      const code = e.statusCode;
      if (code === 404 || code === 410) {
        sqliteDb.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
        out.removed += 1;
      } else {
        out.err += 1;
      }
    }
  }
  return out;
}

async function sendPushBroadcast(payload, onlyLogin = null, options = {}) {
  const filterAvisos = options.filterAvisosLemon === true;

  if (onlyLogin) {
    if (filterAvisos && !getPrefsForLogin(onlyLogin).avisosLemon) {
      return { ok: 0, skipped: 1, removed: 0, err: 0 };
    }
    return sendPushToLogin(onlyLogin, payload);
  }

  if (filterAvisos) {
    const logins = sqliteDb.prepare('SELECT DISTINCT login FROM push_subscriptions').all();
    const out = { ok: 0, skipped: 0, removed: 0, err: 0 };
    for (const { login } of logins) {
      if (!getPrefsForLogin(login).avisosLemon) {
        out.skipped += 1;
        continue;
      }
      const r = await sendPushToLogin(login, payload);
      out.ok += r.ok;
      out.skipped += r.skipped || 0;
      out.removed += r.removed;
      out.err += r.err;
    }
    return out;
  }

  ensureVapid();
  const rows = sqliteDb.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all();
  const out = { ok: 0, removed: 0, err: 0 };
  for (const row of rows) {
    try {
      await sendPushPayload(_subscriptionFromRow(row), payload);
      out.ok += 1;
    } catch (e) {
      const code = e.statusCode;
      if (code === 404 || code === 410) {
        sqliteDb.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
        out.removed += 1;
      } else {
        out.err += 1;
      }
    }
  }
  return out;
}

module.exports = {
  getPublicVapidKey,
  savePushSubscription,
  removePushSubscription,
  sendPushPayload,
  sendPushToLogin,
  sendPushBroadcast,
};
