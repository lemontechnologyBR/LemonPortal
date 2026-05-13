/**
 * Lemon Club, missões, PWA, link de indicação e modal de boas-vindas.
 */
import { API, LEVEL_COLORS } from './constants.js';
import { S, app, cacheMissao, missaoCacheHas } from './state.js';
import { request } from './http.js';
import { emptyState, showToast, hexToRgba, animarContador, fmtMoeda, escHtml } from './format-ui.js';

let _refLink = '';
let _pwaPrompt = null;

const CLUB_SEGMENTS = new Set(['resumo', 'desafios', 'resgates', 'indicar', 'historico', 'cupons']);
let _clubSegNavBound = false;

const LEMON_CLUBE_DESCONTO_FATURA_PENDENTE = 'LEMON_CLUBE_DESCONTO_FATURA_PENDENTE';

export function setClubSegment(seg) {
  if (!CLUB_SEGMENTS.has(seg)) return;
  document.querySelectorAll('.club-seg-btn').forEach(btn => {
    const on = btn.dataset.clubSeg === seg;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.club-seg-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.clubPanel === seg);
  });
}

let _lastClubStats = null;

function initClubSegmentNav() {
  if (_clubSegNavBound) return;
  const nav = document.querySelector('.club-seg-nav');
  if (!nav) return;
  nav.addEventListener('click', e => {
    const btn = e.target.closest('.club-seg-btn');
    if (!btn || !nav.contains(btn)) return;
    const s = btn.dataset.clubSeg;
    if (!s) return;
    setClubSegment(s);
    if (s === 'cupons') {
      if (_lastClubStats) {
        _renderCuponsPanel(_lastClubStats);
      } else {
        // Dados ainda não chegaram — busca diretamente
        request('GET', `${API}/clube/stats`).then(d => {
          _lastClubStats = d;
          _renderCuponsPanel(d);
        }).catch(() => _renderCuponsPanel({ faturaDescontoPendente: null, faturaDescontoAplicados: [] }));
      }
    }
  });
  _clubSegNavBound = true;
}

function _fmtDataCurta(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return '—'; }
}

