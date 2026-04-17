/**
 * Preferências de Web Push e área "Notificações" do portal.
 */
import { API } from './constants.js';
import { request } from './http.js';
import { showToast } from './format-ui.js';
import { ativarNotificacoes } from './club.js';

let _saving = false;

function permLabel() {
  if (!('Notification' in window)) return 'Não suportado neste navegador';
  if (Notification.permission === 'granted') return 'Permitidas';
  if (Notification.permission === 'denied') return 'Bloqueadas nas definições do site';
  return 'Ainda não pedidas';
}

function setToggleDisabled(disabled) {
  const a = document.getElementById('notif-pref-fatura');
  const b = document.getElementById('notif-pref-avisos');
  if (a) a.disabled = disabled;
  if (b) b.disabled = disabled;
}

export async function loadNotificacoes() {
  const statusEl = document.getElementById('notif-push-status');
  const subEl = document.getElementById('notif-has-subscription');
  if (statusEl) statusEl.textContent = permLabel();
  setToggleDisabled(true);
  try {
    const data = await request('GET', `${API}/notificacoes/prefs`);
    const p = data.prefs || {};
    const f = document.getElementById('notif-pref-fatura');
    const av = document.getElementById('notif-pref-avisos');
    if (f) f.checked = !!p.faturaVencimento;
    if (av) av.checked = !!p.avisosLemon;
    if (subEl) {
      subEl.textContent = data.hasSubscription
        ? 'Este dispositivo está inscrito para receber push.'
        : 'Nenhuma inscrição push neste servidor (ativa em "Ativar neste dispositivo").';
    }
  } catch (e) {
    showToast(e.message || 'Erro ao carregar notificações.', 'error');
  } finally {
    setToggleDisabled(false);
  }
}

export async function setPushNotifPref(key, checked) {
  if (_saving) return;
  const body = {};
  if (key === 'faturaVencimento') body.faturaVencimento = !!checked;
  else if (key === 'avisosLemon') body.avisosLemon = !!checked;
  else return;
  _saving = true;
  setToggleDisabled(true);
  try {
    await request('PUT', `${API}/notificacoes/prefs`, body);
    showToast('Preferência guardada.', 'success');
  } catch (e) {
    showToast(e.message || 'Erro ao guardar.', 'error');
    await loadNotificacoes();
  } finally {
    _saving = false;
    setToggleDisabled(false);
  }
}

export async function ativarPushNesteDispositivo() {
  await ativarNotificacoes();
  await loadNotificacoes();
}

export async function desativarPushNesteDispositivo() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return showToast('Push não disponível neste navegador.', 'warning');
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const json = typeof sub.toJSON === 'function' ? sub.toJSON() : { endpoint: sub.endpoint };
      try {
        await request('POST', `${API}/push/unsubscribe`, { endpoint: json.endpoint || sub.endpoint });
      } catch (e) {
        showToast(e.message || 'Erro ao remover no servidor.', 'warning');
      }
      await sub.unsubscribe();
    }
    showToast('Inscrição push removida neste dispositivo.', 'success');
  } catch (e) {
    showToast(e.message || 'Erro ao desativar.', 'error');
  }
  await loadNotificacoes();
}
