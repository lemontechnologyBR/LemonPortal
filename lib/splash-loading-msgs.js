'use strict';

const { sqliteDb } = require('./database');

const FALLBACK_MENSAGENS = [
  'Carregando…',
  'Preparando o seu portal…',
  'Sincronizando dados…',
  'Quase lá…',
];

const MAX_ITENS = 25;
const MAX_TEXTO_LEN = 180;

function sanitizeTexto(raw) {
  let s = String(raw == null ? '' : raw)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, MAX_TEXTO_LEN);
  return s || null;
}

/** Lista para o painel admin (só o que está na base). */
function readSplashLoadingMensagensDb() {
  return sqliteDb
    .prepare('SELECT texto FROM splash_loading_mensagens ORDER BY ordem ASC, id ASC')
    .all()
    .map((r) => String(r.texto || '').trim())
    .filter(Boolean)
    .slice(0, MAX_ITENS);
}

/** Resposta pública: se a base estiver vazia, usa fallbacks. */
function readSplashLoadingMensagensPublic() {
  const fromDb = readSplashLoadingMensagensDb();
  if (fromDb.length) return fromDb;
  return FALLBACK_MENSAGENS.slice();
}

function replaceSplashLoadingMensagens(arr) {
  const list = Array.isArray(arr) ? arr : [];
  const sanitized = [];
  for (let i = 0; i < list.length && sanitized.length < MAX_ITENS; i++) {
    const t = sanitizeTexto(list[i]);
    if (t) sanitized.push(t);
  }
  const del = sqliteDb.prepare('DELETE FROM splash_loading_mensagens');
  const ins = sqliteDb.prepare(
    'INSERT INTO splash_loading_mensagens (ordem, texto) VALUES (?,?)'
  );
  const run = sqliteDb.transaction((rows) => {
    del.run();
    rows.forEach((texto, ordem) => ins.run(ordem, texto));
  });
  run(sanitized);
}

module.exports = {
  readSplashLoadingMensagensDb,
  readSplashLoadingMensagensPublic,
  replaceSplashLoadingMensagens,
  sanitizeTexto,
  FALLBACK_MENSAGENS,
};