function _renderCuponsPanel(stats) {
  const el = document.getElementById('club-cupons-body');
  if (!el) return;

  // Se os stats ainda não chegaram, tenta buscar
  if (!stats) {
    el.innerHTML = `<div class="cupom-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Carregando cupons…</p></div>`;
    return;
  }

  const pendente  = stats.faturaDescontoPendente  || null;
  const aplicados = stats.faturaDescontoAplicados || []; // desconto c/ valor de pagamento
  const resgates  = (stats.resgates || []).slice(0, 30); // todos os resgates

  if (!pendente && !resgates.length) {
    el.innerHTML = `
      <div class="cupom-empty">
        <div class="cupom-empty__icon"><i class="fa-solid fa-ticket"></i></div>
        <p class="cupom-empty__title">Nenhum resgate ainda</p>
        <p class="cupom-empty__sub">Troque seus pontos na aba <strong>Trocar</strong><br>e seus resgates aparecem aqui.</p>
      </div>`;
    return;
  }

  let html = '';

  // ── Cupom ativo (estilo voucher) ──────────────────────────────────────────
  if (pendente) {
    // 4 estados possíveis:
    //   pendente  → tem alvo, não venceu, ainda não clicou Aplicar → verde  + botão Aplicar
    //   aplicado  → clicou Aplicar, aguardando pagamento           → azul/verde escuro, info
    //   vencida   → tem alvo mas a data já passou                  → laranja + aviso fatura vencida
    //   bloqueado → sem alvo (sem fatura aberta / em atraso)       → laranja + aviso regularize
    const temAlvo       = !!(pendente.titulo_uuid_alvo);
    const faturaVencida = !!(pendente.faturaAlvoVencida);
    const jaAplicado    = !!(pendente.aplicado);
    const estado = jaAplicado            ? 'aplicado'
                 : temAlvo && !faturaVencida ? 'pendente'
                 : temAlvo && faturaVencida  ? 'vencida'
                 :                            'bloqueado';

    const dvFmt    = _fmtDataCurta(pendente.titulo_alvo_datavenc);
    const ref      = pendente.titulo_alvo_referencia ? escHtml(pendente.titulo_alvo_referencia) : '';
    const desde    = pendente.desde ? `Resgatado em ${_fmtDataCurta(pendente.desde)}` : '';
    const uuidAlvo = pendente.titulo_uuid_alvo || '';

    const isPendente = estado === 'pendente';
    const isAplicado = estado === 'aplicado';
    const isVencida  = estado === 'vencida';
    const cssCard    = (isPendente || isAplicado) ? 'cupom-voucher--ativo' : 'cupom-voucher--bloqueado';
    const cssStamp   = (isPendente || isAplicado) ? '' : ' cupom-voucher__stamp--locked';
    const cssNotch   = (isPendente || isAplicado) ? '' : ' cupom-voucher__notch--locked';
    const cssStatus  = (isPendente || isAplicado) ? '' : ' cupom-voucher__status--locked';
    const statusIcon = isPendente
      ? '<i class="fa-solid fa-circle-check"></i> Ativo'
      : isAplicado
        ? '<i class="fa-solid fa-check-double"></i> Aplicado na fatura'
        : isVencida
          ? '<i class="fa-solid fa-calendar-xmark"></i> Fatura vencida'
          : '<i class="fa-solid fa-lock"></i> Bloqueado';

    let acaoHtml = '';
    if (isPendente) {
      acaoHtml = `<button type="button" class="cupom-voucher__btn" data-aplicar-uuid="${escHtml(uuidAlvo)}">
                    <i class="fa-solid fa-file-invoice-dollar"></i> Aplicar na fatura
                  </button>`;
    } else if (isAplicado) {
      acaoHtml = `<button type="button" class="cupom-voucher__btn cupom-voucher__btn--ver" data-aplicar-uuid="${escHtml(uuidAlvo)}">
                    <i class="fa-solid fa-eye"></i> Ver fatura com desconto
                  </button>`;
    } else if (isVencida) {
      acaoHtml = `<div class="cupom-voucher__bloqueado-msg cupom-voucher__bloqueado-msg--vencida">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Cupom não aplicado: a fatura alvo venceu. Uma nova fatura em aberto será vinculada automaticamente.
                  </div>`;
    } else {
      acaoHtml = `<div class="cupom-voucher__bloqueado-msg">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Você possui faturas em atraso. Regularize os pagamentos para ativar este cupom.
                  </div>`;
    }

    html += `
      <div class="cupom-voucher ${cssCard}">
        <div class="cupom-voucher__stamp${cssStamp}">
          <span class="cupom-voucher__pct">${pendente.percent}%</span>
          <span class="cupom-voucher__off">OFF</span>
        </div>
        <div class="cupom-voucher__notch${cssNotch}"></div>
        <div class="cupom-voucher__body">
          <div class="cupom-voucher__status${cssStatus}">${statusIcon}</div>
          <div class="cupom-voucher__label">${escHtml(pendente.label || `Desconto ${pendente.percent}% na fatura`)}</div>
          ${dvFmt && dvFmt !== '—'
            ? `<div class="cupom-voucher__meta"><i class="fa-solid fa-calendar-day"></i> Fatura com vencimento <strong>${dvFmt}</strong>${ref ? ` · ${ref}` : ''}</div>`
            : ''}
          ${desde ? `<div class="cupom-voucher__desde"><i class="fa-regular fa-clock"></i> ${desde}</div>` : ''}
          ${acaoHtml}
        </div>
      </div>`;
  }

  // ── Histórico — todos os resgates ────────────────────────────────────────
  if (resgates.length) {
    html += `<div class="cupom-sec-title"><i class="fa-solid fa-clock-rotate-left"></i> Histórico de resgates</div>`;
    const _TIPO_DESCONTO = /^desconto/;
    resgates.forEach((r) => {
      const isDesc = _TIPO_DESCONTO.test(r.tipo || '');
      const pct    = isDesc ? (r.tipo === 'desconto' ? 10 : parseInt(r.tipo.replace('desconto_', ''), 10) || null) : null;
      // busca info de pagamento no registro de aplicados (mesmo label, data próxima ≤ 3 dias)
      const aplicado = isDesc
        ? aplicados.find((a) => a.label === r.label && Math.abs(new Date(a.data) - new Date(r.data)) < 86400000 * 3)
        : null;
      const data = _fmtDataCurta(r.data);
      const desc = aplicado?.valor_desconto != null ? `− ${fmtMoeda(aplicado.valor_desconto)}` : '';
      const pago = aplicado?.valor_pago     != null ? `Pago: ${fmtMoeda(aplicado.valor_pago)}` : '';
      const ptsBadge = r.pontos ? `<span class="cupom-hist-pts">−${r.pontos} pts</span>` : '';

      html += `
        <div class="cupom-voucher cupom-voucher--usado">
          <div class="cupom-voucher__stamp cupom-voucher__stamp--used">
            ${isDesc && pct
              ? `<span class="cupom-voucher__pct">${pct}%</span><span class="cupom-voucher__off">OFF</span>`
              : `<span class="cupom-voucher__icon-stamp"><i class="fa-solid fa-gift"></i></span>`}
          </div>
          <div class="cupom-voucher__notch cupom-voucher__notch--used"></div>
          <div class="cupom-voucher__body">
            <div class="cupom-voucher__status cupom-voucher__status--used"><i class="fa-solid fa-check"></i> Resgatado</div>
            <div class="cupom-voucher__label">${escHtml(r.label || r.tipo)}</div>
            <div class="cupom-voucher__footer">
              ${pago ? `<span class="cupom-voucher__pago">${pago}</span>` : ''}
              ${desc ? `<span class="cupom-voucher__economy">${desc}</span>` : ''}
              ${ptsBadge}
              <span class="cupom-voucher__data">${data}</span>
            </div>
          </div>
        </div>`;
    });
  }

  el.innerHTML = html;

  // Botões do cupom ativo — "Aplicar" ou "Ver fatura com desconto"
  const btnAplicar = el.querySelector('[data-aplicar-uuid]');
  if (btnAplicar) {
    const isVerBtn = btnAplicar.classList.contains('cupom-voucher__btn--ver');
    btnAplicar.addEventListener('click', async () => {
      const uuid = btnAplicar.dataset.aplicarUuid;
      if (isVerBtn) {
        // Cupom já aplicado — apenas navega e abre a fatura
        if (typeof app.navTo === 'function') app.navTo('faturas');
        setTimeout(() => { if (typeof app.abrirFatura === 'function') app.abrirFatura(uuid); }, 420);
        return;
      }
      // Aplicar pela primeira vez
      btnAplicar.disabled = true;
      btnAplicar.innerHTML = '<div class="spinner" style="width:14px;height:14px;margin:0 auto"></div>';
      try {
        await request('POST', `${API}/clube/cupom/aplicar`);
        showToast('Cupom aplicado! O desconto já aparece na fatura.', 'success');
        loadIndicacoes();
        if (typeof app.navTo === 'function') app.navTo('faturas');
        if (typeof app.refreshFaturas === 'function') app.refreshFaturas();
        setTimeout(() => { if (typeof app.abrirFatura === 'function') app.abrirFatura(uuid); }, 500);
      } catch (e) {
        btnAplicar.disabled = false;
        btnAplicar.innerHTML = '<i class="fa-solid fa-file-invoice-dollar"></i> Aplicar na fatura';
        showToast(e?.data?.error || 'Não foi possível aplicar o cupom.', 'error');
      }
    });
  }
}

