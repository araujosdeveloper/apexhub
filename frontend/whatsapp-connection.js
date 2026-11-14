'use strict';

(() => {
  const panel = document.getElementById('whatsapp-settings');
  const button = document.getElementById('connect-whatsapp');
  const notice = document.getElementById('whatsapp-status');
  const endpoint = '/api/tenant/whatsapp-connection';

  async function api(options) {
    const response = await fetch(endpoint, { cache: 'no-store', ...options });
    if (response.status === 401 || response.status === 403) return null;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Não foi possível consultar a conexão.');
    return body;
  }

  function loadSdk(config) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
      script.async = true;
      script.onerror = reject;
      script.onload = () => {
        try {
          window.FB.init({ appId: config.appId, version: config.version, xfbml: false });
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      document.head.append(script);
    });
  }

  function launch(config) {
    button.disabled = true;
    notice.textContent = 'Conclua a autorização na janela da Meta.';
    let code;
    let account;
    let finished = false;
    const timer = setTimeout(() => finish('A autorização expirou. Tente novamente.'), 10 * 60 * 1000);

    function finish(message) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      if (message) {
        notice.textContent = message;
        button.disabled = false;
        return;
      }
      api({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...account })
      }).then(result => {
        if (!result) throw new Error('Entre novamente com a conta do proprietário.');
        showConnected(result.connection);
      }).catch(error => {
        notice.textContent = error.message;
        button.disabled = false;
      });
    }

    function receive(event) {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (message.event === 'FINISH' && message.data?.waba_id && message.data?.phone_number_id) {
        account = { wabaId: message.data.waba_id, phoneId: message.data.phone_number_id };
        if (code) finish();
      } else if (['CANCEL', 'ERROR', 'FINISH_ONLY_WABA'].includes(message.event)) {
        finish('A conexão precisa de um número comercial autorizado na Meta.');
      }
    }

    window.addEventListener('message', receive);
    try {
      window.FB.login(response => {
        code = response?.authResponse?.code;
        if (!code) finish('A autorização foi encerrada. Você pode tentar novamente.');
        else if (account) finish();
      }, {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { version: 'v4', setup: {} }
      });
    } catch {
      finish('Não foi possível abrir a janela da Meta. Tente novamente.');
    }
  }

  function showConnected(connection) {
    notice.textContent = 'Número vinculado: ' + connection.display_phone + '. Ativação do atendimento pendente.';
    button.hidden = true;
  }

  api().then(async data => {
    if (!data) return;
    panel.hidden = false;
    if (data.connection) return showConnected(data.connection);
    if (!data.eligible) {
      notice.textContent = 'Disponível no Pro ativo e durante o período de teste.';
      return;
    }
    if (!data.signup) {
      notice.textContent = 'A conexão com a Meta ainda está indisponível.';
      return;
    }
    await loadSdk(data.signup);
    notice.textContent = 'Autorize o número comercial da sua loja na Meta.';
    button.addEventListener('click', () => launch(data.signup));
    button.disabled = false;
    button.hidden = false;
  }).catch(() => {
    panel.hidden = false;
    notice.textContent = 'Não foi possível carregar a conexão do WhatsApp.';
  });
})();
