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

  function launch(config, reconnect) {
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
        body: JSON.stringify({ code, ...account, reconnect })
      }).then(result => {
        if (!result) throw new Error('Entre novamente com a conta do proprietário.');
        window.location.reload();
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

  const test = document.getElementById('test-whatsapp');
  const toggle = document.getElementById('toggle-whatsapp');
  const disconnect = document.getElementById('disconnect-whatsapp');

  function render(data) {
    const { connection, eligible } = data;
    notice.textContent = connection
      ? 'Número vinculado: ' + connection.display_phone + '. ' + (!eligible
        ? 'Seu plano não libera a automação.' : Number(connection.automation_enabled)
          ? 'Automação ativa.' : 'Automação pausada.')
      : eligible ? 'Autorize o número comercial da sua loja na Meta.' : 'Disponível no Pro ativo e durante o período de teste.';
    test.hidden = !connection || !eligible;
    toggle.hidden = !connection || (!eligible && !Number(connection.automation_enabled));
    disconnect.hidden = !connection;
    toggle.textContent = Number(connection?.automation_enabled) ? 'Pausar automação' : 'Ativar automação';
  }

  async function action(name) {
    const controls = [test, toggle, disconnect, button];
    controls.forEach(control => { control.disabled = true; });
    try {
      const result = await api({
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name })
      });
      if (!result) throw new Error('Entre novamente com a conta do proprietário.');
      if (name === 'test') notice.textContent = 'A Meta confirmou o acesso ao número e a inscrição da conta no webhook.';
      else window.location.reload();
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      controls.forEach(control => { control.disabled = false; });
    }
  }

  async function loadNoticeHistory() {
    const response = await fetch(endpoint + '/notices', { cache: 'no-store' });
    if (!response.ok) return;
    const { available, notices } = await response.json();
    if (!available) return;
    const states = { queued: 'Em fila', uncertain: 'Resultado incerto', accepted: 'Aceito pela Meta',
      delivered: 'Entregue', rejected: 'Falhou', suppressed: 'Suprimido' };
    const kinds = { preparing: 'Em preparo', ready: 'Pronto para retirada', delivering: 'Saiu para entrega', cancelled: 'Cancelado' };
    const list = document.getElementById('whatsapp-notice-list');
    list.replaceChildren(...(notices.length ? notices : [null]).map(notice => {
      const li = document.createElement('li');
      li.textContent = notice ? 'Pedido #' + notice.order_id + ' · ' + kinds[notice.kind] + ' · ' + states[notice.state]
        : 'Nenhum aviso registrado.';
      return li;
    }));
    document.getElementById('whatsapp-notice-history').hidden = false;
  }

  api().then(async data => {
    if (!data) return;
    panel.hidden = false;
    render(data);
    loadNoticeHistory().catch(() => {});
    test.onclick = () => action('test');
    toggle.onclick = () => action(Number(data.connection?.automation_enabled) ? 'pause' : 'activate');
    disconnect.onclick = () => {
      if (window.confirm('Desconectar este número do Apex?')) action('disconnect');
    };
    if (!data.signup) {
      if (!data.connection && data.eligible) notice.textContent = 'A conexão com a Meta ainda está indisponível.';
      return;
    }
    try {
      await loadSdk(data.signup);
    } catch {
      notice.textContent = 'Não foi possível carregar a autorização da Meta.';
      return;
    }
    button.textContent = data.connection ? 'Reconectar número' : 'Conectar WhatsApp';
    button.addEventListener('click', () => launch(data.signup, Boolean(data.connection)));
    button.disabled = false;
    button.hidden = false;
  }).catch(() => {
    panel.hidden = false;
    notice.textContent = 'Não foi possível carregar a conexão do WhatsApp.';
  });
})();
