/**
 * Mercado Pago: PIX na fatura, pagamento com cartão, SDK e tokenização.
 */
import { API, MP_LOGO_IMG } from './constants.js';
import { S, app } from './state.js';
import { request } from './http.js';
import { fmt, closeModalDirect } from './format-ui.js';

function _carteiraBrandLabel(pmId) {
  const id = String(pmId || '').toUpperCase();
  if (!id) return 'Cartão';
  if (id.includes('VISA')) return 'Visa';
  if (id.includes('MASTER')) return 'Mastercard';
  if (id.includes('ELO')) return 'Elo';
  if (id.includes('AMEX')) return 'Amex';
  return id.slice(0, 12);
}

function _refreshFaturas() {
  if (typeof app.refreshFaturas === 'function') app.refreshFaturas();
}

export async function gerarPixMP(tituloUuid, valor, descricao) {
  const btn = document.getElementById('btn-mp-pix');
  const sub = document.getElementById('btn-mp-sub');
  const area = document.getElementById('mp-pix-content');
  if (!btn || !area) return;

  btn.disabled = true;
  if (sub) sub.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;margin:0"></div> Gerando PIX...';
  area.innerHTML = '';

  try {
    const res = await request('POST', `${API}/pagamento/pix`, { tituloUuid, valor, descricao });

    if (S.mpPollingInterval) clearInterval(S.mpPollingInterval);

    const expira = res.expira ? new Date(res.expira) : null;

    area.innerHTML = `
      <div style="background:linear-gradient(135deg,rgba(0,158,227,.1),rgba(0,122,184,.05));border:1px solid rgba(0,158,227,.28);border-radius:14px;padding:20px;text-align:center">
        <div style="font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:12px">
          <i class="fa-solid fa-circle-check" style="color:#009ee3;margin-right:4px"></i>PIX gerado com sucesso
        </div>

        ${res.qrBase64 ? `
          <div style="background:#fff;border-radius:12px;padding:12px;display:inline-block;margin-bottom:14px;box-shadow:0 2px 12px rgba(15,22,40,.08)">
            <img src="data:image/png;base64,${res.qrBase64}" alt="QR Code PIX" style="width:200px;height:200px;display:block" />
          </div>` : ''}

        <div style="font-size:1.3rem;font-weight:800;color:#0077b6;margin-bottom:4px">
          R$ ${parseFloat(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:16px">
          ${expira ? `Expira em: ${expira.toLocaleString('pt-BR')}` : 'PIX válido por 10 minutos'}
        </div>

        <textarea readonly onclick="this.select();this.setSelectionRange(0,this.value.length)" style="width:100%;background:#fff;border:1px solid var(--glass-border);border-radius:8px;padding:10px 12px;font-size:.72rem;font-family:monospace;color:var(--text);word-break:break-all;text-align:left;margin-bottom:10px;height:72px;resize:none;cursor:pointer" id="mp-pix-code">${res.qrCode || ''}</textarea>
        <button class="copy-btn" style="width:100%;justify-content:center;margin-bottom:12px"
          onclick="copiar('${(res.qrCode || '').replace(/'/g, "\\'")}', this)">
          <i class="fa-solid fa-copy"></i> Copiar PIX Copia e Cola
        </button>

        <div id="mp-status-badge" style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;font-size:.78rem;font-weight:600;background:rgba(251,191,36,.12);color:#b45309;border:1px solid rgba(251,191,36,.35)">
          <div class="spinner" style="width:10px;height:10px;border-width:1.5px;border-color:rgba(251,191,36,.3);border-top-color:#d97706"></div>
          Aguardando pagamento...
        </div>
        <div style="font-size:.68rem;color:var(--text-muted);margin-top:8px">Verificando automaticamente a cada 5 segundos</div>
      </div>
    `;

    const mpId = res.mpId;
    let tentativas = 0;
    S.mpPollingInterval = setInterval(async () => {
      tentativas++;
      if (tentativas > 72) {
        clearInterval(S.mpPollingInterval);
        S.mpPollingInterval = null;
        return;
      }
      try {
        const st = await request('GET', `${API}/pagamento/status/${mpId}`);
        const badge = document.getElementById('mp-status-badge');
        if (!badge) {
          clearInterval(S.mpPollingInterval);
          S.mpPollingInterval = null;
          return;
        }

        if (st.status === 'approved') {
          clearInterval(S.mpPollingInterval);
          S.mpPollingInterval = null;
          badge.style.background = 'rgba(74,222,128,.15)';
          badge.style.color = '#166534';
          badge.style.border = '1px solid rgba(74,222,128,.35)';
          badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Pagamento confirmado! Dando baixa...';

          try {
            await request('POST', `${API}/pagamento/baixa`, {
              mpId,
              tituloUuid: st.external_reference,
              valor: st.valor,
            });
          } catch {}

          badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Pagamento confirmado! ✓';
          setTimeout(() => {
            closeModalDirect();
            _refreshFaturas();
          }, 2000);
        } else if (st.status === 'rejected' || st.status === 'cancelled') {
          clearInterval(S.mpPollingInterval);
          S.mpPollingInterval = null;
          badge.style.background = 'rgba(239,68,68,.12)';
          badge.style.color = '#ef4444';
          badge.style.border = '1px solid rgba(239,68,68,.25)';
          badge.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Pagamento recusado';
        }
      } catch {}
    }, 5000);

    btn.style.display = 'none';
    if (sub) sub.style.display = 'none';
  } catch (e) {
    area.innerHTML = `<div style="color:#ef4444;font-size:.83rem;padding:10px;background:rgba(239,68,68,.08);border-radius:8px;border:1px solid rgba(239,68,68,.2)"><i class="fa-solid fa-circle-xmark"></i> ${e.message}</div>`;
    btn.disabled = false;
    btn.innerHTML = `${MP_LOGO_IMG} Pagar via PIX`;
    if (sub) sub.disabled = false;
  }
}

