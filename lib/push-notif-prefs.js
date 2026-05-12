'use strict';

const { sqliteDb } = require('./database');

const DEFAULTS = Object.freeze({
  faturaVencimento:   true,   // Push: lembrete de vencimento
  avisosLemon:        true,   // Push: avisos gerais da equipe
  zapFaturaVencimento: false,  // WhatsApp: lembrete de vencimento (opt-in)
});

function mergePrefs(obj) {
  const o = {
    faturaVencimento:    DEFAULTS.faturaVencimento,
    avisosLemon:         DEFAULTS.avisosLemon,
    zapFaturaVencimento: DEFAULTS.zapFaturaVencimento,
  };
  if (obj && typeof obj === 'object') {
    if (typeof obj.faturaVencimento   === 'boolean') o.faturaVencimento   = obj.faturaVencimento;
    if (typeof obj.avisosLemon        === 'boolean') o.avisosLemon        = obj.avisosLemon;
    if (typeof obj.zapFaturaVencimento === 'boolean') o.zapFaturaVencimento = obj.zapFaturaVencimento;
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
