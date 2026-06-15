/**
 * Cliente da API Watch Brasil (streaming).
 * Documentação: https://apiweb.watch.tv.br/
 *
 * Autenticação: OAuth (code → token) ou WATCH_ACCESS_TOKEN no .env.
 * Credenciais: WATCH_CLIENT_ID, WATCH_CLIENT_SECRET, WATCH_REDIRECT_URI (callback registado na Watch).
 * Opcional: WATCH_CLIENT_SECRET_JSON = caminho ao ficheiro client_secret.json entregue pela Watch.
 * Opcional: WATCH_CODE_EXCHANGE_SECRET + POST /portal/watch/oauth/exchange-code (ex.: n8n após webhook).
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { sqliteDb } = require('./database');
const { mpPortalOrigin } = require('./config');
const watchPacotes = require('./watch-pacotes');

/** @type {null|false|object} */
let _cachedJsonCreds = null;

function readClientSecretJson() {
  if (_cachedJsonCreds !== null) return _cachedJsonCreds === false ? null : _cachedJsonCreds;
  const rel = String(process.env.WATCH_CLIENT_SECRET_JSON || '').trim();
  if (!rel) {
    _cachedJsonCreds = false;
    return null;
  }
  try {
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    const raw = fs.readFileSync(abs, 'utf8');
    const j = JSON.parse(raw);
    const p = j.pParams || j;
    _cachedJsonCreds = {
      client_id: String(p.client_id || '').trim(),
      client_secret: String(p.client_secret || '').trim(),
      redirect_uri: String(p.redirect_uri || '').trim(),
      auth_uri: String(p.auth_uri || '').trim(),
      token_uri: String(p.token_uri || '').trim(),
      base_uri: String(p.base_uri || '').trim(),
    };
  } catch (e) {
    console.warn('[Watch] WATCH_CLIENT_SECRET_JSON inválido:', e.message);
    _cachedJsonCreds = false;
    return null;
  }
  return _cachedJsonCreds;
}

function oauthClientId() {
  const e = String(process.env.WATCH_CLIENT_ID || '').trim();
  if (e) return e;
  const j = readClientSecretJson();
  return j && j.client_id ? j.client_id : '';
}

function oauthClientSecret() {
  const e = String(process.env.WATCH_CLIENT_SECRET || '').trim();
  if (e) return e;
  const j = readClientSecretJson();
  return j && j.client_secret ? j.client_secret : '';
}

function baseUri() {
  const e = String(process.env.WATCH_BASE_URI || '').trim();
  if (e) return e.replace(/\/$/, '');
  const j = readClientSecretJson();
  if (j && j.base_uri) return String(j.base_uri).replace(/\/$/, '');
  return 'https://apiweb.watch.tv.br'.replace(/\/$/, '');
}

function isEnabled() {
  const off = String(process.env.WATCH_ENABLED || '').trim();
  if (off === '0' || off.toLowerCase() === 'false') return false;
  if (String(process.env.WATCH_ACCESS_TOKEN || '').trim()) return true;
  if (hasStoredToken()) return true;
  return !!(oauthClientId() && oauthClientSecret());
}

/**
 * URL de retorno registada na Watch (auth POST redirect_url e, se a API exigir, troca do code).
 * Ordem: WATCH_REDIRECT_URI → redirect_uri do JSON → callback público do portal.
 */
function redirectUri() {
  const u = String(process.env.WATCH_REDIRECT_URI || '').trim();
  if (u) return u;
  const j = readClientSecretJson();
  if (j && j.redirect_uri) return j.redirect_uri;
  return `${mpPortalOrigin()}/portal/watch/oauth/callback`;
}

function pacotePadrao() {
  return String(process.env.WATCH_PACOTE_ID || '').trim();
}

function pacoteParaCliente(cliente) {
  const forced = pacotePadrao();
  if (forced) return forced;
  return String(watchPacotes.resolvePacoteId(cliente || {}) || '').trim();
}