/** API antiga sem `code` ou cache SW desatualizado — ainda abrimos o modal. */
function erroEhDescontoFaturaPendente(e) {
  if (!e) return false;
  if (e.code === LEMON_CLUBE_DESCONTO_FATURA_PENDENTE) return true;
  const m = String(e.message || '');
  return m.includes('desconto na fatura pendente');
}

export function fecharModalClubeDescontoPendente() {
  document.getElementById('modal-clube-desconto-pendente')?.classList.add('hidden');
}

export function abrirModalClubeDescontoPendente(mensagem) {
  const modal = document.getElementById('modal-clube-desconto-pendente');
  const p = document.getElementById('modal-clube-desconto-pendente-msg');
  if (!modal || !p) {
    showToast(mensagem || 'Já existe um desconto na fatura pendente.', 'warning');
    return;
  }
  p.textContent = mensagem || '';
  modal.classList.remove('hidden');
}

export function modalIrFaturasCupomPendente() {
  fecharModalClubeDescontoPendente();
  go('faturas');
}

const _secaoMap = {
  ver_fatura: 'faturas',
  ver_conexao: 'conexao',
  ver_velocidade_sec: 'velocidade',
  ver_perfil_sec: 'perfil',
  ver_suporte_sec: 'suporte',
  ver_clube: 'indicacoes',
  ver_desafios: 'desafios',
  ver_historico: 'historico',
};

function go(view) {
  if (typeof app.navTo === 'function') app.navTo(view);
}

export async function missaoVisita(tipo) {
  if (missaoCacheHas(tipo)) return;
  const secao = _secaoMap[tipo] || tipo.replace('ver_', '');
  try {
    const r = await request('POST', `${API}/visita`, { secao });
    if (r.ok) {
      if (r.missao === tipo) cacheMissao(tipo);
      if (r.novosPts > 0) {
        showToast(`+${r.novosPts} pts — "${r.label}" concluída! 🎯`, 'success');
        S.clubPontos = r.pontos;
        animarContador('ref-pontos', r.pontos);
        atualizarBotoesResgate(r.pontos);
      }
    }
  } catch {}
}

