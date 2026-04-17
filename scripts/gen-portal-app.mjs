import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPortalAppSkipRanges, skipPortalAppLine } from './portal-app-skip-ranges.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const appPath = path.join(root, 'public', 'js', 'app.js');
const outPath = path.join(root, 'public', 'js', 'portal-app.js');

const lines = fs.readFileSync(appPath, 'utf8').split(/\r?\n/);
const skipRanges = getPortalAppSkipRanges(lines);

/** Linhas removidas do app.js → já existem em modules/ (ver scripts/portal-app-skip-ranges.mjs). */
function skipLine(n) {
  return skipPortalAppLine(n, skipRanges);
}

const kept = [];
for (let i = 0; i < lines.length; i++) {
  if (skipLine(i + 1)) continue;
  kept.push(lines[i]);
}

let body = kept.join('\n');

body = body.replace(/const API = '\/portal';\s*\nlet clienteData = null;\s*\n\n\/\/ ===== UTILS =====\s*\n\nasync function request[\s\S]*?^\/\/ ===== NAVEGAÇÃO =====/m, '// ===== NAVEGAÇÃO =====');

body = body.replace(
  /if \(view !== 'conexao' && _connInterval\) \{\s*\n\s*clearInterval\(_connInterval\);\s*\n\s*_connInterval = null;\s*\n\s*\}/,
  `if (view !== 'conexao' && S.connInterval) {
    clearInterval(S.connInterval);
    S.connInterval = null;
  }`,
);

body = body.replace(/\b_connInterval\b/g, 'S.connInterval');
body = body.replace(/\bclienteData\b/g, 'S.clienteData');
body = body.replace(/let faturasCarregadas = \{ abertas: false, vencidas: false, pagas: false \};/, '');
body = body.replace(/\bfaturasCarregadas\./g, 'S.faturasCarregadas.');
body = body.replace(/_mpLogoImg/g, 'MP_LOGO_IMG');

const hdr = `/**
 * Portal do cliente — núcleo (navegação, dashboard, faturas, chamados, perfil).
 * MP, velocidade e Lemon Club: modules/.
 */
import { API, MP_LOGO_IMG, VIEW_TITLES } from './modules/constants.js';
import { S, app } from './modules/state.js';
import { request } from './modules/http.js';
import { initOnboardingFormListeners, onboardingWindowAPI } from './modules/onboarding.js';
import {
  fmt,
  fmtData,
  fmtMoeda,
  showLoading,
  hideLoading,
  showAlert,
  emptyState,
  closeModal,
  closeModalDirect,
  showToast,
  hexToRgba,
  copiar,
} from './modules/format-ui.js';
import * as mp from './modules/mercadopago.js';
import * as conn from './modules/connection-speed.js';
import * as club from './modules/club.js';
import * as notif from './modules/notificacoes.js';

const loadNotificacoes = notif.loadNotificacoes;

/** MP, conexão, Lemon Club — globais para onclick / HTML */
Object.assign(window, {
  gerarPixMP: mp.gerarPixMP,
  fecharFormAssinaturaMP: mp.fecharFormAssinaturaMP,
  abrirFormAssinaturaMP: mp.abrirFormAssinaturaMP,
  confirmarAssinaturaComToken: mp.confirmarAssinaturaComToken,
  assinaturaMercadoPagoHosted: mp.assinaturaMercadoPagoHosted,
  preencherCarteiraMpAviso: mp.preencherCarteiraMpAviso,
  _mpCriarCardToken: mp._mpCriarCardToken,
  loadConexao: conn.loadConexao,
  loadVelocidade: conn.loadVelocidade,
  iniciarSpeedTest: conn.iniciarSpeedTest,
  limparHistoricoSpeed: conn.limparHistoricoSpeed,
  navToVelocidade: conn.navToVelocidade,
  missaoVisita: club.missaoVisita,
  loadIndicacoes: club.loadIndicacoes,
  completarMissao: club.completarMissao,
  _prePopularCacheMissoes: club._prePopularCacheMissoes,
  irFazerMissao: club.irFazerMissao,
  resgatarBeneficio: club.resgatarBeneficio,
  copiarLinkRef: club.copiarLinkRef,
  compartilharWhats: club.compartilharWhats,
  compartilharNativo: club.compartilharNativo,
  instalarApp: club.instalarApp,
  fecharModalInstalarApp: club.fecharModalInstalarApp,
  ativarNotificacoes: club.ativarNotificacoes,
  mostrarBoasVindas: club.mostrarBoasVindas,
  fecharBoasVindas: club.fecharBoasVindas,
  loadNotificacoes: notif.loadNotificacoes,
  setPushNotifPref: notif.setPushNotifPref,
  ativarPushNesteDispositivo: notif.ativarPushNesteDispositivo,
  desativarPushNesteDispositivo: notif.desativarPushNesteDispositivo,
});

conn.wireSpeedtestMissions((tipo, btn, sil) => club.completarMissao(tipo, btn, sil));
club.initClubPwa();

`;

const footer = `

initOnboardingFormListeners();

app.navTo = navTo;
app.refreshFaturas = loadFaturas;

/** Handlers globais para onclick="" no index.html */
const portalGlobalHandlers = {
  ...onboardingWindowAPI,
  navTo,
  loadNotificacoes: notif.loadNotificacoes,
  setPushNotifPref: notif.setPushNotifPref,
  ativarPushNesteDispositivo: notif.ativarPushNesteDispositivo,
  desativarPushNesteDispositivo: notif.desativarPushNesteDispositivo,
  fecharModalInstalarApp: club.fecharModalInstalarApp,
  toggleSidebar,
  closeSidebarMobile,
  togglePass,
  logout,
  switchTab,
  abrirFatura,
  loadChamados,
  abrirChamado,
  toggleCarteiraAddForm,
  confirmarCarteiraAdd,
  removerCartaoCarteira,
  closeModal,
  closeModalDirect,
  copiar,
  watchAtivarFree,
};
Object.assign(window, portalGlobalHandlers);

(async () => {
  try {
    const sess = await request('GET', \`\${API}/session\`);
    if (sess.logado) {
      document.getElementById('topbar-nome').textContent = sess.nome || '';
      document.getElementById('page-landing').classList.remove('active');
      document.getElementById('page-landing').classList.add('hidden');
      document.getElementById('page-portal').classList.remove('hidden');
      navTo('dashboard');
      const open = new URLSearchParams(window.location.search).get('open');
      if (open === 'faturas') navTo('faturas');
      else if (open === 'notificacoes') navTo('notificacoes');
    }
  } catch (_) {}
})();
`;

const out = hdr + '\n' + body + footer;

fs.writeFileSync(outPath, out, 'utf8');
console.log('Wrote', outPath);
