require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');

const config = require('./lib/config');
const { sqliteDb } = require('./lib/database');
const { startPushFaturaReminderJob } = require('./lib/push-fatura-reminders');
const { startZapFaturaReminderJob }  = require('./lib/zap-fatura-reminders');

const { registerPortalRoutes }    = require('./routes/portal');
const { registerClubeRoutes }     = require('./routes/clube');
const { registerCarteiraRoutes }  = require('./routes/carteira');
const { registerSpeedtestRoutes } = require('./routes/speedtest');
const { registerAdminRoutes }     = require('./routes/admin');
const { registerAdminNotifRoutes }= require('./routes/admin-notif');
const { registerMercadoPagoRoutes, startMercadoPagoPendingJob } = require('./routes/mercadopago');
const { registerWatchBrasilRoutes } = require('./routes/watch-brasil');

const { concederPontosMP } = require('./lib/clube');
const { notificarFaturaPagaComPontos } = require('./lib/whatsapp');
const { getJWT } = require('./lib/mk-api');

const { PORT, MK_URL, MP_TOKEN, MP_PUBKEY, mpChavesMercadoPagoAlinhadas, mpAccessTokenEhTeste } = config;

const app = express();

// Habilita trust proxy se TRUST_PROXY=1 no .env (necessário atrás de nginx/Caddy/ngrok em HTTPS)
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
  console.log('[Sessão] trust proxy ativado (TRUST_PROXY=1).');
}

const SESSION_SECRET =
  String(process.env.SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
if (!String(process.env.SESSION_SECRET || '').trim()) {
  console.warn('[Sessão] SESSION_SECRET ausente no .env — usando segredo aleatório (sessões invalidam ao reiniciar).');
}

// Secure no cookie só quando o pedido é HTTPS (req.secure). Com TRUST_PROXY=1 o Express
// usa X-Forwarded-Proto — ngrok/proxy HTTPS → sessão grava cookie Secure; http://localhost → não.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: (req) => ({
    secure: Boolean(req.secure),
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  }),
}));

// ── Registro de rotas ──────────────────────────────────────────────────────

registerPortalRoutes(app);
registerClubeRoutes(app);
registerCarteiraRoutes(app);
registerSpeedtestRoutes(app);
registerAdminRoutes(app);
registerAdminNotifRoutes(app);

registerWatchBrasilRoutes(app, {
  requireAuth:  require('./lib/auth').requireAuth,
  requireAdmin: require('./lib/auth').requireAdmin,
});

registerMercadoPagoRoutes(app, {
  requireAuth: require('./lib/auth').requireAuth,
  concederPontosMP,
  notificarFaturaPagaComPontos,
});

// ── Estáticos e SPA fallback ───────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  if (req.path.startsWith('/portal/')) {
    return res.status(404).type('application/json').json({
      error: 'Rota não encontrada neste processo Node.',
      path: req.path,
    });
  }
  next();
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Startup ────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🍋 Lemon Portal rodando em http://localhost:${PORT}`);
  if (MP_TOKEN && MP_PUBKEY && !mpChavesMercadoPagoAlinhadas()) {
    console.warn(
      '[MP] ⚠️  Public Key e Access Token misturam sandbox (TEST-) e produção (APP_USR). Cartão na carteira e pagamentos no portal vão falhar até alinhar o .env.'
    );
  } else if (MP_TOKEN && MP_PUBKEY) {
    console.log(`[MP] Ambiente: ${mpAccessTokenEhTeste() ? 'SANDBOX (cartões de teste)' : 'PRODUÇÃO (cartão real)'}`);
  }
});

startMercadoPagoPendingJob(concederPontosMP, notificarFaturaPagaComPontos);
startPushFaturaReminderJob(getJWT, MK_URL);
startZapFaturaReminderJob(getJWT, MK_URL);
