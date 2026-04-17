'use strict';

const { sqliteDb } = require('./database');

const DEFAULTS = Object.freeze({
  faturaVencimento: true,
  avisosLemon: true,
});

function mergePrefs(obj) {
  const o = { faturaVencimento: DEFAULTS.faturaVencimento, avisosLemon: DEFAULTS.avisosLemon };
  if (obj && typeof obj === 'object') {
    if (typeof obj.faturaVencimento === 'boolean') o.faturaVencimento = obj.faturaVencimento;
    if (typeof obj.avisosLemon === 'boolean') o.avisosLemon = obj.avisosLemon;
  }
  return o;
}

function parsePushNotifPrefsJson(raw) {
  if (raw == null || raw === '') return { ...DEFAULTS };
  try {
    return mergePrefs(JSON.parse(String(raw)));
  } catch {
    return { ...DEFAULTS };
  }
}

function getPrefsForLogin(login) {
  const row = sqliteDb.prepare('SELECT push_notif_prefs FROM clients WHERE login = ?').get(login);
  if (!row) return { ...DEFAULTS };
  return parsePushNotifPrefsJson(row.push_notif_prefs);
}

module.exports = {
  DEFAULTS,
  mergePrefs,
  parsePushNotifPrefsJson,
  getPrefsForLogin,
};