export async function loadIndicacoes(opts = {}) {
  initClubSegmentNav();
  if (opts.resetSegment) setClubSegment('resumo');

  try {
    await request('POST', `${API}/clube/sincronizar`);
  } catch {}

  try {
    const data = await request('GET', `${API}/clube/stats`);
    _lastClubStats = data;
    S.clubPontos = data.pontos;
    _refLink = data.link;

    (data.completedMissions || []).forEach(id => cacheMissao(id));

    animarContador('ref-pontos', data.pontos);
    animarContador('ref-total', data.totalIndicados);
    animarContador('ref-resgates', data.resgates?.length || 0);
    animarContador('club-total-earned', data.totalEarned);
    animarContador('club-streak', data.streak || 0);

    const badge = document.getElementById('nav-pontos');
    if (data.pontos > 0) {
      badge.textContent = data.pontos + ' pts';
      badge.style.display = '';
    } else badge.style.display = 'none';

    if (data.nivel) {
      const nv = data.nivel;
      document.getElementById('club-level-icon').textContent = nv.icon;
      document.getElementById('club-level-name').textContent = nv.label;
      document.getElementById('club-level-name').style.color = LEVEL_COLORS[nv.id] || 'var(--lemon)';
      if (data.proximoNivel) {
        const total = data.proximoNivel.min - (nv.min || 0);
        const atual = (data.totalEarned || 0) - (nv.min || 0);
        const pct = Math.min(Math.max(atual / total, 0), 1);
        setTimeout(() => {
          document.getElementById('club-level-bar').style.width = pct * 100 + '%';
          const ratioEl2 = document.getElementById('club-level-bar-ratio');
          if (ratioEl2) ratioEl2.textContent = `${data.totalEarned || 0} / ${data.proximoNivel.min} pts`;
          document.getElementById('club-level-progress-label').textContent =
            `${data.ptsFaltamProx} pts para ${data.proximoNivel.icon} ${data.proximoNivel.label}`;
        }, 300);
      } else {
        document.getElementById('club-level-bar').style.width = '100%';
        const ratioEl2 = document.getElementById('club-level-bar-ratio');
        if (ratioEl2) ratioEl2.textContent = `${data.totalEarned || 0} pts`;
        document.getElementById('club-level-progress-label').textContent = '🏆 Nível máximo atingido!';
      }
    }

    document.getElementById('ref-link-text').textContent = data.link;
    atualizarBotoesResgate(data.pontos);
    renderMissions(data.missoes || [], data.completedMissions || []);
    missaoVisita('ver_desafios');
    renderClubLog(data.log || []);
    missaoVisita('ver_historico');
    _renderCuponsPanel(data);
  } catch (e) {
    console.error(e);
  }
}

function atualizarBotoesResgate(pontos) {
  const resgates = [
    { id: 'reward-desconto', pts: 100 },
    { id: 'reward-desconto_20', pts: 200 },
    { id: 'reward-desconto_30', pts: 300 },
    { id: 'reward-desconto_40', pts: 400 },
    { id: 'reward-desconto_50', pts: 500 },
    { id: 'reward-desconto_80', pts: 800 },
    { id: 'reward-velocidade_dobro_7d', pts: 220 },
    { id: 'reward-upgrade', pts: 300 },
    { id: 'reward-plano_up_7d', pts: 370 },
    { id: 'reward-indicacao_dobro', pts: 350 },
    { id: 'reward-plano_up_15d', pts: 470 },
    { id: 'reward-ponto_extra_15d', pts: 500 },
    { id: 'reward-roteador_wifi6', pts: 560 },
    { id: 'reward-ponto_extra_30d', pts: 620 },
    { id: 'reward-mes_gratis', pts: 800 },
    { id: 'reward-upgrade_90d', pts: 850 },
    { id: 'reward-plano_up_30d', pts: 950 },
    { id: 'reward-desconto_100', pts: 1000 },
    { id: 'reward-plano_up_60d', pts: 1300 },
    { id: 'reward-dois_meses', pts: 1500 },
    { id: 'reward-tres_meses', pts: 1800 },
    { id: 'reward-cliente_vip', pts: 2000 },
  ];
  resgates.forEach(({ id, pts }) => {
    const card = document.getElementById(id);
    const btn = card?.querySelector('.club-reward-btn');
    if (!btn) return;
    btn.disabled = pontos < pts;
    card.classList.toggle('reward-locked', pontos < pts);
  });
  const disp = document.getElementById('club-pontos-disp');
  if (disp) disp.textContent = pontos + ' pts disponíveis';
}

