// yxorp web UI — plain JS, no build step. Every value that comes from traffic
// or the config is rendered with textContent (see `h()`), never as HTML.
'use strict';

const TOKEN = document.querySelector('meta[name="yxorp-token"]').content;
const MAX_ROWS = 500;

const SECTIONS = [
  { key: 'mockRules', title: 'Mock rules', hint: 'Answer requests locally' },
  { key: 'rewriteRules', title: 'Rewrite rules', hint: 'Change responses from the target' },
  { key: 'requestRules', title: 'Request rules', hint: 'Change requests on their way to the target' },
  { key: 'remoteRules', title: 'Remote rules', hint: 'Route paths to another target' },
  { key: 'staticRules', title: 'Static rules', hint: 'Serve local files' },
];

const TEMPLATES = {
  mockRules: { method: 'GET', path: '/api/example', json: { hello: 'from yxorp' } },
  rewriteRules: { method: 'GET', path: '/api/example', json: { rewritten: true } },
  requestRules: { method: 'GET', path: '/api/example', headers: { 'x-debug': '1' } },
  remoteRules: { path: '/api/v2{/*rest}', target: 'http://localhost:4000' },
  staticRules: { path: '/assets', directory: './static' },
};

const state = {
  info: null,
  traffic: [],
  selectedId: null,
  detail: null,
  filter: '',
  follow: true,
  tab: 'traffic',
};

// ---------------------------------------------------------------- helpers

