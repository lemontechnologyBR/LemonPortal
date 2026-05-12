/**
 * Gera public/js/portal-shell.js a partir de app.js, removendo blocos movidos para modules/.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPortalAppSkipRanges, skipPortalAppLine } from './portal-app-skip-ranges.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const appPath = path.join(root, 'public', 'js', 'app.js');
const outPath = path.join(root, 'public', 'js', 'portal-shell.js');

const lines = fs.readFileSync(appPath, 'utf8').split(/\r?\n/);
const skipRanges = getPortalAppSkipRanges(lines);

function skipLine(oneBased) {
  return skipPortalAppLine(oneBased, skipRanges);
}

const importBlock = `/**
 * Shell do portal: navegação, dashboard, faturas, chamados, perfil.
 * MP, velocidade e Lemon Club estão em modules/.
 */
import { API, VIEW_TITLES, MP_LOGO_IMG } from './modules/constants.js';
import { S, app } from './modules/state.js';
import { request } from './modules/http.js';
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
import {
  gerarPixMP,
  fecharFormPagamentoCartaoFatura,
  fecharFormAssinaturaMP,
  abrirFormPagamentoCartaoFatura,
  abrirFormAssinaturaMP,
  confirmarPagamentoCartaoFatura,
  confirmarAssinaturaComToken,
  preencherCarteiraMpAviso,
  _mpCriarCardToken,
} from './modules/mercadopago.js';
import {
  loadConexao,
  loadVelocidade,
  iniciarSpeedTest,
  limparHistoricoSpeed,
  navToVelocidade,
} from './modules/connection-speed.js';
import {
  missaoVisita,
  loadIndicacoes,
  completarMissao,
  _prePopularCacheMissoes,
  irFazerMissao,
  resgatarBeneficio,
  copiarLinkRef,
  compartilharWhats,
  compartilharNativo,
  instalarApp,
  ativarNotificacoes,
  mostrarBoasVindas,
  fecharBoasVindas,
  initClubPwa,
} from './modules/club.js';

`;

const kept = [];
for (let i = 0; i < lines.length; i++) {
  const n = i + 1;
  if (n <= 8) continue; // comentário de cabeçalho do app.js (build:portal)
  if (skipLine(n)) continue;
  kept.push(lines[i]);
}

let body = kept.join('\n');

// Remover declarações duplicadas que passaram a vir dos imports (linhas 200-265 aprox no original)
body = body.replace(/const API = '\/portal';\s*\nlet clienteData = null;\s*\n\n\/\/ ===== UTILS =====\s*\n\nasync function request[\s\S]*?^function showAlert/m, 'let clienteData = null;\n\nfunction _syncClienteToS() {\n  S.clienteData = clienteData;\n}\n\nfunction showAlert');

body = body.replace(/function fmt\([\s\S]*?^function showLoading/ms, 'function showLoading');

body = body.replace(/function showLoading[\s\S]*?^\/\/ ===== NAVEGAÇÃO =====/m, '// ===== NAVEGAÇÃO =====');

body = body.replace(
  /if \(view !== 'conexao' && _connInterval\) \{\s*\n\s*clearInterval\(_connInterval\);\s*\n\s*_connInterval = null;\s*\n\s*\}/,
  "if (view !== 'conexao' && S.connInterval) {\n    clearInterval(S.connInterval);\n    S.connInterval = null;\n  }",
);

body = body.replace(/\bclienteData\b/g, match => {
  return 'clienteData';
});

// Substituir clienteData por S.clienteData onde atribuímos / lemos no fluxo portal — mais seguro: sync após loadDashboard
// Por simplicidade: replace global clienteData com S.clienteData para assignments e reads in shell
body = body.replace(/^let clienteData = null;/m, '// espelho em S.clienteData via _syncClienteToS()');

// Actually use single source S.clienteData in shell - replace clienteData with S.clienteData throughout body
body = body.replace(/\bclienteData\b/g, 'S.clienteData');

body = body.replace(
  /let faturasCarregadas = \{ abertas: false, vencidas: false, pagas: false \};/,
  '// faturas: usar S.faturasCarregadas',
);
body = body.replace(/\bfaturasCarregadas\./g, 'S.faturasCarregadas.');

body = body.replace(
  /content\.innerHTML = `\s*<div class="fatura-modal-hero"[\s\S]*?_mpLogoImg/g,
  (m) => m.replace('_mpLogoImg', 'MP_LOGO_IMG'),
);

fs.writeFileSync(outPath, importBlock + body, 'utf8');
console.log('Wrote', outPath, 'lines:', (importBlock + body).split('\n').length);