export function irFazerMissao(id) {
  const NAV = {
    primeiro_login: () => completarMissao('primeiro_login', null, false),
    ver_fatura: () => go('faturas'),
    ver_conexao: () => go('conexao'),
    ver_velocidade_sec: () => go('velocidade'),
    ver_perfil_sec: () => go('perfil'),
    ver_suporte_sec: () => go('suporte'),
    ver_clube: () => go('indicacoes'),
    ver_desafios: () => go('indicacoes'),
    ver_historico: () => go('indicacoes'),
    explorador: () => {
      go('dashboard');
      showToast('Visite todas as seções do portal para concluir 🧭', 'info');
    },
    acesso_noturno: () => showToast('Acesse o portal após as 22h para concluir 🌙', 'info'),
    perfil_completo: () => go('perfil'),
    instalar_app: () => instalarApp(),
    compartilhar_link: () => copiarLinkRef(document.querySelector('.ref-link-box .copy-btn')),
    ativar_notif: () => ativarNotificacoes(),
    mudar_dados: () => go('perfil'),
    indicar_whatsapp: () => {
      compartilharWhats();
      showToast('Missão do perfil: envie seu link de indicação pelo WhatsApp.', 'info');
    },
    login_3x: () => showToast('Acesse o portal em 3 sessões diferentes para concluir 📲', 'info'),
    uso_semanal: () => showToast('Acesse o portal em 3 dias diferentes para concluir 📅', 'info'),
    speedtest: () => go('velocidade'),
    speedtest_3x: () => go('velocidade'),
    speedtest_5x: () => go('velocidade'),
    speedtest_10x: () => go('velocidade'),
    speedtest_manha: () => {
      go('velocidade');
      showToast('Faça o teste entre 6h e 12h ☀️', 'info');
    },
    speedtest_noite: () => {
      go('velocidade');
      showToast('Faça o teste entre 20h e 23h 🌙', 'info');
    },
    speedtest_100: () => go('velocidade'),
    speedtest_excelente: () => go('velocidade'),
    speedtest_semana: () => {
      go('velocidade');
      showToast('Faça testes em 3 dias diferentes 📅', 'info');
    },
    embaixador: () => {
      compartilharWhats();
      showToast('Missão do clube: divulgue o portal ou seu link a partir das indicações.', 'info');
    },
    indicar_1: () => go('indicacoes'),
    indicar_2: () => go('indicacoes'),
    indicar_3: () => go('indicacoes'),
    indicar_5: () => go('indicacoes'),
    indicar_7: () => go('indicacoes'),
    indicar_10: () => go('indicacoes'),
    indicar_15: () => go('indicacoes'),
    indicar_20: () => go('indicacoes'),
    pagamento_1: () => go('faturas'),
    pagamento_5: () => go('faturas'),
    pagamento_10: () => go('faturas'),
    streak_3: () => {
      go('faturas');
      showToast('Acumule 3 faturas pagas até o vencimento (contadas no clube) 🔥', 'info');
    },
    streak_6: () => {
      go('faturas');
      showToast('Acumule 6 faturas pagas até o vencimento (contadas no clube) 🔥', 'info');
    },
    streak_9: () => {
      go('faturas');
      showToast('Acumule 9 faturas pagas até o vencimento (contadas no clube) 🔥', 'info');
    },
    streak_12: () => {
      go('faturas');
      showToast('Acumule 12 faturas pagas até o vencimento (contadas no clube) 👑', 'info');
    },
    streak_18: () => {
      go('faturas');
      showToast('Acumule 18 faturas pagas até o vencimento (contadas no clube) 💎', 'info');
    },
    streak_24: () => {
      go('faturas');
      showToast('Acumule 24 faturas pagas até o vencimento (contadas no clube) 🏆', 'info');
    },
    maratonista: () => {
      go('faturas');
      showToast('Acumule 15 faturas pagas até o vencimento (contadas no clube) 🏅', 'info');
    },
    clube_prata: () => showToast('Acumule 500 pts no total para alcançar o Prata 🥈', 'info'),
    clube_ouro: () => showToast('Acumule 1500 pts no total para alcançar o Ouro 🥇', 'info'),
    clube_diamante: () => showToast('Acumule 3000 pts no total para alcançar o Diamante 💎', 'info'),
    missoes_5: () => showToast('Complete 5 missões para ganhar este bônus ✅', 'info'),
    missoes_10: () => showToast('Complete 10 missões para ganhar este bônus ✅', 'info'),
    missoes_15: () => showToast('Complete 15 missões para ganhar este bônus ✅', 'info'),
    missoes_20: () => showToast('Complete 20 missões para ganhar este bônus ✅', 'info'),
    resgatar_1: () => go('indicacoes'),
    colecionador: () => go('indicacoes'),
  };
  const acao = NAV[id];
  if (acao) {
    acao();
    return;
  }
  completarMissao(id, null, false);
}

function renderMissions(missoes, completadas) {
  const lista = document.getElementById('missions-list');
  if (!lista) return;

  const total = missoes.length;
  const done = missoes.filter(m => m.completa).length;
  const counter = document.getElementById('missions-counter');
  if (counter) counter.textContent = `${done}/${total}`;

  if (!missoes.length) {
    lista.innerHTML = '<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>Sem desafios no momento</p></div>';
    return;
  }

  const grupos = {};
  for (const m of missoes) {
    const cat = m.categoria || 'Outros';
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(m);
  }

  const catIcons = {
    Exploração: 'fa-compass',
    'App & Perfil': 'fa-mobile-screen',
    Velocidade: 'fa-gauge-high',
    Fidelidade: 'fa-fire',
    Indicações: 'fa-user-plus',
    Conquistas: 'fa-trophy',
  };

  const gruposEntries = Object.entries(grupos);
  let openIdx = gruposEntries.findIndex(([, it]) => it.some(m => !m.completa));
  if (openIdx < 0) openIdx = 0;

  lista.innerHTML = gruposEntries
    .map(([cat, items], idx) => {
      const catDone = items.filter(m => m.completa).length;
      const catTotal = items.length;
      const catPct = Math.round((catDone / catTotal) * 100);
      const catIcon = catIcons[cat] || 'fa-star';

      const itemsHtml = items
        .map(
          m => `
      <div class="mission-item ${m.completa ? 'mission-done' : ''}">
        <div class="mission-icon" style="background:${m.completa ? 'rgba(34,197,94,0.15)' : hexToRgba(m.cor, 0.1)};border-color:${m.completa ? 'rgba(34,197,94,0.3)' : hexToRgba(m.cor, 0.25)}">
          <i class="fa-solid ${m.completa ? 'fa-check' : m.icon}" style="color:${m.completa ? '#4ade80' : m.cor}"></i>
        </div>
        <div class="mission-info">
          <div class="mission-title">${m.label}</div>
          <div class="mission-desc">${m.desc}</div>
        </div>
        <div class="mission-pts-wrap">
          ${
            m.completa
              ? '<span class="mission-done-badge"><i class="fa-solid fa-check"></i> Feito</span>'
              : `<span class="mission-pts">+${m.pts} pts</span>
               ${
                 m.auto === true
                   ? '<span class="mission-auto-badge">automático</span>'
                   : `<button class="mission-claim-btn" onclick="irFazerMissao('${m.id}')">Ir fazer</button>`
               }`
          }
        </div>
      </div>`,
        )
        .join('');

      return `
      <details class="mission-group" name="club-mission-groups"${idx === openIdx ? ' open' : ''}>
        <summary class="mission-group-header">
          <span class="mission-group-chev" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i></span>
          <div class="mission-group-title">
            <i class="fa-solid ${catIcon}"></i> ${cat}
          </div>
          <div class="mission-group-progress">
            <span class="mission-group-count">${catDone}/${catTotal}</span>
            <div class="mission-group-bar">
              <div class="mission-group-bar-fill" style="width:${catPct}%"></div>
            </div>
          </div>
        </summary>
        <div class="mission-group-items">${itemsHtml}</div>
      </details>`;
    })
    .join('');
}

