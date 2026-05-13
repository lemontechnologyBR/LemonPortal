'use strict';
const crypto = require('crypto');

const ST_CHUNK_SIZE = 131072; // 128KB por chunk
const speedChunk = crypto.randomBytes(ST_CHUNK_SIZE);

// Limite máximo de MB por pedido de download (proteção contra abuso)
const ST_MAX_DL_MB = 150;
// Limite máximo de bytes aceitos num upload (1 GB)
const ST_MAX_UL_BYTES = 1024 * 1024 * 1024;
// Timeout máximo por upload (120 s)
const ST_UPLOAD_TIMEOUT_MS = 120_000;

// Rate limit simples em memória por IP:
//   no máximo ST_RL_MAX pedidos por janela ST_RL_WINDOW_MS por endpoint pesado (download/upload).
const ST_RL_WINDOW_MS = 60_000; // 1 minuto
const ST_RL_MAX_DL   = 10;      // 10 downloads por minuto por IP
const ST_RL_MAX_UL   = 10;      // 10 uploads por minuto por IP

const _rlDl = new Map(); // ip → { count, resetAt }
const _rlUl = new Map();

function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function checkRateLimit(map, max, ip) {
  const now = Date.now();
  let entry = map.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + ST_RL_WINDOW_MS };
    map.set(ip, entry);
  }
  entry.count++;
  return entry.count <= max;
}

// Limpa entradas expiradas periodicamente para não vazar memória
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rlDl) if (now > v.resetAt) _rlDl.delete(k);
  for (const [k, v] of _rlUl) if (now > v.resetAt) _rlUl.delete(k);
}, ST_RL_WINDOW_MS);

function registerSpeedtestRoutes(app) {
  app.get('/speedtest/ping', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache');
    res.json({ ok: true, ts: Date.now() });
  });

  app.get('/speedtest/download', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(_rlDl, ST_RL_MAX_DL, ip)) {
      return res.status(429).json({ error: 'Muitas requisições. Aguarde um momento.' });
    }

    const mb = Math.min(parseInt(req.query.mb) || 10, ST_MAX_DL_MB);
    const total = mb * 1024 * 1024;
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': total,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    let sent = 0;
    function send() {
      if (sent >= total) { res.end(); return; }
      const size = Math.min(ST_CHUNK_SIZE, total - sent);
      const ok = res.write(speedChunk.slice(0, size));
      sent += size;
      if (ok) setImmediate(send);
      else res.once('drain', send);
    }
    send();
  });

  app.post('/speedtest/upload', (req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(_rlUl, ST_RL_MAX_UL, ip)) {
      req.resume(); // descarta o body
      return res.status(429).json({ error: 'Muitas requisições. Aguarde um momento.' });
    }

    const t0 = Date.now();
    let received = 0;
    let aborted = false;

    const timeout = setTimeout(() => {
      if (aborted) return;
      aborted = true;
      req.destroy();
      if (!res.headersSent) {
        res.status(408).json({ error: 'Timeout no upload.' });
      }
    }, ST_UPLOAD_TIMEOUT_MS);

    req.on('data', chunk => {
      received += chunk.length;
      if (received > ST_MAX_UL_BYTES && !aborted) {
        aborted = true;
        clearTimeout(timeout);
        req.destroy();
        if (!res.headersSent) {
          res.status(413).json({ error: 'Upload excede o limite permitido.' });
        }
      }
    });

    req.on('end', () => {
      if (aborted) return;
      clearTimeout(timeout);
      res.set('Cache-Control', 'no-store');
      res.json({ received, elapsed: Date.now() - t0 });
    });

    req.on('error', () => {
      clearTimeout(timeout);
    });
  });
}

module.exports = { registerSpeedtestRoutes };
