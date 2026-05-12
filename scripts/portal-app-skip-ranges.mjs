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
  const dashStart  = lineOf(lines, '// ===== DASHBOARD =====', 'DASHBOARD');
  const fatStart   = lineOf(lines, '// ===== FATURAS =====', 'FATURAS');
  const mpStart    = lineOf(lines, '// ===== MERCADO PAGO', 'MP');
  const chamStart  = lineOf(lines, '// ===== CHAMADOS =====', 'CHAMADOS');
  const perfilStart = lineOf(lines, '// ===== PERFIL =====', 'PERFIL');
  const modaisStart = lineOf(lines, '// ===== MODAIS =====', 'MODAIS');
  const conexStart  = lineOf(lines, '// ===== CONEXÃO / MIKROTIK =====', 'CONEXÃO');

  if (dashStart >= fatStart) throw new Error('[portal-app] Ordem inválida: DASHBOARD deve vir antes de FATURAS.');
  if (fatStart >= mpStart)   throw new Error('[portal-app] Ordem inválida: FATURAS deve vir antes de MERCADO PAGO.');
  if (mpStart >= chamStart)  throw new Error('[portal-app] Ordem inválida: MERCADO PAGO deve vir antes de CHAMADOS.');
  if (chamStart >= perfilStart) throw new Error('[portal-app] Ordem inválida: CHAMADOS deve vir antes de PERFIL.');
  if (modaisStart >= conexStart) throw new Error('[portal-app] Ordem inválida: MODAIS deve vir antes de CONEXÃO.');

  return {
    dashStart,
    dashEnd:   fatStart - 1,
    fatStart,
    fatEnd:    mpStart - 1,
    mpStart,
    mpEnd:     chamStart - 1,
    chamStart,
    chamEnd:   perfilStart - 1,
    perfilStart,
    perfilEnd: modaisStart - 1,
    midStart:  modaisStart,
    midEnd:    conexStart - 1,
    tailStart: conexStart,
  };
}

export function skipPortalAppLine(oneBased, r) {
  if (oneBased >= r.dashStart  && oneBased <= r.dashEnd)   return true;
  if (oneBased >= r.fatStart   && oneBased <= r.fatEnd)    return true;
  if (oneBased >= r.mpStart    && oneBased <= r.mpEnd)     return true;
  if (oneBased >= r.chamStart  && oneBased <= r.chamEnd)   return true;
  if (oneBased >= r.perfilStart && oneBased <= r.perfilEnd) return true;
  if (oneBased >= r.midStart   && oneBased <= r.midEnd)    return true;
  if (oneBased >= r.tailStart) return true;
  return false;
}