export async function completarMissao(tipo, btn, silencioso = false) {
  if (missaoCacheHas(tipo)) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Ir fazer';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '...';
  }

  try {
    const r = await request('POST', `${API}/clube/missao`, { tipo });

    if (r.jaCompleta) {
      cacheMissao(tipo);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Ir fazer';
      }
      return;
    }

    cacheMissao(tipo);
    if (!silencioso) {
      showToast(`+${r.pts} pts — "${r.label}" concluída! 🎯`, 'success');
    }
    S.clubPontos = r.pontos;
    animarContador('ref-pontos', r.pontos);
    atualizarBotoesResgate(r.pontos);
    const badge = document.getElementById('nav-pontos');
    if (badge) {
      badge.textContent = r.pontos + ' pts';
      badge.style.display = '';
    }
    if (!silencioso) setTimeout(loadIndicacoes, 800);
  } catch (e) {
    if (!silencioso) {
      const msg = e.message || '';
      if (!msg.includes('inválida') && !msg.includes('concluída') && !msg.includes('já')) {
        showToast(msg || 'Não foi possível registrar a missão.', 'error');
      }
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Ir fazer';
    }
    const msg = e.message || '';
    if (msg.includes('concluída') || msg.includes('já') || msg.includes('inválida')) {
      cacheMissao(tipo);
    }
  }
}