function authUriResolved() {
  const e = String(process.env.WATCH_AUTH_URI || '').trim();
  if (e) return e;
  const j = readClientSecretJson();
  if (j && j.auth_uri) return j.auth_uri;
  return `${baseUri()}/watch/v1/oauth/authenticate`;
}

function tokenUriResolved() {
  const e = String(process.env.WATCH_TOKEN_URI || '').trim();
  if (e) return e;
  const j = readClientSecretJson();
  if (j && j.token_uri) return j.token_uri;
  return `${baseUri()}/oauth/token`;
}

/** Campos seguros para o admin / diagnóstico (sem segredos). */
function getPublicConfig() {
  return {
    enabled: isEnabled(),
    baseUri: baseUri(),
    authUri: authUriResolved(),
    tokenUri: tokenUriResolved(),
    redirectUri: redirectUri(),
    pacoteConfigured: !!pacotePadrao() || watchPacotes.temConfigPacote(),
    hasStoredToken: hasStoredToken(),
    hasEnvToken: !!String(process.env.WATCH_ACCESS_TOKEN || '').trim(),
    oauthClientIdSet: !!oauthClientId(),
    codeExchangeEndpoint: String(process.env.WATCH_CODE_EXCHANGE_SECRET || '').trim()
      ? 'POST /portal/watch/oauth/exchange-code | POST /portal/watch/oauth/save-token (header X-Watch-Code-Secret)'
      : null,
  };
}

function hasStoredToken() {
  try {
    const row = sqliteDb.prepare('SELECT access_token FROM watch_oauth WHERE id = 1').get();
    return !!(row && row.access_token);
  } catch {
    return false;
  }
}

function saveToken(accessToken, raw = {}) {
  const at = String(accessToken || '').trim();
  if (!at) throw new Error('Token vazio');
  sqliteDb
    .prepare(`
    INSERT INTO watch_oauth (id, access_token, token_type, raw_json, updated_at)
    VALUES (1, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      token_type = excluded.token_type,
      raw_json = excluded.raw_json,
      updated_at = datetime('now')
  `)
    .run(at, String(raw.token_type || 'Bearer'), JSON.stringify(raw));
  console.log('[Watch] ✅ Token salvo! (%s) — %s…', raw.source || 'manual', at.slice(0, 30));
}

function getStoredToken() {
  const row = sqliteDb.prepare('SELECT access_token FROM watch_oauth WHERE id = 1').get();
  return row && row.access_token ? String(row.access_token).trim() : '';
}

function getAccessToken() {
  const envTok = String(process.env.WATCH_ACCESS_TOKEN || '').trim();
  if (envTok) return envTok;
  return getStoredToken();
}

function isTokenExpired(token) {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return true;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return false;
  }
}

let _refreshing = false;
let _tokenExpiradoEm = 0;

async function refreshTokenViaN8n() {
  const webhookUrl = String(process.env.WATCH_N8N_WEBHOOK_URL || '').trim();
  if (!webhookUrl) return false;
  if (_refreshing) return false;
  _refreshing = true;
  try {
    console.log('[Watch] Token expirado — chamando n8n para renovar…');
    await axios.get(webhookUrl, { timeout: 15_000, validateStatus: () => true });
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const fresh = getStoredToken();
      if (fresh && !isTokenExpired(fresh)) {
        console.log('[Watch] ✅ Token renovado via n8n!');
        return true;
      }
    }
    console.log('[Watch] ⚠️ Timeout esperando token novo do n8n.');
    return false;
  } catch (e) {
    console.log('[Watch] ⚠️ Erro ao chamar n8n:', e.message);
    return false;
  } finally {
    _refreshing = false;
  }
}