/** Creates an element; strings/numbers among `children` become text nodes. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);

  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else if (name === 'class') el.className = value;
    else if (name === 'checked' || name === 'disabled' || name === 'value') el[name] = value;
    else el.setAttribute(name, value === true ? '' : String(value));
  }

  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return el;
}

const $ = (id) => document.getElementById(id);

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { 'x-yxorp-token': TOKEN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.errors = data.errors;
    throw error;
  }

  return data;
}

function toast(message, kind) {
  const el = h('div', { class: `toast ${kind || ''}` }, message);
  $('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

function showError(error) {
  toast([error.message, ...(error.errors || [])].join('\n'), 'error');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

function prettyBody(body) {
  if (body.encoding === 'base64') return `(binary, ${formatSize(body.size)})`;
  try {
    return JSON.stringify(JSON.parse(body.text), null, 2);
  } catch {
    return body.text;
  }
}

function basename(file) {
  return file.split(/[\\/]/).pop();
}

/** Opens a modal; `actions` are [label, handler(close), className]. A handler that throws keeps the modal open. */
function modal(title, body, actions) {
  const errors = h('ul', { class: 'errors hidden' });
  const dialog = h('dialog', {},
    h('div', { class: 'modal-head' }, title),
    h('div', { class: 'modal-body' }, errors, body),
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: () => dialog.close() }, 'Cancel'),
      actions.map(([label, handler, className]) => h('button', {
        class: `btn ${className || ''}`,
        onclick: async () => {
          try {
            await handler();
            dialog.close();
          } catch (error) {
            errors.replaceChildren(...[error.message, ...(error.errors || [])].map(text => h('li', {}, text)));
            errors.classList.remove('hidden');
          }
        },
      }, label)),
    ),
  );

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function parseJsonField(text, name) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}`, { cause: error });
  }
}

// ---------------------------------------------------------------- header & tabs

function renderHeader() {
  const info = state.info;
  $('proxy-url').textContent = info.proxyUrl;
  $('target-url').textContent = info.target;
  $('store-info').textContent = `store: ${info.store.size} key${info.store.size === 1 ? '' : 's'}`;
  $('store-info').title = info.store.keys.join(', ');

  const select = $('profile-select');
  select.replaceChildren(
    h('option', { value: '' }, '(none)'),
    ...info.profiles.map(name => h('option', { value: name }, name)),
  );
  select.value = info.profile || '';
  select.disabled = !info.writable || info.profileFromCli || !info.profiles.length;
  select.title = info.profileFromCli ? 'Set by --profile on the command line' : '';
}

$('profile-select').addEventListener('change', async (event) => {
  try {
    state.info = await api('PUT', '/api/profile', { profile: event.target.value || null });
    renderAll();
    toast(event.target.value ? `Profile "${event.target.value}" active` : 'No profile active');
  } catch (error) {
    showError(error);
    renderHeader();
  }
});

$('store-reset').addEventListener('click', async () => {
  try {
    await api('POST', '/api/store/reset');
    await loadState();
    toast('Store cleared');
  } catch (error) {
    showError(error);
  }
});

$('tabs').addEventListener('click', (event) => {
  const tab = event.target.dataset && event.target.dataset.tab;
  if (!tab) return;
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.toggle('hidden', el.id !== `tab-${tab}`));
  if (tab === 'config') loadConfigText();
});

// ---------------------------------------------------------------- traffic

function matchesFilter(item) {
  const filter = state.filter.trim().toLowerCase();
  if (!filter) return true;
  return [item.method, item.url, String(item.statusCode), item.handledBy || '']
    .some(value => value.toLowerCase().includes(filter));
}

function trafficRow(item) {
  return h('tr', {
    class: item.id === state.selectedId ? 'selected' : '',
    'data-id': item.id,
    onclick: () => selectRequest(item.id),
  },
  h('td', { class: 'muted' }, item.id),
  h('td', { class: 'muted' }, formatTime(item.startedAt)),
  h('td', { class: 'method' }, item.method),
  h('td', { class: `status-${String(item.statusCode)[0]}` }, item.statusCode),
  h('td', {}, item.handledBy ? h('span', { class: `badge ${item.handledBy}` }, item.handledBy) : ''),
  h('td', { class: 'path', title: item.url }, item.url),
  h('td', { class: 'muted' }, item.durationMs),
  h('td', { class: 'muted' }, formatSize(item.responseSize)),
  );
}

function renderTraffic() {
  const rows = state.traffic.filter(matchesFilter);
  $('traffic-body').replaceChildren(...rows.map(trafficRow));
  $('traffic-empty').classList.toggle('hidden', state.traffic.length > 0);
  $('traffic-count').textContent = state.traffic.length ? `${rows.length} of ${state.traffic.length}` : '';
}

function addTraffic(item) {
  state.traffic.push(item);
  if (state.traffic.length > MAX_ROWS) state.traffic.shift();

  if (matchesFilter(item)) {
    $('traffic-body').append(trafficRow(item));
    $('traffic-empty').classList.add('hidden');
    if (state.follow) $('traffic-wrap').scrollTop = $('traffic-wrap').scrollHeight;
  }

  $('traffic-count').textContent = `${state.traffic.filter(matchesFilter).length} of ${state.traffic.length}`;
}

async function selectRequest(id) {
  state.selectedId = id;
  document.querySelectorAll('#traffic-body tr').forEach(tr => tr.classList.toggle('selected', Number(tr.dataset.id) === id));

  try {
    state.detail = await api('GET', `/api/traffic/${id}`);
    renderDetail();
  } catch (error) {
    showError(error);
  }
}

function headerTable(headers) {
  return h('table', { class: 'kv' }, Object.entries(headers).map(([name, value]) =>
    h('tr', {}, h('td', {}, name), h('td', {}, Array.isArray(value) ? value.join(', ') : String(value)))));
}

function bodyBlock(body) {
  if (!body.size) return h('div', { class: 'muted' }, '(empty)');
  return h('div', {},
    h('pre', { class: 'body' }, prettyBody(body)),
    body.truncated ? h('div', { class: 'muted' }, `Showing part of ${formatSize(body.size)}`) : null);
}

function renderDetail() {
  const d = state.detail;
  const writable = state.info && state.info.writable;

  $('detail').replaceChildren(
    h('h2', {}, `${d.method} ${d.url}`),
    h('div', { class: 'muted' },
      `${d.statusCode} ${d.response.statusMessage || ''} · ${d.durationMs} ms · ${formatSize(d.responseSize)}`,
      d.handledBy ? ' · ' : '', d.handledBy ? h('span', { class: `badge ${d.handledBy}` }, d.handledBy) : ''),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary small', disabled: !writable, title: writable ? '' : 'Read-only', onclick: () => openMockModal(d) }, 'Mock this response…'),
      h('button', { class: 'btn small', onclick: () => replay(d.id) }, 'Replay'),
      h('button', { class: 'btn small', onclick: () => openReplayModal(d) }, 'Edit & replay…'),
      h('button', { class: 'btn small', onclick: () => copyCurl(d) }, 'Copy as cURL'),
    ),
    h('h3', {}, 'Request headers'), headerTable(d.request.headers),
    h('h3', {}, 'Request body'), bodyBlock(d.request.body),
    h('h3', {}, 'Response headers'), headerTable(d.response.headers),
    h('h3', {}, 'Response body'), bodyBlock(d.response.body),
  );
}

function openMockModal(d) {
  const contentType = String(d.response.headers['content-type'] || '');
  const hasQuery = d.url.includes('?');
  const status = h('input', { type: 'number', value: String(d.statusCode), min: '100', max: '599' });
  const type = h('input', { type: 'text', value: contentType });
  const body = h('textarea', {}, d.response.body.encoding === 'base64' ? '' : prettyBody(d.response.body));
  const keepBinary = d.response.body.encoding === 'base64';
  const matchQuery = h('input', { type: 'checkbox', checked: hasQuery, disabled: !hasQuery });

  modal(`Mock ${d.method} ${d.url.split('?')[0]}`, h('div', { class: 'fields' },
    h('div', { class: 'row' },
      h('label', {}, 'Status', status),
      h('label', {}, 'Content type', type)),
    keepBinary
      ? h('div', { class: 'muted' }, `Binary response (${formatSize(d.response.body.size)}) — it will be saved to a file as is.`)
      : h('label', {}, 'Body', body),
    h('label', { class: 'checkbox' }, matchQuery, hasQuery ? 'Only for this query string' : 'No query string'),
    h('div', { class: 'muted' }, 'The rule is added at the top of mockRules, so it wins over existing rules.'),
  ), [[
    'Create mock',
    async () => {
      const result = await api('POST', `/api/traffic/${d.id}/mock`, {
        statusCode: Number(status.value),
        contentType: type.value || undefined,
        body: keepBinary ? undefined : body.value,
        matchQuery: matchQuery.checked,
      });
      state.info = result.state;
      renderAll();
      toast(`Mock created: ${result.rule.method} ${result.rule.path}`);
    },
    'primary',
  ]]);
}

async function replay(id, overrides) {
  try {
    const result = await api('POST', `/api/traffic/${id}/replay`, overrides || {});
    toast(`Replayed — ${result.statusCode}`);
  } catch (error) {
    showError(error);
  }
}

function openReplayModal(d) {
  const method = h('input', { type: 'text', value: d.method });
  const url = h('input', { type: 'text', value: d.url });
  const headers = h('textarea', {}, JSON.stringify(d.request.headers, null, 2));
  const body = h('textarea', {}, d.request.body.encoding === 'base64' ? '' : d.request.body.text);

  modal('Edit & replay', h('div', { class: 'fields' },
    h('div', { class: 'row' }, h('label', {}, 'Method', method), h('label', {}, 'Path', url)),
    h('label', {}, 'Headers (JSON)', headers),
    h('label', {}, 'Body', body),
  ), [[
    'Send',
    async () => {
      const result = await api('POST', `/api/traffic/${d.id}/replay`, {
        method: method.value,
        url: url.value,
        headers: parseJsonField(headers.value, 'Headers'),
        body: body.value,
      });
      toast(`Replayed — ${result.statusCode}`);
    },
    'primary',
  ]]);
}

function copyCurl(d) {
  const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  const skip = new Set(['host', 'content-length', 'connection']);
  const parts = [`curl -X ${d.method} ${quote(state.info.proxyUrl + d.url)}`];

  for (const [name, value] of Object.entries(d.request.headers)) {
    if (!skip.has(name)) parts.push(`-H ${quote(`${name}: ${value}`)}`);
  }

  if (d.request.body.size && d.request.body.encoding !== 'base64') {
    parts.push(`--data-raw ${quote(d.request.body.text)}`);
  }

  navigator.clipboard.writeText(parts.join(' \\\n  '))
    .then(() => toast('cURL command copied'), () => toast('Could not access the clipboard', 'error'));
}

$('traffic-filter').addEventListener('input', (event) => {
  state.filter = event.target.value;
  renderTraffic();
});

$('traffic-follow').addEventListener('change', (event) => {
  state.follow = event.target.checked;
});

$('traffic-clear').addEventListener('click', async () => {
  try {
    await api('DELETE', '/api/traffic');
    state.traffic = [];
    state.selectedId = null;
    $('detail').replaceChildren(h('div', { class: 'empty' }, 'Select a request to inspect it.'));
    renderTraffic();
  } catch (error) {
    showError(error);
  }
});

// ---------------------------------------------------------------- rules

function ruleSummary(section, rule) {
  const chips = [];

  if (section === 'remoteRules') chips.push(`→ ${rule.target}`, rule.ws ? 'WebSocket' : null);
  else if (section === 'staticRules') chips.push(`dir ${rule.directory}`);
  else {
    if ('file' in rule) chips.push(`file ${rule.file}`);
    if ('script' in rule) chips.push(`script ${rule.script}`);
    if ('json' in rule) chips.push(`json ${JSON.stringify(rule.json).slice(0, 60)}`);
    if ('body' in rule) chips.push(`body ${JSON.stringify(rule.body).slice(0, 60)}`);
    if (rule.headers) chips.push(`headers ${Object.keys(rule.headers).join(', ')}`);
    if (rule.query) chips.push(`query ${Object.keys(rule.query).join(', ')}`);
  }

  return chips.filter(Boolean).join(' · ');
}

function ruleChips(rule) {
  const chips = [];
  if (rule.statusCode) chips.push(String(rule.statusCode));
  if (rule.delay) chips.push(`${rule.delay} ms`);
  if (rule.match) chips.push(`match ${Object.keys(rule.match).join('+')}`);
  return chips.map(text => h('span', { class: 'chip' }, text));
}

function ruleRow(entry, list) {
  const { rule, section } = entry;
  const writable = state.info.writable;
  const index = entry.path[entry.path.length - 1];
  const siblings = list.filter(other => other.file === entry.file && JSON.stringify(other.path.slice(0, -1)) === JSON.stringify(entry.path.slice(0, -1)));
  const isMain = entry.file === state.info.configPath;

  const toggle = h('label', { class: 'switch', title: rule.disable ? 'Disabled' : 'Enabled' },
    h('input', {
      type: 'checkbox',
      checked: !rule.disable,
      disabled: !writable,
      onchange: (event) => mutate('PATCH', '/api/rules', { file: entry.file, path: entry.path, disabled: !event.target.checked }),
    }),
    h('span', {}));

  return h('div', { class: `rule-row ${rule.disable ? 'disabled' : ''}` },
    toggle,
    h('div', { class: 'rule-main' },
      rule.method ? h('span', { class: 'method' }, rule.method) : null,
      h('span', { class: 'rule-path', title: rule.path }, rule.path),
      ruleChips(rule),
      h('span', { class: 'rule-summary', title: ruleSummary(section, rule) }, ruleSummary(section, rule)),
    ),
    !isMain && entry.file ? h('span', { class: 'rule-source', title: entry.file }, basename(entry.file)) : null,
    writable ? h('div', { class: 'rule-actions' },
      h('button', { class: 'btn icon small', title: 'Move up', disabled: index === 0, onclick: () => mutate('POST', '/api/rules/move', { file: entry.file, path: entry.path, to: index - 1 }) }, '↑'),
      h('button', { class: 'btn icon small', title: 'Move down', disabled: index === siblings.length - 1, onclick: () => mutate('POST', '/api/rules/move', { file: entry.file, path: entry.path, to: index + 1 }) }, '↓'),
      h('button', { class: 'btn icon small', title: 'Edit', onclick: () => openRuleEditor(entry) }, 'Edit'),
      h('button', { class: 'btn icon small danger', title: 'Delete', onclick: () => confirmDelete(entry) }, '✕'),
    ) : null,
  );
}

function ruleGroup(title, hint, entries, onAdd, extra) {
  const writable = state.info.writable;
  return h('section', { class: 'rule-section' },
    h('header', {},
      h('h3', {}, title),
      h('span', { class: 'count' }, entries.length),
      extra || null,
      h('span', { class: 'muted' }, hint),
      h('span', { class: 'spacer' }),
      writable && onAdd ? h('button', { class: 'btn small', onclick: onAdd }, 'Add rule') : null),
    entries.length
      ? entries.map(entry => ruleRow(entry, entries))
      : h('div', { class: 'section-empty' }, 'No rules'),
  );
}

function renderRules() {
  const info = state.info;
  $('readonly-banner').classList.toggle('hidden', info.writable);

  const base = info.rules.filter(entry => !entry.profile);
  const groups = SECTIONS.map(({ key, title, hint }) =>
    ruleGroup(title, hint, base.filter(entry => entry.section === key), () => openRuleEditor(null, key)));

  for (const name of info.profiles) {
    const entries = info.rules.filter(entry => entry.profile === name);
    const active = info.profile === name;

    groups.push(ruleGroup(
      `Profile “${name}”`,
      'Rules that apply before the base rules while the profile is active',
      entries,
      () => openRuleEditor(null, 'mockRules', name),
      h('span', { class: `badge ${active ? 'stream' : 'outline'}` }, active ? 'active' : 'inactive'),
    ));
  }

  $('rules').replaceChildren(...groups);
}

function openRuleEditor(entry, section, profile) {
  const isNew = !entry;
  const sectionSelect = h('select', {}, SECTIONS.map(s => h('option', { value: s.key }, s.title)));
  sectionSelect.value = section || entry.section;
  const text = h('textarea', {}, JSON.stringify(isNew ? TEMPLATES[sectionSelect.value] : entry.rule, null, 2));
  sectionSelect.addEventListener('change', () => { text.value = JSON.stringify(TEMPLATES[sectionSelect.value], null, 2); });

  modal(isNew ? `Add rule${profile ? ` to profile “${profile}”` : ''}` : `Edit rule — ${entry.rule.path}`, h('div', { class: 'fields' },
    isNew ? h('label', {}, 'List', sectionSelect) : h('div', { class: 'muted' }, `${entry.section} · ${basename(entry.file)}`),
    h('label', {}, 'Rule (JSON)', text),
    isNew ? h('div', { class: 'muted' }, 'New rules go first in their list, so they win over existing ones.') : null,
  ), [[
    isNew ? 'Add' : 'Save',
    async () => {
      const rule = parseJsonField(text.value, 'The rule');
      state.info = isNew
        ? await api('POST', '/api/rules', { section: sectionSelect.value, rule, position: 'first', profile })
        : await api('PUT', '/api/rules', { file: entry.file, path: entry.path, rule });
      renderAll();
      toast(isNew ? 'Rule added' : 'Rule saved');
    },
    'primary',
  ]]);
}

function confirmDelete(entry) {
  modal('Delete rule?', h('div', { class: 'fields' },
    h('pre', { class: 'body' }, JSON.stringify(entry.rule, null, 2))), [[
    'Delete',
    async () => {
      state.info = await api('DELETE', '/api/rules', { file: entry.file, path: entry.path });
      renderAll();
      toast('Rule deleted');
    },
    'danger',
  ]]);
}

async function mutate(method, url, body) {
  try {
    state.info = await api(method, url, body);
    renderAll();
  } catch (error) {
    showError(error);
    renderRules();
  }
}

// ---------------------------------------------------------------- config

async function loadConfigText() {
  if (!state.info.writable) {
    $('config-path').textContent = 'Started from a config object — nothing to edit.';
    $('config-text').value = '';
    $('config-text').disabled = true;
    $('config-save').disabled = true;
    $('config-reload').disabled = true;
    return;
  }

  try {
    const config = await api('GET', '/api/config');
    $('config-path').textContent = config.path;
    $('config-text').value = config.text;
    $('config-errors').classList.add('hidden');
  } catch (error) {
    showError(error);
  }
}

$('config-reload').addEventListener('click', loadConfigText);

$('config-save').addEventListener('click', async () => {
  try {
    state.info = await api('PUT', '/api/config', { text: $('config-text').value });
    $('config-errors').classList.add('hidden');
    renderAll();
    toast('Config saved');
  } catch (error) {
    $('config-errors').replaceChildren(...[error.message, ...(error.errors || [])].map(text => h('li', {}, text)));
    $('config-errors').classList.remove('hidden');
  }
});

// ---------------------------------------------------------------- live updates

function renderAll() {
  renderHeader();
  renderRules();
}

async function loadState() {
  state.info = await api('GET', '/api/state');
  renderAll();
}

function connect() {
  const events = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`);
  events.addEventListener('open', () => { $('status-dot').className = 'status-dot live'; });
  events.addEventListener('error', () => { $('status-dot').className = 'status-dot down'; });
  events.addEventListener('traffic', (event) => addTraffic(JSON.parse(event.data)));
  events.addEventListener('config', () => loadState().catch(showError));
}

async function init() {
  try {
    await loadState();
    state.traffic = await api('GET', '/api/traffic');
    renderTraffic();
    connect();
  } catch (error) {
    showError(error);
  }
}

init();
