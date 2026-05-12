'use strict';
const { sqliteDb } = require('./database');

function readPortalAvisosDb() {
  return sqliteDb
    .prepare(
      `SELECT mensagem, tipo, link_text, link_href FROM portal_avisos ORDER BY ordem ASC, id ASC LIMIT 20`
    )
    .all()
    .map((r) => ({
      mensagem: r.mensagem,
      tipo: r.tipo,
      linkText: r.link_text || '',
      linkHref: r.link_href || '',
    }));
}

function replacePortalAvisosDb(rows) {
  const del = sqliteDb.prepare('DELETE FROM portal_avisos');
  const ins = sqliteDb.prepare(
    `INSERT INTO portal_avisos (ordem, mensagem, tipo, link_text, link_href) VALUES (?,?,?,?,?)`
  );
  const run = sqliteDb.transaction((list) => {
    del.run();
    list.forEach((row, i) => {
      ins.run(i, row.mensagem, row.tipo, row.linkText || null, row.linkHref || null);
    });
  });
  run(rows);
}

function sanitizePortalAvisoItem(raw) {
  const mensagem = String(raw?.mensagem || '').trim().slice(0, 2000);
  if (!mensagem) return null;
  const tipo = ['info', 'success', 'warning'].includes(raw?.tipo) ? raw.tipo : 'info';
  let linkText = String(raw?.linkText || '').trim().slice(0, 120);
  let linkHref = String(raw?.linkHref || '').trim().slice(0, 500);
  if (!/^https?:\/\//i.test(linkHref)) {
    linkHref = '';
    linkText = '';
  }
  return { mensagem, tipo, linkText, linkHref };
}

module.exports = { readPortalAvisosDb, replacePortalAvisosDb, sanitizePortalAvisoItem };