function renderClubLog(log) {
  const lista = document.getElementById('ref-historico-list');
  if (!lista) return;
  if (!log.length) {
    lista.innerHTML = emptyState('fa-star', 'Nenhum ponto ganho ainda. Comece indicando um amigo!');
    return;
  }

  const tipoConfig = {
    indicacao: { icon: 'fa-user-plus', bg: 'rgba(182,195,63,0.1)', color: '#b6c33f' },
    pagamento: { icon: 'fa-file-invoice-dollar', bg: 'rgba(34,197,94,0.1)', color: '#4ade80' },
    resgate: { icon: 'fa-ticket', bg: 'rgba(99,102,241,0.1)', color: '#818cf8' },
    streak: { icon: 'fa-fire', bg: 'rgba(251,146,60,0.1)', color: '#fb923c' },
    missao: { icon: 'fa-list-check', bg: 'rgba(129,140,248,0.1)', color: '#818cf8' },
    conquista: { icon: 'fa-trophy', bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' },
  };

  lista.innerHTML = log
    .map(item => {
      const cfg = tipoConfig[item.tipo] || {
        icon: 'fa-star',
        bg: 'rgba(255,255,255,0.05)',
        color: 'var(--lemon)',
      };
      const pos = item.pontos > 0;
      return `
      <div class="club-log-item">
        <div class="club-log-icon" style="background:${cfg.bg}">
          <i class="fa-solid ${cfg.icon}" style="color:${cfg.color}"></i>
        </div>
        <div class="club-log-info">
          <div class="club-log-desc">${item.descricao}</div>
          <div class="club-log-date">${new Date(item.data).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}</div>
        </div>
        <div class="club-log-pts ${pos ? 'positivo' : 'negativo'}">${pos ? '+' : ''}${item.pontos} pts</div>
      </div>`;
    })
    .join('');
}

export function copiarLinkRef(btn) {
  const el = btn || document.querySelector('.copy-btn');
  if (!_refLink || !el) return;
  navigator.clipboard.writeText(_refLink).then(() => {
    const orig = el.innerHTML;
    el.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
    el.classList.add('copied');
    setTimeout(() => {
      el.innerHTML = orig;
      el.classList.remove('copied');
    }, 2200);
    completarMissao('compartilhar_link', null, false);
  });
}

export function compartilharWhats() {
  if (!_refLink) return;
  const txt = encodeURIComponent(
    `Oi! Assina a Lemon Technology pelo meu link — sua solução em tecnologia 🍋: ${_refLink}`,
  );
  window.open(`https://wa.me/?text=${txt}`, '_blank');
  completarMissao('indicar_whatsapp', null, false);
  completarMissao('embaixador', null, false);
}

export function compartilharNativo() {
  if (!_refLink) return;
  if (navigator.share) {
    navigator.share({
      title: 'Lemon Technology',
      text: 'Contrate com a Lemon Technology pelo meu link — sua solução em tecnologia!',
      url: _refLink,
    }).catch(() => {});
  } else {
    copiarLinkRef(document.querySelector('.copy-btn'));
  }
}

export async function resgatarBeneficio(tipo, btn) {
  setClubSegment('resgates');
  const msg = document.getElementById('club-reward-msg');
  if (msg) msg.innerHTML = '';
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;margin:0"></div>';
  try {
    const r = await request('POST', `${API}/clube/resgatar`, { tipo });
    S.clubPontos = r.pontosRestantes;
    animarContador('ref-pontos', r.pontosRestantes);
    atualizarBotoesResgate(r.pontosRestantes);
    const badge = document.getElementById('nav-pontos');
    if (badge) {
      if (r.pontosRestantes > 0) {
        badge.textContent = r.pontosRestantes + ' pts';
        badge.style.display = '';
      } else badge.style.display = 'none';
    }
    if (r.faturaDesconto) {
      // Navega imediatamente para a aba Cupons e já mostra o cupom ativo
      setClubSegment('cupons');
      const _fdUuid = r.faturaDesconto.titulo_uuid_alvo || null;
      const _fdDv   = r.faturaDesconto.titulo_alvo_datavenc || null;
      // Calcula se a fatura alvo já venceu (improvável no resgate, mas garante consistência)
      let _fdVencida = false;
      if (_fdUuid && _fdDv) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const dv   = new Date(_fdDv); dv.setHours(0, 0, 0, 0);
        _fdVencida = dv < hoje;
      }
      _renderCuponsPanel({
        faturaDescontoPendente: {
          percent:                   r.faturaDesconto.percent,
          label:                     r.faturaDesconto.label || `Desconto ${r.faturaDesconto.percent}% na fatura`,
          titulo_uuid_alvo:          _fdUuid,
          titulo_alvo_datavenc:      _fdDv,
          titulo_alvo_referencia:    r.faturaDesconto.titulo_alvo_referencia || null,
          desde:                     new Date().toISOString(),
          aplicavel:                 !!(  _fdUuid && !_fdVencida),
          faturaAlvoVencida:         _fdVencida,
        },
        faturaDescontoAplicados: _lastClubStats?.faturaDescontoAplicados || [],
      });
      showToast(`Cupom de ${r.faturaDesconto.percent}% ativado! Abra a fatura para pagar com desconto.`, 'success');
      // Força reload das faturas em segundo plano para já enriquecer com o cupom
      if (typeof app.refreshFaturas === 'function') app.refreshFaturas();
    } else if (msg) {
      msg.innerHTML = `<div class="alert alert-success"><i class="fa-solid fa-check-circle"></i> <strong>${r.label}</strong> solicitado! Nossa equipe aplicará em breve. Pontos restantes: <strong>${r.pontosRestantes}</strong></div>`;
      msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    loadIndicacoes();
  } catch (e) {
    if (erroEhDescontoFaturaPendente(e)) {
      abrirModalClubeDescontoPendente(e.message);
      showToast('Você já tem um desconto pendente na fatura.', 'info');
    } else if (msg) {
      msg.innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-xmark"></i> ${e.message || 'Erro ao resgatar.'}</div>`;
      msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      showToast(e.message || 'Erro ao resgatar.', 'error');
    }
    btn.disabled = false;
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Resgatar';
  }
}

function isStandalonePwa() {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch (_) {}
  return window.navigator.standalone === true;
}

function isIosDevice() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent || '');
}

/** Instruções manuais (iOS / Android) quando o browser não oferece “Instalar app” nativo. */
export function mostrarModalInstalarApp() {
  const modal = document.getElementById('modal-instalar-app');
  if (!modal) return;
  const ios = document.getElementById('modal-instalar-ios');
  const and = document.getElementById('modal-instalar-android');
  const out = document.getElementById('modal-instalar-outros');
  if (isIosDevice()) {
    ios?.classList.remove('hidden');
    and?.classList.add('hidden');
    out?.classList.add('hidden');
  } else if (isAndroidDevice()) {
    ios?.classList.add('hidden');
    and?.classList.remove('hidden');
    out?.classList.add('hidden');
  } else {
    ios?.classList.add('hidden');
    and?.classList.add('hidden');
    out?.classList.remove('hidden');
  }
  modal.classList.remove('hidden');
}

