'use strict';

const el = id => document.getElementById(id);
const base = '/api/tenant/whatsapp-attendance';
const labels = { waiting: 'Aguardando equipe', human: 'Em atendimento', bot: 'Bot ativo',
  accepted: 'Aceita pela Meta', uncertain: 'Resultado incerto', rejected: 'Recusada pela Meta' };
let selected;
let pending;
let busy = false;

async function api(path = '', payload) {
  const response = await fetch(base + path, { cache: 'no-store', ...(payload ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível acessar este atendimento.');
  return data;
}

function list(id, values) {
  el(id).replaceChildren(...values.map(value => {
    const li = document.createElement('li');
    li.append(value);
    return li;
  }));
}

async function refresh() {
  const { conversations } = await api();
  list('conversations', conversations.map(conversation => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = conversation.sender + ' · ' + labels[conversation.state];
    button.onclick = () => run(async () => {
      if (selected !== conversation.sender) {
        pending = null;
        el('body').value = '';
      }
      selected = conversation.sender;
      await show();
    });
    return button;
  }));
  if (selected) await show();
  if (!selected && !conversations.length) el('status').textContent = 'Nenhum atendimento aguardando a equipe.';
}

async function show() {
  const data = await api('/' + selected);
  el('detail').hidden = false;
  el('conversation-title').textContent = selected + ' · ' + labels[data.conversation.state];
  const mine = data.conversation.state === 'human' && Number(data.conversation.actor_id) === Number(data.actorId);
  el('claim').hidden = data.conversation.state !== 'waiting';
  el('resume').hidden = el('reply').hidden = !mine;
  const timeline = [
    ...data.messages.map(m => ({ at: m.received_at, label: 'Cliente: ' + (m.body || m.message_type) })),
    ...data.replies.map(m => ({ at: m.created_at, label: 'Equipe (' + labels[m.state] + '): ' + m.body }))
  ];
  timeline.sort((a, b) => new Date(a.at) - new Date(b.at));
  list('history', timeline.map(message => message.label));
  const items = typeof data.items === 'string' ? JSON.parse(data.items) : data.items;
  list('items', items.map(item => item.quantity + ' × ' + (item.product_name || 'produto ' + item.product_id) +
    Object.entries(item.option_quantities || {}).map(([name, quantity]) => ' + ' + quantity + ' × ' + name).join('') +
    (item.notes ? ' (' + item.notes + ')' : '')));
}

async function run(work) {
  if (busy) return;
  busy = true;
  el('status').textContent = '';
  try { await work(); }
  catch (error) { el('status').textContent = error.message; }
  finally { busy = false; }
}

el('refresh').onclick = () => run(refresh);
for (const action of ['claim', 'resume']) {
  el(action).onclick = () => run(async () => {
    await api('/' + selected, { action });
    await refresh();
  });
}
el('reply').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    const body = el('body').value.trim();
    if (!pending || pending.body !== body) pending = { body, requestKey: crypto.randomUUID() };
    const { state } = await api('/' + selected, { action: 'reply', ...pending });
    pending = null;
    el('body').value = '';
    await show();
    el('status').textContent = labels[state];
  });
};
run(refresh);