async function getValidAccessToken() {
  let token = getAccessToken();
  if (token && !isTokenExpired(token)) return token;
  const refreshed = await refreshTokenViaN8n();
  if (refreshed) return getAccessToken();
  const now = Date.now();
  if (now - _tokenExpiradoEm > 10 * 60 * 1000) {
    _tokenExpiradoEm = now;
    console.warn(
      '[Watch] ⚠️ Token expirado e renovação automática falhou. ' +
      'O admin precisa reautorizar manualmente em /admin/watch/oauth-form.'
    );
  }
  return token;
}

function pickAccessToken(data) {
  if (data == null) return '';
  if (typeof data === 'string') {
    try {
      return pickAccessToken(JSON.parse(data));
    } catch {
      return '';
    }
  }
  const d = data.data && typeof data.data === 'object' ? data.data : data;
  const direct = String(d.access_token || d.accessToken || '').trim();
  if (direct) return direct;
  const res = d.Result || d.result;
  if (Array.isArray(res) && res.length > 0) {
    return String(res[0].access_token || res[0].accessToken || '').trim();
  }
  if (res && typeof res === 'object' && !Array.isArray(res)) {
    return String(res.access_token || res.accessToken || '').trim();
  }
  return '';
}

function formatTokenError(data, status) {
  if (data == null) return `HTTP ${status}`;
  if (typeof data === 'string') return data.slice(0, 800);
  const msg =
    data.error_description ||
    data.error ||
    data.mensagem ||
    data.message ||
    data.msg ||
    (typeof data.errors === 'string' ? data.errors : '');
  if (msg) return String(msg);
  try {
    return JSON.stringify(data).slice(0, 800);
  } catch {
    return `HTTP ${status}`;
  }
}

/**
 * Troca o code pelo access_token (POST token_uri — ver documentação Watch).
 * Enviamos redirect_url igual ao passo Auth; se a API recusar, tenta só client_id + secret + code + grant_type.
 */
async function exchangeCodeForToken(code) {
  const c = String(code || '').trim();
  if (!c) throw new Error('Código OAuth ausente');

  const clientId = oauthClientId();
  const clientSecret = oauthClientSecret();
  const tokenUri = tokenUriResolved();
  const redir = redirectUri();
  const grantType = String(process.env.WATCH_TOKEN_GRANT_TYPE || 'authorization_code').trim();

  if (!clientId || !clientSecret) {
    throw new Error('WATCH_CLIENT_ID e WATCH_CLIENT_SECRET são obrigatórios (ou WATCH_CLIENT_SECRET_JSON)');
  }

  const attempts = [];

  const withRedirectUrl = new URLSearchParams();
  withRedirectUrl.set('client_id', clientId);
  withRedirectUrl.set('client_secret', clientSecret);
  withRedirectUrl.set('code', c);
  withRedirectUrl.set('grant_type', grantType);
  if (redir) {
    withRedirectUrl.set('redirect_url', redir);
  }
  attempts.push(withRedirectUrl);

  if (redir) {
    const minimal = new URLSearchParams();
    minimal.set('client_id', clientId);
    minimal.set('client_secret', clientSecret);
    minimal.set('code', c);
    minimal.set('grant_type', grantType);
    attempts.push(minimal);

    const withRedirectUri = new URLSearchParams();
    withRedirectUri.set('client_id', clientId);
    withRedirectUri.set('client_secret', clientSecret);
    withRedirectUri.set('code', c);
    withRedirectUri.set('grant_type', grantType);
    withRedirectUri.set('redirect_uri', redir);
    attempts.push(withRedirectUri);
  }

  let lastErr = 'Falha ao obter token';
  for (let i = 0; i < attempts.length; i++) {
    const body = attempts[i];
    const r = await axios.post(tokenUri, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
      timeout: 25_000,
    });

    if (r.status < 400) {
      const data = r.data;
      const at = pickAccessToken(data);
      if (!at) {
        lastErr = 'Resposta do token sem access_token';
        continue;
      }
      saveToken(at, typeof data === 'object' && data ? data : { raw: data });
      if (i > 0) {
        console.warn('[Watch] Token obtido na tentativa %d (ajuste redirect/grant se possível).', i + 1);
      }
      return typeof data === 'object' && data ? data : { access_token: at };
    }

    lastErr = formatTokenError(r.data, r.status);
  }

  throw new Error(lastErr);
}

