/** Configuração central (.env + constantes do servidor). */
const PORT = parseInt(process.env.PORT, 10) || 3000;
const MK_URL = process.env.MK_AUTH_URL;
const MK_ID = process.env.MK_CLIENT_ID;
const MK_SECRET = process.env.MK_CLIENT_SECRET;

const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_PUBKEY = process.env.MP_PUBLIC_KEY;
/** Segredo do webhook MP (Painel MP → Webhooks → Chave secreta). Sem ele as assinaturas não são validadas. */
const MP_WEBHOOK_SECRET = (process.env.MP_WEBHOOK_SECRET || '').trim();
const MP_BASE = 'https://api.mercadopago.com';
/** URL pública do portal (WhatsApp, Mercado Pago back_url/webhook se .env vier vazio ou inválido). */
const LEMON_PORTAL_PUBLIC = 'https://lemontechnology.com.br';
const MP_PIX_EXPIRATION_MIN = parseInt(process.env.MP_PIX_EXPIRATION_MIN, 10) || 30;
const MP_JOB_INTERVAL_MS = 30_000;
const MP_JOB_MAX_ATTEMPTS = Math.ceil(((MP_PIX_EXPIRATION_MIN + 3) * 60_000) / MP_JOB_INTERVAL_MS);

/** MikroTik API: defina tudo no .env em produção (sem credenciais no código). */
const ROS_HOST = (process.env.MIKROTIK_HOST || '').trim();
const ROS_PORT = parseInt(process.env.MIKROTIK_PORT, 10) || 8728;
const ROS_USER = (process.env.MIKROTIK_USER || '').trim();
const ROS_PASS = process.env.MIKROTIK_PASS || '';

const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASS = process.env.ADMIN_PASS || '';

function mpAccessTokenEhTeste() {
  return String(MP_TOKEN || '').trim().startsWith('TEST-');
}
function mpPublicKeyEhTeste() {
  return String(MP_PUBKEY || '').trim().startsWith('TEST-');
}
function mpChavesMercadoPagoAlinhadas() {
  const p = String(MP_PUBKEY || '').trim();
  const t = String(MP_TOKEN || '').trim();
  if (!p || !t) return true;
  return mpPublicKeyEhTeste() === mpAccessTokenEhTeste();
}

function mpPortalOrigin() {
  let raw = String(process.env.PORTAL_URL || LEMON_PORTAL_PUBLIC)
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!raw || /^(undefined|null)$/i.test(raw)) {
    return LEMON_PORTAL_PUBLIC;
  }
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    if (!u.hostname) throw new Error('sem host');
    return `${u.protocol}//${u.host}`;
  } catch (e) {
    console.warn('[MP] PORTAL_URL inválido (“%s”), usando %s', process.env.PORTAL_URL, LEMON_PORTAL_PUBLIC);
    return LEMON_PORTAL_PUBLIC;
  }
}

module.exports = {
  PORT,
  MK_URL,
  MK_ID,
  MK_SECRET,
  MP_TOKEN,
  MP_PUBKEY,
  MP_WEBHOOK_SECRET,
  MP_BASE,
  LEMON_PORTAL_PUBLIC,
  MP_PIX_EXPIRATION_MIN,
  MP_JOB_INTERVAL_MS,
  MP_JOB_MAX_ATTEMPTS,
  ROS_HOST,
  ROS_PORT,
  ROS_USER,
  ROS_PASS,
  ADMIN_USER,
  ADMIN_PASS,
  mpAccessTokenEhTeste,
  mpPublicKeyEhTeste,
  mpChavesMercadoPagoAlinhadas,
  mpPortalOrigin,
};