function _loadMercadoPagoSdk() {
  return new Promise((resolve, reject) => {
    if (window.MercadoPago) return resolve();
    const s = document.createElement('script');
    s.src = 'https://sdk.mercadopago.com/js/v2';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar SDK do Mercado Pago'));
    document.head.appendChild(s);
  });
}

export async function _mpCriarCardToken(publicKey, dados) {
  await _loadMercadoPagoSdk();
  const MP = window.MercadoPago;
  if (!MP) throw new Error('MercadoPago SDK indisponível');
  const mp = new MP(publicKey, { locale: 'pt-BR' });
  const num = (dados.numero || '').replace(/\D/g, '');
  const cpf = (dados.cpf || '').replace(/\D/g, '');
  const mes = String(dados.mes || '').replace(/\D/g, '').padStart(2, '0');
  let ano = String(dados.ano || '').replace(/\D/g, '');
  if (ano.length === 2) ano = '20' + ano;
  const body = {
    cardNumber: num,
    cardholderName: (dados.nome || '').trim(),
    cardExpirationMonth: mes,
    cardExpirationYear: ano,
    securityCode: String(dados.cvv || '').replace(/\D/g, ''),
    identificationType: 'CPF',
    identificationNumber: cpf,
  };
  let out;
  try {
    if (typeof mp.createCardToken === 'function') {
      out = await mp.createCardToken(body);
    } else if (mp.fields && typeof mp.fields.createCardToken === 'function') {
      out = await mp.fields.createCardToken(body);
    }
  } catch (e1) {
    out = null;
  }
  let id = out && (out.id || out.token);
  if (id) return id;

  const anoN = parseInt(body.cardExpirationYear, 10);
  const mesN = parseInt(body.cardExpirationMonth, 10);
  const r = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(publicKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      card_number: body.cardNumber,
      security_code: body.securityCode,
      expiration_month: mesN,
      expiration_year: anoN,
      cardholder: {
        name: body.cardholderName,
        identification: { type: 'CPF', number: body.identificationNumber },
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || j.cause || 'Não foi possível tokenizar o cartão');
  if (!j.id) throw new Error('Resposta sem token do Mercado Pago');
  return j.id;
}

function _mpPagamentoAvisoHtml(cfg) {
  if (!cfg || typeof cfg !== 'object') return '';
  if (cfg.chavesAlinhadas === false) {
    return `<div class="mp-ambiente-aviso mp-ambiente-aviso--erro">${fmt(cfg.dica)}</div>`;
  }
  if (cfg.ambiente === 'teste' && cfg.cartoesSandbox) {
    const s = cfg.cartoesSandbox;
    return `<div class="mp-ambiente-aviso mp-ambiente-aviso--sandbox"><strong>Sandbox</strong> — Cartão de teste: Master <code>${s.master}</code> ou Visa <code>${s.visa}</code> · CVV <code>${s.cvv}</code> · Titular <code>${s.titular}</code> · CPF <code>${s.cpf}</code></div>`;
  }
  if (cfg.ambiente === 'producao' && cfg.dica) {
    return `<div class="mp-ambiente-aviso mp-ambiente-aviso--prod">${fmt(cfg.dica)}</div>`;
  }
  return '';
}

export async function preencherCarteiraMpAviso() {
  const wrap = document.getElementById('carteira-mp-ambiente');
  if (!wrap) return;
  wrap.innerHTML = '<div class="spinner" style="width:18px;height:18px;margin:6px 0"></div>';
  try {
    const cfg = await request('GET', `${API}/pagamento/config`);
    wrap.innerHTML = _mpPagamentoAvisoHtml(cfg) || '';
  } catch {
    wrap.innerHTML = '';
  }
}

export function fecharFormAssinaturaMP() {
  const box = document.getElementById('mp-sub-content');
  const btn = document.getElementById('btn-mp-sub');
  const pix = document.getElementById('btn-mp-pix');
  try {
    if (S.mpSubCtx && typeof S.mpSubCtx._scUnmount === 'function') S.mpSubCtx._scUnmount();
  } catch (_) {}
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
  }
  S.mpSubCtx = null;
  if (btn) btn.disabled = false;
  if (pix) pix.disabled = false;
}