function authHeader(token) {
  const t = String(token || '').trim();
  if (!t) return {};
  if (/^bearer\s+/i.test(t)) return { Authorization: t };
  return { Authorization: `Bearer ${t}` };
}

/**
 * GET /watch/v2/tickets/get — consulta assinatura/ticket do assinante.
 * @see https://apiweb.watch.tv.br/
 */
async function getTicket({ pPacote, pAssinanteIDIntegracao, pEmailUsuario }) {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error(
      'API Watch não autenticada. Configure WATCH_ACCESS_TOKEN ou complete o OAuth (admin) e guarde o token.'
    );
  }

  const url = `${baseUri()}/watch/v2/tickets/get`;
  const params = {
    pPacote: String(pPacote || ''),
    pAssinanteIDIntegracao: String(pAssinanteIDIntegracao || ''),
    pEmailUsuario: String(pEmailUsuario || ''),
  };
  const headers = { ...authHeader(token) };
  console.log('[Watch] GET %s | params=%j | Authorization=%s…', url, params, (headers.Authorization || '').slice(0, 40));
  const r = await axios.get(url, {
    params,
    headers,
    validateStatus: () => true,
    timeout: 25_000,
  });
  console.log('[Watch] Resposta HTTP %d: %j', r.status, typeof r.data === 'string' ? r.data.slice(0, 200) : r.data);

  if (r.status === 401 || r.status === 403) {
    throw new Error(
      'Token Watch expirado ou inválido. Acesse o admin (/admin) → Watch TV → Reautorizar para renovar.'
    );
  }
  if (r.status >= 400) {
    const msg =
      (r.data && (r.data.mensagem || r.data.message || r.data.error)) || `Watch API HTTP ${r.status}`;
    throw new Error(String(msg));
  }

  const errCode = r.data?.error || r.data?.ErrorMessage || '';
  if (errCode && typeof errCode === 'string' && /token/i.test(errCode)) {
    console.log('[Watch] ⚠️ Token rejeitado pela Watch (%s) — forçando refresh…', errCode);
    const refreshed = await refreshTokenViaN8n();
    if (refreshed) {
      const newToken = getAccessToken();
      const h2 = { ...authHeader(newToken) };
      console.log('[Watch] Retry com novo token: %s…', (h2.Authorization || '').slice(0, 40));
      const r2 = await axios.get(url, { params, headers: h2, validateStatus: () => true, timeout: 25_000 });
      console.log('[Watch] Retry resposta HTTP %d: %j', r2.status, r2.data);
      if (r2.status >= 400) throw new Error((r2.data?.error || r2.data?.message) || `Watch API HTTP ${r2.status}`);
      return r2.data;
    }
  }

  return r.data;
}

async function getPacotes(pPacote) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Token Watch ausente.');
  const url = `${baseUri()}/watch/v1/pacotes/get`;
  const r = await axios.get(url, {
    params: { pPacote: String(pPacote || '') },
    headers: { ...authHeader(token) },
    validateStatus: () => true,
    timeout: 25_000,
  });
  if (r.status >= 400) throw new Error((r.data?.error || r.data?.message) || `Watch API HTTP ${r.status}`);
  return r.data;
}