export function fecharModalInstalarApp() {
  document.getElementById('modal-instalar-app')?.classList.add('hidden');
}

export async function instalarApp() {
  if (isStandalonePwa()) {
    // Já instalado — garante que a missão seja concluída
    completarMissao('instalar_app', null, true);
    return showToast('O portal já está aberto como app na tela inicial.', 'success');
  }
  if (_pwaPrompt) {
    _pwaPrompt.prompt();
    const { outcome } = await _pwaPrompt.userChoice;
    if (outcome === 'accepted') {
      _pwaPrompt = null;
      completarMissao('instalar_app', null, false);
      // Após instalar o PWA, oferecer ativação de notificações pelo fluxo completo
      // (cria subscription no servidor antes de conceder pontos)
      if ('Notification' in window && Notification.permission !== 'denied') {
        setTimeout(() => ativarNotificacoes(), 1200);
      }
    }
    return;
  }
  mostrarModalInstalarApp();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** Permissão + Web Push (VAPID) — grava subscrição no servidor. */
export async function ativarNotificacoes() {
  if (!('Notification' in window)) return showToast('Notificações não suportadas neste navegador.', 'warning');
  if (!('serviceWorker' in navigator)) {
    return showToast('Service worker necessário — usa HTTPS e recarrega a página.', 'warning');
  }
  if (!('PushManager' in window)) return showToast('Push não suportado neste navegador.', 'warning');

  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    try {
      reg = await navigator.serviceWorker.register('/sw.js');
    } catch {
      return showToast('Não foi possível registar o service worker.', 'warning');
    }
  }
  reg = await navigator.serviceWorker.ready;

  const perm =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') {
    return showToast('Permissão negada — ativa nas definições do site.', 'warning');
  }

  let publicKeyB64;
  try {
    const data = await request('GET', `${API}/push/public-key`);
    publicKeyB64 = data.publicKey;
  } catch (e) {
    return showToast(e.message || 'Servidor sem push configurado.', 'warning');
  }
  if (!publicKeyB64) return showToast('Chave push indisponível.', 'warning');

  let sub;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKeyB64),
    });
  } catch (e) {
    return showToast(e.message || 'Falha ao subscrever push.', 'warning');
  }

  try {
    const json = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
    await request('POST', `${API}/push/subscribe`, json);
  } catch (e) {
    return showToast(e.message || 'Falha ao guardar subscrição no servidor.', 'warning');
  }

  completarMissao('ativar_notif', null, false);
  showToast('Push ativado — podes receber avisos com o portal fechado.', 'success');
}

export async function _prePopularCacheMissoes() {
  try {
    const data = await request('GET', `${API}/clube/stats`);
    (data.completedMissions || []).forEach(id => cacheMissao(id));
  } catch {}
}

export function mostrarBoasVindas() {
  const modal = document.getElementById('modal-boas-vindas');
  if (!modal) return;
  modal.classList.remove('hidden');
  const box = modal.querySelector('.modal');
  if (box) {
    box.style.transform = 'scale(.88) translateY(20px)';
    box.style.opacity = '0';
    box.style.transition = 'transform .4s cubic-bezier(.16,1,.3,1), opacity .3s';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        box.style.transform = 'scale(1) translateY(0)';
        box.style.opacity = '1';
      });
    });
  }
}

export function fecharBoasVindas(irParaClube = false) {
  const modal = document.getElementById('modal-boas-vindas');
  if (!modal) return;
  const box = modal.querySelector('.modal');
  if (box) {
    box.style.transform = 'scale(.92) translateY(10px)';
    box.style.opacity = '0';
    setTimeout(() => modal.classList.add('hidden'), 280);
  } else {
    modal.classList.add('hidden');
  }
  if (irParaClube) {
    setTimeout(() => go('indicacoes'), 300);
  }
}

/** Regista listeners PWA, SW e banner ?ref= (uma vez). */
export function initClubPwa() {
  initClubSegmentNav();

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _pwaPrompt = e;
    const wrap = document.getElementById('pwa-install-wrap');
    if (wrap) wrap.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    const wrap = document.getElementById('pwa-install-wrap');
    if (wrap) wrap.classList.add('hidden');
    _pwaPrompt = null;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) {
    sessionStorage.setItem('lemon_ref', ref);
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;
    background:linear-gradient(135deg,rgba(182,195,63,0.12),rgba(26,93,119,0.08));
    border-bottom:1px solid rgba(182,195,63,0.25);padding:10px 20px;
    display:flex;align-items:center;gap:10px;font-size:0.82rem;backdrop-filter:blur(12px);`;
    wrap.innerHTML = `<i class="fa-solid fa-gift" style="color:#b6c33f"></i>
    <span>Você foi indicado por <strong style="color:#41710b">${ref}</strong> — cadastre-se e aproveite!</span>
    <button onclick="this.parentElement.remove()" style="margin-left:auto;color:#7a80a0;font-size:1rem;background:none;border:none;cursor:pointer">✕</button>`;
    document.body.prepend(wrap);
  }
}