function _mpSubUnmountCvv() {
  if (S.mpSubCtx && typeof S.mpSubCtx._scUnmount === 'function') {
    try {
      S.mpSubCtx._scUnmount();
    } catch (_) {}
    S.mpSubCtx._scUnmount = null;
  }
  const m = document.getElementById('mp-sub-cvv-mount');
  if (m) m.innerHTML = '';
}

async function _mpSubMountCvv(mp) {
  const mountId = 'mp-sub-cvv-mount';
  const el = document.getElementById(mountId);
  if (!el || !mp?.fields?.create) return;
  _mpSubUnmountCvv();
  try {
    const sc = mp.fields.create('securityCode', {
      placeholder: 'CVV',
      style: {
        color: '#141824',
        fontSize: '15px',
        fontWeight: '500',
        placeholderColor: '#64748b',
        height: '34px',
        paddingTop: '6px',
        paddingBottom: '6px',
        paddingLeft: '4px',
        paddingRight: '4px',
      },
    });
    sc.mount(mountId);
    S.mpSubCtx._scUnmount = () => {
      try {
        if (typeof sc.unmount === 'function') sc.unmount();
      } catch (_) {}
    };
  } catch (e) {
    console.warn('[MP] Campo CVV (cartão salvo):', e);
  }
}

