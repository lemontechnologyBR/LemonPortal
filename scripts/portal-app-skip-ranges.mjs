/**
 * Intervalos de linhas (1-based) a remover de public/js/app.js ao gerar portal-app.js / portal-shell.js.
 * Calculados a partir dos marcadores // ===== … ===== para não desalinhar quando o app.js cresce.
 */

function lineOf(lines, includes, label) {
  const i = lines.findIndex((l) => l.includes(includes));
  if (i < 0) throw new Error(`[portal-app] Marcador não encontrado em app.js (${label}): "${includes}"`);
  return i + 1;
}

export function getPortalAppSkipRanges(lines) {
  const mpStart = lineOf(lines, '// ===== MERCADO PAGO', 'MP');
  const chamStart = lineOf(lines, '// ===== CHAMADOS =====', 'CHAMADOS');
  const modaisStart = lineOf(lines, '// ===== MODAIS =====', 'MODAIS');
  const conexStart = lineOf(lines, '// ===== CONEXÃO / MIKROTIK =====', 'CONEXÃO');

  if (mpStart >= chamStart) throw new Error('[portal-app] Ordem inválida: MERCADO PAGO deve vir antes de CHAMADOS.');
  if (modaisStart >= conexStart) throw new Error('[portal-app] Ordem inválida: MODAIS deve vir antes de CONEXÃO.');

  return {
    mpStart,
    mpEnd: chamStart - 1,
    midStart: modaisStart,
    midEnd: conexStart - 1,
    tailStart: conexStart,
  };
}

export function skipPortalAppLine(oneBased, r) {
  if (oneBased >= r.mpStart && oneBased <= r.mpEnd) return true;
  if (oneBased >= r.midStart && oneBased <= r.midEnd) return true;
  if (oneBased >= r.tailStart) return true;
  return false;
}
