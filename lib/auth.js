'use strict';

function requireAuth(req, res, next) {
  if (!req.session.cliente) {
    return res.status(401).json({ error: 'Não autorizado. Faça login.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.adminLogado) return res.status(401).json({ error: 'Não autorizado.' });
  next();
}

module.exports = { requireAuth, requireAdmin };
