/**
 * Stubs síncronos para onclick no index antes de `portal-app.js` (módulo) terminar de carregar.
 * Manter ids alinhados com PAGES_ONBOARDING em modules/onboarding.js.
 */
(function () {
  var CAP_IDS = [
    'page-landing',
    'page-login',
    'page-cadastro',
    'page-planos',
    'page-regiao',
    'page-realparque-enderecos',
    'page-castro-lima-condominios',
    'page-itaguai-condominios',
    'page-itaguai-299-blocos',
    'page-itaguai-299-apartamentos',
    'page-itaguai-321-blocos',
    'page-itaguai-321-apartamentos',
    'page-itaguai-torre-andar',
    'page-itaguai-torre-apartamentos',
    'page-bourroul-condominios',
    'page-bourroul-308-blocos',
    'page-bourroul-308-apartamentos',
    'page-bourroul-280-blocos',
    'page-bourroul-280-apartamentos',
    'page-bourroul-torre-apartamentos',
    'page-bourroul-cingapura-letras',
    'page-bourroul-cingapura-bloco-num',
    'page-bourroul-cingapura-apartamentos',
  ];

  function hideAllCap() {
    for (var i = 0; i < CAP_IDS.length; i++) {
      var el = document.getElementById(CAP_IDS[i]);
      if (!el) continue;
      el.classList.remove('active');
      el.classList.add('hidden');
    }
  }

  function showPage(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('active');
  }

  window.irParaLogin = function () {
    hideAllCap();
    showPage('page-login');
  };

  window.irParaEscolhaRegiao = function () {
    hideAllCap();
    showPage('page-regiao');
  };

  window.voltarLanding = function () {
    hideAllCap();
    showPage('page-landing');
  };

  window.instalarApp = function () {};
})();

/**
 * Splash (#lemon-splash): overlay permanece no DOM.
 * - Convidado: __lemonSplashScheduleGuestHide quando /session responde sem login.
 * - Com CPF / sessão: __lemonSplashShow ao iniciar entrada; __lemonSplashHide quando o dashboard terminou de carregar.
 * - Mensagens sob a logo: GET /portal/splash-mensagens (configuráveis no admin).
 */
(function () {
  var splash = document.getElementById('lemon-splash');
  if (!splash) return;

  var t0 = Date.now();
  var minMs = 900;
  var failSafeMs = 12000;
  var guestScheduled = false;
  var msgInterval = null;
  var MSG_ROTATE_MS = 3200;

  function stopMsgRotation() {
    if (msgInterval) {
      clearInterval(msgInterval);
      msgInterval = null;
    }
  }

  function startMsgRotation() {
    stopMsgRotation();
    var el = document.getElementById('lemon-splash-msg');
    if (!el) return;
    var list = window.__splashMensagensCached;
    if (!list || !list.length) list = ['Carregando…'];
    var idx = 0;
    el.textContent = list[0];
    if (list.length < 2) return;
    msgInterval = setInterval(function () {
      idx = (idx + 1) % list.length;
      el.textContent = list[idx];
    }, MSG_ROTATE_MS);
  }

  function hideSplash() {
    stopMsgRotation();
    splash.classList.add('lemon-splash--out');
  }

  function showSplash() {
    splash.classList.remove('lemon-splash--out');
    var logo = splash.querySelector('.lemon-splash__logo');
    if (logo) {
      logo.style.animation = 'none';
      void logo.offsetHeight;
      logo.style.animation = '';
    }
    startMsgRotation();
  }

  function scheduleGuestHide() {
    if (guestScheduled) return;
    guestScheduled = true;
    var wait = Math.max(0, minMs - (Date.now() - t0));
    setTimeout(hideSplash, wait);
  }

  window.__lemonSplashShow = showSplash;
  window.__lemonSplashHide = hideSplash;
  window.__lemonSplashScheduleGuestHide = scheduleGuestHide;

  fetch('/portal/splash-mensagens', { credentials: 'same-origin' })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (d && Array.isArray(d.mensagens) && d.mensagens.length) {
        window.__splashMensagensCached = d.mensagens;
      }
      if (!splash.classList.contains('lemon-splash--out')) startMsgRotation();
    })
    .catch(function () {
      if (!splash.classList.contains('lemon-splash--out')) startMsgRotation();
    });

  setTimeout(function () {
    if (!guestScheduled && !splash.classList.contains('lemon-splash--out')) hideSplash();
  }, failSafeMs);
})();