async function insertTicket({ pEmail, pAssinanteIDIntegracao, pPacote, pPhone }) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Token Watch ausente.');
  const url = `${baseUri()}/watch/v2/assinantes/insert`;
  const r = await axios.post(url, new URLSearchParams({
    pEmail: String(pEmail || ''),
    pAssinanteIDIntegracao: String(pAssinanteIDIntegracao || ''),
    pPacote: String(pPacote || ''),
    pPhone: String(pPhone || ''),
  }).toString(), {
    headers: { ...authHeader(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 25_000,
  });
  if (r.status >= 400) throw new Error((r.data?.error || r.data?.message) || `Watch API HTTP ${r.status}`);
  return r.data;
}

async function deleteTicket(pTicket) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Token Watch ausente.');
  const url = `${baseUri()}/watch/v1/tickets/delete`;
  const r = await axios.post(url, new URLSearchParams({
    pTicket: String(pTicket || ''),
  }).toString(), {
    headers: { ...authHeader(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 25_000,
  });
  if (r.status >= 400) throw new Error((r.data?.error || r.data?.message) || `Watch API HTTP ${r.status}`);
  return r.data;
}

async function editPhone({ pPacote, pEmail, pPhone }) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Token Watch ausente.');
  const url = `${baseUri()}/watch/v2/assinantes/editPhone`;
  const r = await axios.post(url, new URLSearchParams({
    pPacote: String(pPacote || ''),
    pEmail: String(pEmail || ''),
    pPhone: String(pPhone || ''),
  }).toString(), {
    headers: { ...authHeader(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 25_000,
  });
  if (r.status >= 400) throw new Error((r.data?.error || r.data?.message) || `Watch API HTTP ${r.status}`);
  return r.data;
}

async function editEmail({ pPacote, pEmail, pNewEmail }) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Token Watch ausente.');
  const url = `${baseUri()}/watch/v2/assinantes/editEmail`;
  const r = await axios.post(url, new URLSearchParams({
    pPacote: String(pPacote || ''),
    pEmail: String(pEmail || ''),
    pNewEmail: String(pNewEmail || ''),
  }).toString(), {
    headers: { ...authHeader(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 25_000,
  });
  if (r.status >= 400) throw new Error((r.data?.error || r.data?.message) || `Watch API HTTP ${r.status}`);
  return r.data;
}

async function resendEmail(pTicket) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Token Watch ausente.');
  const url = `${baseUri()}/watch/v1/assinante/sendemailactivation`;
  const r = await axios.post(url, new URLSearchParams({
    pTicket: String(pTicket || ''),
  }).toString(), {
    headers: { ...authHeader(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 25_000,
  });
  if (r.status >= 400) throw new Error((r.data?.error || r.data?.message) || `Watch API HTTP ${r.status}`);
  return r.data;
}

async function updateTicketStatus({ pTicket, pStatus }) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('Token Watch ausente.');
  const url = `${baseUri()}/watch/v1/tickets/updatestatus`;
  const r = await axios.post(url, new URLSearchParams({
    pTicket: String(pTicket || ''),
    pStatus: String(pStatus),
  }).toString(), {
    headers: { ...authHeader(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: () => true,
    timeout: 25_000,
  });
  if (r.status >= 400) throw new Error((r.data?.error || r.data?.message) || `Watch API HTTP ${r.status}`);
  return r.data;
}

function getTokenStatus() {
  const envTok = String(process.env.WATCH_ACCESS_TOKEN || '').trim();
  const stored = getStoredToken();
  const token = envTok || stored;
  if (!token) return { hasToken: false, expired: null, source: 'none' };
  const expired = isTokenExpired(token);
  return {
    hasToken: true,
    expired,
    source: envTok ? 'env' : 'db',
    preview: token.slice(0, 20) + '…',
  };
}

module.exports = {
  isEnabled,
  getPublicConfig,
  redirectUri,
  oauthClientId,
  oauthClientSecret,
  authUriResolved,
  tokenUriResolved,
  pacotePadrao,
  pacoteParaCliente,
  hasStoredToken,
  saveToken,
  getAccessToken,
  getValidAccessToken,
  getTokenStatus,
  exchangeCodeForToken,
  getTicket,
  getPacotes,
  insertTicket,
  deleteTicket,
  editPhone,
  editEmail,
  resendEmail,
  updateTicketStatus,
};