export async function abrirFormAssinaturaMP(tituloUuid, valor, descricao) {
  const box = document.getElementById('mp-sub-content');
  const btn = document.getElementById('btn-mp-sub');
  const pix = document.getElementById('btn-mp-pix');
  if (!box) return;
  if (box.style.display === 'block' && tituloUuid && S.mpSubCtx?.tituloUuid === tituloUuid) {
    fecharFormAssinaturaMP();
    return;
  }
  const cpfCliente =
    S.clienteData && (S.clienteData.cpf_cnpj || '')
      ? String(S.clienteData.cpf_cnpj).replace(/\D/g, '')
      : '';
  S.mpSubCtx = { tituloUuid, valor, descricao };
  box.style.display = 'block';
  box.innerHTML =
    '<div style="padding:20px;text-align:center"><div class="spinner" style="margin:0 auto"></div><div style="font-size:.75rem;color:var(--text-muted);margin-top:10px">Carregando carteira...</div></div>';
  if (btn) btn.disabled = true;
  if (pix) pix.disabled = true;

  const prCart = request('GET', `${API}/carteira`).catch(() => ({ cards: [] }));
  const prCfg = request('GET', `${API}/pagamento/config`).catch(() => ({}));
  const [cr, mpCfg] = await Promise.all([prCart, prCfg]);
  const saved = cr.cards || [];
  const avisoTop = _mpPagamentoAvisoHtml(mpCfg);

  S.mpSubCtx.savedCards = saved;

  const flowVal = saved.length ? 'saved' : 'novo';
  const savedRows = saved
    .map((c, i) => {
      const cid = String(c.mp_card_id || '').replace(/"/g, '');
      const last = fmt(c.last_four);
      const bl = _carteiraBrandLabel(c.payment_method_id);
      return `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border-radius:10px;border:1px solid var(--glass-border);background:#fff;box-shadow:0 1px 2px rgba(15,22,40,.04)">
        <input type="radio" name="mp-sub-card" value="${cid}" ${i === 0 ? 'checked' : ''} />
        <span style="font-size:.85rem;font-weight:600;color:var(--text)">${bl} · •••• ${last}</span>
      </label>`;
    })
    .join('');

  const savedBlock = saved.length
    ? `<div id="mp-sub-saved-block">
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:10px;line-height:1.45">
          Cartão da <strong style="color:var(--text)">sua carteira</strong>. Informe o <strong style="color:var(--text)">CVV</strong> (Mercado Pago exige de novo por segurança).
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">${savedRows}</div>
        <div style="font-size:.65rem;color:var(--text-muted);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Código de segurança (CVV)</div>
        <div id="mp-sub-cvv-mount" class="mp-sub-cvv-mount" style="margin-bottom:12px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;padding:2px 6px;max-width:140px"></div>
        <button type="button" id="mp-sub-show-novo" style="width:100%;background:transparent;border:none;color:var(--lemon-dark);font-size:.78rem;font-weight:600;cursor:pointer;margin-bottom:10px;text-decoration:underline">
          Usar outro cartão (digitar número completo)
        </button>
      </div>`
    : '';

  const novoBlock = `<div id="mp-sub-novo-block" style="display:${saved.length ? 'none' : 'block'}">
      <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:10px;line-height:1.45">Cobrança imediata do valor desta fatura no cartão (não é só verificação).</div>
      <input type="text" id="mp-sub-nome" placeholder="Nome impresso no cartão" autocomplete="cc-name" style="width:100%;margin-bottom:8px;padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem" />
      <input type="text" id="mp-sub-num" placeholder="Número do cartão" inputmode="numeric" autocomplete="cc-number" style="width:100%;margin-bottom:8px;padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem" />
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
        <input type="text" id="mp-sub-mes" placeholder="MM" maxlength="2" inputmode="numeric" autocomplete="cc-exp-month" style="padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem" />
        <input type="text" id="mp-sub-ano" placeholder="AAAA" maxlength="4" inputmode="numeric" autocomplete="cc-exp-year" style="padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem" />
        <input type="text" id="mp-sub-cvv" placeholder="CVV" maxlength="4" inputmode="numeric" autocomplete="cc-csc" style="padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem" />
      </div>
      <input type="text" id="mp-sub-cpf" placeholder="CPF do titular" value="${cpfCliente}" inputmode="numeric" style="width:100%;margin-bottom:12px;padding:10px;border-radius:8px;border:1px solid var(--glass-border);background:#fff;color:var(--text);font-size:.85rem" />
      ${saved.length ? `<button type="button" id="mp-sub-show-saved" style="width:100%;background:transparent;border:none;color:var(--lemon-dark);font-size:.78rem;font-weight:600;cursor:pointer;margin-bottom:10px;text-decoration:underline">Voltar ao cartão da carteira</button>` : ''}
    </div>`;

  box.innerHTML = `
    <div class="mp-sub-panel" style="background:linear-gradient(180deg,rgba(0,158,227,.08) 0%,rgba(255,255,255,.95) 40%);border:1px solid rgba(0,158,227,.22);border-radius:12px;padding:14px;text-align:left">
      ${avisoTop}
      <input type="hidden" id="mp-sub-flow" value="${flowVal}" />
      ${savedBlock}
      ${novoBlock}
      <button type="button" id="mp-sub-confirm" class="btn btn-primary" style="width:100%;justify-content:center;background:linear-gradient(135deg,#009ee3,#007ab8);color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700">
        Pagar com cartão
      </button>
      <button type="button" onclick="fecharFormAssinaturaMP()" style="width:100%;margin-top:8px;background:transparent;border:none;color:var(--text-muted);font-size:.72rem;font-weight:600;cursor:pointer">Cancelar</button>
    </div>`;

  document.getElementById('mp-sub-confirm').onclick = () => confirmarAssinaturaComToken();

  if (saved.length) {
    document.getElementById('mp-sub-show-novo').onclick = () => {
      document.getElementById('mp-sub-flow').value = 'novo';
      document.getElementById('mp-sub-saved-block').style.display = 'none';
      document.getElementById('mp-sub-novo-block').style.display = 'block';
      _mpSubUnmountCvv();
    };
    const back = document.getElementById('mp-sub-show-saved');
    if (back) {
      back.onclick = async () => {
        document.getElementById('mp-sub-flow').value = 'saved';
        document.getElementById('mp-sub-saved-block').style.display = 'block';
        document.getElementById('mp-sub-novo-block').style.display = 'none';
        if (S.mpSubCtx?.mp) await _mpSubMountCvv(S.mpSubCtx.mp);
      };
    }
  }

  try {
    const cfg = await request('GET', `${API}/pagamento/config`);
    const pub = cfg.publicKey;
    if (!pub) throw new Error('Public Key do Mercado Pago não configurada no servidor.');
    await _loadMercadoPagoSdk();
    const MP = window.MercadoPago;
    if (!MP) throw new Error('MercadoPago SDK indisponível');
    const mp = new MP(pub, { locale: 'pt-BR' });
    S.mpSubCtx.mp = mp;
    S.mpSubCtx.publicKey = pub;
    if (saved.length) await _mpSubMountCvv(mp);
  } catch (e) {
    box.innerHTML = `<div style="color:#ef4444;font-size:.83rem;padding:12px;background:rgba(239,68,68,.08);border-radius:8px;border:1px solid rgba(239,68,68,.2)"><i class="fa-solid fa-circle-xmark"></i> ${e.message || 'Erro ao preparar pagamento'}</div>`;
    if (btn) btn.disabled = false;
    if (pix) pix.disabled = false;
    S.mpSubCtx = null;
  }
}

const _mpBtnCartaoLabel = 'Pagar com cartão';

async function _mpFinalizarCartaoPortal(resposta, tituloUuid, valor, cbtn) {
  const { mpId, status, pollBaixa, valor: vServ } = resposta;
  const valorNum = vServ != null ? parseFloat(vServ) : parseFloat(valor);

  if (status === 'approved' && mpId) {
    try {
      await request('POST', `${API}/pagamento/baixa`, {
        mpId,
        tituloUuid,
        valor: valorNum,
      });
    } catch (e) {
      console.warn(e);
    }
    alert('Pagamento no cartão aprovado! Sua fatura foi baixada.');
    if (cbtn) {
      cbtn.disabled = false;
      cbtn.textContent = _mpBtnCartaoLabel;
    }
    closeModalDirect();
    _refreshFaturas();
    return;
  }

  if (pollBaixa && mpId) {
    if (cbtn) cbtn.textContent = 'Aguardando confirmação...';
    let tentativas = 0;
    const maxT = 90;
    const tick = async () => {
      tentativas += 1;
      if (tentativas > maxT) {
        if (cbtn) {
          cbtn.disabled = false;
          cbtn.textContent = _mpBtnCartaoLabel;
        }
        alert('O pagamento ainda está em análise. Atualize a lista de faturas em alguns minutos.');
        return;
      }
      try {
        const st = await request('GET', `${API}/pagamento/status/${mpId}`);
        if (st.status === 'approved') {
          try {
            await request('POST', `${API}/pagamento/baixa`, {
              mpId,
              tituloUuid: st.external_reference || tituloUuid,
              valor: st.valor != null ? st.valor : valorNum,
            });
          } catch (e) {
            console.warn(e);
          }
          alert('Pagamento no cartão aprovado! Sua fatura foi baixada.');
          if (cbtn) {
            cbtn.disabled = false;
            cbtn.textContent = _mpBtnCartaoLabel;
          }
          closeModalDirect();
          _refreshFaturas();
          return;
        }
        if (st.status === 'rejected' || st.status === 'cancelled') {
          if (cbtn) {
            cbtn.disabled = false;
            cbtn.textContent = _mpBtnCartaoLabel;
          }
          alert('Pagamento recusado ou cancelado.');
          return;
        }
      } catch (_) {}
      setTimeout(tick, 4000);
    };
    setTimeout(tick, 2000);
    return;
  }

  throw new Error('Resposta inesperada do servidor');
}

export async function confirmarAssinaturaComToken() {
  if (!S.mpSubCtx) return;
  const { tituloUuid, valor, descricao, mp, savedCards, publicKey } = S.mpSubCtx;
  const flow = document.getElementById('mp-sub-flow')?.value || 'novo';
  const cbtn = document.getElementById('mp-sub-confirm');

  try {
    const cfgChk = await request('GET', `${API}/pagamento/config`);
    if (cfgChk.chavesAlinhadas === false) {
      alert(cfgChk.dica || 'Credenciais Mercado Pago inconsistentes.');
      return;
    }
  } catch (_) {}

  if (flow === 'saved' && savedCards?.length && mp?.fields?.createCardToken) {
    const sel = document.querySelector('input[name="mp-sub-card"]:checked');
    const cardId = sel?.value?.trim();
    if (!cardId) {
      alert('Selecione um cartão da carteira.');
      return;
    }
    const cardRow = (savedCards || []).find(c => String(c.mp_card_id) === cardId);
    const mpCustomerId = cardRow?.mp_customer_id ? String(cardRow.mp_customer_id).trim() : '';
    if (!mpCustomerId) {
      alert('Cartão sem vínculo ao cliente no Mercado Pago. Remova-o da carteira e cadastre de novo.');
      return;
    }
    if (cbtn) {
      cbtn.disabled = true;
      cbtn.textContent = 'Processando...';
    }
    try {
      let tokenOut;
      try {
        tokenOut = await mp.fields.createCardToken({ cardId, customerId: mpCustomerId });
      } catch (e1) {
        try {
          tokenOut = await mp.fields.createCardToken({ cardId, customer_id: mpCustomerId });
        } catch (e2) {
          throw new Error((e1 && e1.message) || (e2 && e2.message) || 'Informe o CVV no campo acima e tente de novo.');
        }
      }
      const cardToken = tokenOut?.id || tokenOut?.token;
      if (!cardToken) throw new Error('Não foi possível gerar o token do cartão salvo.');
      const res = await request('POST', `${API}/mp/assinatura`, {
        tituloUuid,
        valor,
        descricao,
        cardToken,
        mpCustomerId,
      });
      if (res.ok && (res.modo === 'pagamento_cartao' || res.modo === 'pagamento_cartao_pendente')) {
        await _mpFinalizarCartaoPortal(res, tituloUuid, valor, cbtn);
        return;
      }
      throw new Error('Resposta inesperada do servidor');
    } catch (e) {
      alert(e.message || 'Não foi possível concluir o pagamento no cartão.');
      if (cbtn) {
        cbtn.disabled = false;
        cbtn.textContent = _mpBtnCartaoLabel;
      }
    }
    return;
  }

  const nome = document.getElementById('mp-sub-nome')?.value || '';
  const numero = document.getElementById('mp-sub-num')?.value || '';
  const mes = document.getElementById('mp-sub-mes')?.value || '';
  const ano = document.getElementById('mp-sub-ano')?.value || '';
  const cvv = document.getElementById('mp-sub-cvv')?.value || '';
  const cpf = document.getElementById('mp-sub-cpf')?.value || '';
  if (!nome || !numero || !mes || !ano || !cvv || cpf.length < 11) {
    alert('Preencha todos os campos do cartão e CPF (11 dígitos).');
    return;
  }
  if (cbtn) {
    cbtn.disabled = true;
    cbtn.textContent = 'Processando...';
  }
  try {
    const pub = publicKey || (await request('GET', `${API}/pagamento/config`)).publicKey;
    if (!pub) throw new Error('Public Key do Mercado Pago não configurada no servidor.');
    const cardToken = await _mpCriarCardToken(pub, { nome, numero, mes, ano, cvv, cpf });
    const res = await request('POST', `${API}/mp/assinatura`, { tituloUuid, valor, descricao, cardToken });
    if (res.ok && (res.modo === 'pagamento_cartao' || res.modo === 'pagamento_cartao_pendente')) {
      await _mpFinalizarCartaoPortal(res, tituloUuid, valor, cbtn);
      return;
    }
    throw new Error('Resposta inesperada do servidor');
  } catch (e) {
    alert(e.message || 'Não foi possível concluir o pagamento no cartão.');
    if (cbtn) {
      cbtn.disabled = false;
      cbtn.textContent = _mpBtnCartaoLabel;
    }
  }
}

export async function assinaturaMercadoPagoHosted(tituloUuid, valor, descricao) {
  const res = await request('POST', `${API}/mp/assinatura`, { tituloUuid, valor, descricao, hostedCheckout: true });
  if (res.initPoint) window.location.href = res.initPoint;
  else throw new Error('Link não retornado');
}
