/**
 * Diagnóstico rápido da API Watch Brasil (usa .env + SQLite do portal).
 * Uso: na raiz do projeto: node scripts/watch-api-smoke.js
 */
require('dotenv').config();
const axios = require('axios');
const watch = require('../lib/watch-brasil');

function mask(s, head = 4, tail = 4) {
  const t = String(s || '');
  if (!t) return '(vazio)';
  if (head === 0 && tail === 0) return '***';
  if (t.length <= head + tail + 3) return '***';
  return `${t.slice(0, head)}…${t.slice(-tail)}`;
}

function authHeaderFromToken(tok) {
  const t = String(tok || '').trim();
  if (!t) return {};
  if (/^bearer\s+/i.test(t)) return { Authorization: t };
  return { Authorization: `Bearer ${t}` };
}

async function main() {
  console.log('=== Watch API — smoke test ===\n');

  const pub = watch.getPublicConfig();
  console.log('Config pública:');
  console.log(JSON.stringify(pub, null, 2));

  const cid = watch.oauthClientId();
  const secret = watch.oauthClientSecret();
  console.log('\nCredenciais OAuth:');
  console.log('  client_id:     ', mask(cid, 6, 4));
  console.log('  client_secret: ', mask(secret, 0, 0));
  console.log('  redirect_url:  ', watch.redirectUri());

  const token = watch.getAccessToken();
  console.log('\nAccess token (env ou SQLite):', token ? `sim — ${mask(token, 10, 8)}` : 'não');

  const base = pub.baseUri;
  const timeout = 20_000;

  console.log('\n--- 1) Reachability GET', base, '---');
  try {
    const r = await axios.get(base, { timeout, validateStatus: () => true, maxRedirects: 5 });
    console.log('   HTTP', r.status, r.statusText || '');
  } catch (e) {
    console.log('   Erro:', e.message);
  }

  console.log('\n--- 2) POST token (code inválido — esperado 4xx da Watch) ---');
  try {
    const body = new URLSearchParams();
    body.set('client_id', cid);
    body.set('client_secret', secret);
    body.set('code', '36887');
    body.set('grant_type', 'password');
    body.set('redirect_url', watch.redirectUri());

    const r = await axios.post(pub.tokenUri, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
      timeout,
    });
    console.log('   HTTP', r.status);
    const payload =
      typeof r.data === 'object' && r.data !== null
        ? JSON.stringify(r.data)
        : String(r.data || '');
    console.log('   Resposta:', payload.slice(0, 600) + (payload.length > 600 ? '…' : ''));
  } catch (e) {
    console.log('   Erro:', e.message);
  }

  if (!token) {
    console.log('\n--- 3) Endpoints autenticados: ignorados (sem token) ---');
    console.log('   Obter token: OAuth (/admin/watch/oauth-form) ou WATCH_ACCESS_TOKEN no .env.');
    return;
  }

  const pPacote = String(process.env.WATCH_PACOTE_ID || '36887').trim();
  const pacUrl = `${base}/watch/v1/pacotes/get`;

  console.log('\n--- 3) GET pacotes', pacUrl, 'pPacote=', pPacote, '---');
  try {
    const r = await axios.get(pacUrl, {
      params: { pPacote },
      headers: { ...authHeaderFromToken(token) },
      validateStatus: () => true,
      timeout,
    });
    console.log('   HTTP', r.status);
    const payload =
      typeof r.data === 'object' && r.data !== null
        ? JSON.stringify(r.data)
        : String(r.data || '');
    console.log('   Resposta:', payload.slice(0, 1200) + (payload.length > 1200 ? '…' : ''));
  } catch (e) {
    console.log('   Erro:', e.message);
  }

  const tickUrl = `${base}/watch/v2/tickets/get`;
  console.log('\n--- 4) GET tickets (params fictícios — vê formato de erro/sucesso) ---');
  try {
    const r = await axios.get(tickUrl, {
      params: {
        pPacote,
        pAssinanteIDIntegracao: '00000000000',
        pEmailUsuario: 'smoke-test@example.invalid',
      },
      headers: { ...authHeaderFromToken(token) },
      validateStatus: () => true,
      timeout,
    });
    console.log('   HTTP', r.status);
    const payload =
      typeof r.data === 'object' && r.data !== null
        ? JSON.stringify(r.data)
        : String(r.data || '');
    console.log('   Resposta:', payload.slice(0, 1200) + (payload.length > 1200 ? '…' : ''));
  } catch (e) {
    console.log('   Erro:', e.message);
  }

  console.log('\n=== Fim ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
