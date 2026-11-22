/* Aurora remote configuration UI. */
(function () {
  'use strict';

  var DEFAULTS = {
    deviceId: '',
    deviceName: 'Living Room',
    model: '',
    ha: {
      enabled: false, baseUrl: 'http://homeassistant.local:8123', token: '',
      pages: [{ id: 'home', name: 'Home', widgets: [] }],
      currentPage: 'home',
      tvEntity: '', musicEntity: '', lightEntity: '', climateEntity: '', weatherEntity: '', powerEntity: '', gasEntity: ''
    },
    epg: { xmltvUrl: 'http://homeassistant.local:8090/epg.xml', demo: true, refreshMinutes: 60, horizonHours: 3, nativeGuide: false, nativeGuideAppId: '' },
    apps: { items: [] },
    sources: {
      hdmi1: { label: 'HDMI 1', sub: 'Apple TV', appId: '', haSource: 'HDMI1' },
      hdmi2: { label: 'HDMI 2', sub: 'Games console', appId: '', haSource: 'HDMI2' },
      hdmi3: { label: 'HDMI 3', sub: 'Media PC', appId: '', haSource: 'HDMI3' },
      hdmi4: { label: 'HDMI 4', sub: 'Spare input', appId: '', haSource: 'HDMI4' },
      livetv: { label: 'Live TV', sub: 'Antenna / cable', appId: 'org.tizen.tv-viewer', haSource: 'TV' }
    },
    livetv: { guideAppId: '', defaultChannel: '' },
    ui: { lastExternal: 'livetv', dashboardDuration: 30, overlayTimeoutMs: 3500, festiveMode: 'auto' },
    remoteConfig: { enabled: false, url: '', token: '', pollMinutes: 5 },
    localServer: { enabled: true, token: '', host: '' }
  };

  var TOKEN_KEY = 'aurora-config-token';
  var SERVER_BASE = window.AURORA_SERVER_PUBLIC_URL || location.origin;
  var DEVICE_KEY = 'aurora-config-device';

  var state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    devices: [],
    current: null,
    config: null,
    revision: '',
    updatedAt: '',
    dirty: false,
    saving: false,
    tokenPromptOpen: false
  };

  var form = document.getElementById('form');
  var deviceList = document.getElementById('device-list');
  var title = document.getElementById('device-title');
  var meta = document.getElementById('device-meta');
  var dirtyEl = document.getElementById('dirty');
  var errorEl = document.getElementById('error-banner');
  var emptyEl = document.getElementById('empty');
  var saveBtn = document.getElementById('save');
  var serverPill = document.getElementById('server-pill');
  var serverText = document.getElementById('server-text');
  var dirtyPill = document.getElementById('dirty-pill');
  var tokenModal = document.getElementById('token-modal');
  var tokenInput = document.getElementById('token-input');
  var tokenError = document.getElementById('token-error');
  var deviceModal = document.getElementById('device-modal');
  var newError = document.getElementById('new-error');
  var importModal = document.getElementById('import-modal');
  var importError = document.getElementById('import-error');

  /* ---------- utilities ---------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function merge(base, over) {
    if (!isObject(over)) return base;
    var out = {};
    Object.keys(base).forEach(function (key) { out[key] = base[key]; });
    Object.keys(over).forEach(function (key) {
      if (isObject(base[key]) && isObject(over[key])) out[key] = merge(base[key], over[key]);
      else if (over[key] !== undefined) out[key] = over[key];
    });
    return out;
  }

  function getPath(obj, path) {
    return path.split('.').reduce(function (acc, key) {
      return acc == null ? undefined : acc[key];
    }, obj);
  }

  function setPath(obj, path, value) {
    var parts = path.split('.');
    var target = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!isObject(target[parts[i]])) target[parts[i]] = {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  }

  function slug(value) {
    return String(value || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41);
  }

  function toast(message, kind) {
    var host = document.getElementById('toast-host');
    var node = document.createElement('div');
    node.className = 'toast ' + (kind || '');
    node.textContent = message;
    host.appendChild(node);
    setTimeout(function () { node.classList.add('leaving'); }, 3200);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 3600);
    while (host.children.length > 3) host.removeChild(host.firstChild);
  }

  function showError(message) {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function setServerStatus(ok, text) {
    serverPill.className = 'pill ' + (ok ? 'ok' : 'bad');
    serverText.textContent = text;
  }

  function markDirty() {
    state.dirty = true;
    dirtyEl.hidden = false;
    dirtyPill.hidden = false;
  }

  function clearDirty() {
    state.dirty = false;
    dirtyEl.hidden = true;
    dirtyPill.hidden = true;
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    return isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  /* ---------- API ---------- */

  async function api(path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;

    var res = await fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body,
      cache: 'no-store'
    });

    if (res.status === 401) {
      openTokenModal('The server rejected that token. Try again.');
      var authErr = new Error('Unauthorised');
      authErr.unauthorised = true;
      throw authErr;
    }

    var text = await res.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = null; }
    }
    if (!res.ok) {
      throw new Error((data && data.error) || ('Request failed (HTTP ' + res.status + ')'));
    }
    return data;
  }

  /* ---------- token ---------- */

  function openTokenModal(message) {
    tokenModal.hidden = false;
    tokenError.hidden = !message;
    tokenError.textContent = message || '';
    tokenInput.value = '';
    setTimeout(function () { tokenInput.focus(); }, 50);
  }

  function closeTokenModal() {
    tokenModal.hidden = true;
  }

  async function saveToken() {
    var value = tokenInput.value.trim();
    state.token = value;
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
    closeTokenModal();
    await boot();
  }

  /* ---------- device list ---------- */

  function renderDevices() {
    deviceList.innerHTML = state.devices.map(function (device) {
      var active = device.id === state.current ? ' active' : '';
      var initial = (device.name || device.id || '?').trim().charAt(0).toUpperCase();
      return '<button type="button" class="device-item' + active + '" data-device="' + esc(device.id) + '">' +
        '<span class="device-avatar">' + esc(initial) + '</span>' +
        '<span class="device-copy"><span class="device-name">' + esc(device.name || device.id) + '</span>' +
        '<span class="device-model">' + esc(device.model || device.id) + '</span></span>' +
        '</button>';
    }).join('');
  }

  async function loadDevices() {
    var data = await api('api/devices');
    state.devices = (data && data.devices) || [];
    setServerStatus(true, 'Server online');
    renderDevices();
    return state.devices;
  }

  async function loadConfig(id) {
    var data = await api('api/config/' + encodeURIComponent(id));
    state.current = id;
    state.config = merge(JSON.parse(JSON.stringify(DEFAULTS)), data.config || {});
    delete state.config.mqtt;
    state.config.deviceId = id;
    if (!state.config.sources) state.config.sources = JSON.parse(JSON.stringify(DEFAULTS.sources));
    if (!Array.isArray(state.config.ha.pages) || !state.config.ha.pages.length) {
      state.config.ha.pages = [{ id: 'home', name: 'Home', widgets: [] }];
    }
    if (!state.config.ha.currentPage) state.config.ha.currentPage = state.config.ha.pages[0].id;
    state.revision = data.revision || '';
    state.updatedAt = data.updatedAt || '';
    localStorage.setItem(DEVICE_KEY, id);
    clearDirty();
    showError('');
    render();
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  }

  async function selectDevice(id, force) {
    if (!force && state.dirty && !window.confirm('Discard unsaved changes?')) {
      renderDevices();
      return;
    }
    try {
      await loadConfig(id);
    } catch (err) {
      if (!err.unauthorised) showError('Could not load ' + id + ': ' + err.message);
    }
  }

  /* ---------- form rendering ---------- */

  function value(path) {
    return getPath(state.config, path);
  }

  function defaultExists(path) {
    return getPath(DEFAULTS, path) !== undefined;
  }

  function resetControl(path) {
    if (!defaultExists(path)) return '';
    return '<button type="button" class="field-reset" data-reset-field="' + esc(path) + '">Reset</button>';
  }

  function fieldHead(path, label, options) {
    var reset = options && options.readonly ? '' : resetControl(path);
    return '<span class="field-head"><span>' + esc(label) + '</span>' + reset + '</span>';
  }

  function inputField(path, label, options) {
    options = options || {};
    var raw = value(path);
    var type = options.type || 'text';
    var val = raw == null ? '' : raw;
    return '<label class="field' + (options.span ? ' span-2' : '') + '">' +
      fieldHead(path, label, options) +
      '<input type="' + type + '" data-path="' + esc(path) + '" value="' + esc(val) + '"' +
      (options.placeholder ? ' placeholder="' + esc(options.placeholder) + '"' : '') +
      (options.readonly ? ' readonly' : '') +
      ' autocomplete="off" spellcheck="false">' +
      (options.hint ? '<small' + (options.warn ? ' class="warn"' : '') + '>' + esc(options.hint) + '</small>' : '') +
      '</label>';
  }


  function entityField(path, label, options) {
    options = options || {};
    var raw = value(path);
    var val = raw == null ? '' : raw;
    return '<label class="field' + (options.span ? ' span-2' : '') + '">' +
      fieldHead(path, label) +
      '<div class="picker-input">' +
      '<input type="text" data-path="' + esc(path) + '" value="' + esc(val) + '"' +
      (options.placeholder ? ' placeholder="' + esc(options.placeholder) + '"' : '') +
      ' autocomplete="off" spellcheck="false">' +
      '<button type="button" class="btn ghost small" data-picker="' + esc(path) + '"' +
      ' data-domain="' + esc(options.domain || '') + '"' +
      ' data-device-classes="' + esc((options.deviceClasses || []).join(',')) + '"' +
      ' data-picker-label="' + esc(label) + '">Choose</button>' +
      '</div>' +
      (options.hint ? '<small' + (options.warn ? ' class="warn"' : '') + '>' + esc(options.hint) + '</small>' : '') +
      '</label>';
  }

  function readonlyField(label, text, hint) {
    return '<label class="field"><span>' + esc(label) + '</span>' +
      '<input type="text" value="' + esc(text) + '" readonly>' +
      (hint ? '<small>' + esc(hint) + '</small>' : '') +
      '</label>';
  }

  function selectField(path, label, options, hint) {
    var current = String(value(path) || '');
    var optionsHtml = options.map(function (item) {
      var val = typeof item === 'string' ? item : item.value;
      var text = typeof item === 'string' ? item : item.label;
      return '<option value="' + esc(val) + '"' + (String(val) === current ? ' selected' : '') + '>' + esc(text) + '</option>';
    }).join('');
    if (current && !options.some(function (item) { return String(typeof item === 'string' ? item : item.value) === current; })) {
      optionsHtml += '<option value="' + esc(current) + '" selected>' + esc(current) + '</option>';
    }
    return '<label class="field">' + fieldHead(path, label) +
      '<select data-path="' + esc(path) + '">' + optionsHtml + '</select>' +
      (hint ? '<small>' + esc(hint) + '</small>' : '') +
      '</label>';
  }

  function toggleField(path, label, hint) {
    return '<div class="toggle-row"><div class="toggle-copy"><b>' + esc(label) + '</b>' +
      (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>' +
      '<div class="field-reset-wrap">' + resetControl(path) +
      '<label class="switch"><input type="checkbox" data-path="' + esc(path) + '"' +
      (value(path) ? ' checked' : '') + '><span class="switch-track"></span></label></div></div>';
  }

  function card(titleText, description, body) {
    return '<section class="card"><div class="card-head"><h2>' + esc(titleText) + '</h2>' +
      (description ? '<p>' + esc(description) + '</p>' : '') + '</div>' +
      '<div class="card-body">' + body + '</div></section>';
  }

  function sourceCard(id, index) {
    var src = state.config.sources[id] || DEFAULTS.sources[id] || {};
    var label = id === 'livetv' ? 'Live TV' : 'HDMI ' + (index + 1);
    return '<div class="source">' +
      '<div class="source-head"><span class="source-tag">' + (id === 'livetv' ? 'TV' : 'HDMI') + '</span>' +
      '<strong>' + esc(label) + '</strong></div>' +
      '<div class="grid two">' +
      inputField('sources.' + id + '.label', 'Label', { placeholder: label }) +
      inputField('sources.' + id + '.sub', 'Sub-label', { placeholder: 'Apple TV' }) +
      inputField('sources.' + id + '.appId', 'Fallback app ID', { placeholder: 'Leave empty; TVWindow is used' }) +
      inputField('sources.' + id + '.haSource', 'Home Assistant source', { placeholder: label }) +
      '</div></div>';
  }

  function appItems() {
    if (!state.config.apps || typeof state.config.apps !== 'object') state.config.apps = { items: [] };
    if (!Array.isArray(state.config.apps.items)) state.config.apps.items = [];
    return state.config.apps.items;
  }

  function appsEditor() {
    var items = appItems();
    var rows = items.map(function (app, index) {
      return '<div class="app-row">' +
        '<span class="app-order">' + (index + 1) + '</span>' +
        '<input type="text" data-app-index="' + index + '" data-app-field="name" value="' + esc(app.name || '') + '" placeholder="App name" autocomplete="off">' +
        '<input type="text" data-app-index="' + index + '" data-app-field="id" value="' + esc(app.id || '') + '" placeholder="Tizen app ID" autocomplete="off" spellcheck="false">' +
        '<button type="button" class="btn ghost small" data-app-up="' + index + '"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn ghost small" data-app-down="' + index + '"' + (index === items.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn ghost small" data-app-remove="' + index + '">Remove</button>' +
        '</div>';
    }).join('');
    if (!rows) rows = '<p class="section-note">No apps selected. The Apps tile stays hidden until an app is added.</p>';
    return '<div class="app-list">' + rows + '</div>' +
      '<div class="inline-actions"><button type="button" class="btn ghost small" data-app-add>Add app</button>' +
      '<span class="section-note">Use Settings → Apps menu on the TV to list and select installed apps.</span></div>';
  }

  function render() {
    if (!state.config) return;
    var config = state.config;
    title.textContent = config.deviceName || state.current || 'Device';
    meta.textContent = [config.model || 'Unknown model', 'ID ' + state.current,
      state.revision ? 'revision ' + state.revision : '',
      state.updatedAt ? 'saved ' + formatDate(state.updatedAt) : '']
      .filter(Boolean).join(' · ');



    var endpoint = SERVER_BASE + '/api/config/' + encodeURIComponent(state.current || '');
    var onLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var bootstrap = JSON.stringify({
      remoteConfig: {
        enabled: true,
        url: endpoint,
        token: state.token || config.remoteConfig.token || '',
        pollMinutes: Number(config.remoteConfig.pollMinutes) || 5
      }
    }, null, 2);

    var html = '';
    html += card('TV', 'Identity used on the TV and in the remote config URL.',
      '<div class="grid two">' +
      inputField('deviceName', 'Name', { placeholder: 'Living Room' }) +
      inputField('model', 'Model', { placeholder: 'QE50QN90CATXXU' }) +
      inputField('deviceId', 'Device ID', { readonly: true, hint: 'Read-only. Create a new device to change it.' }) +
      '</div>');

    html += card('Appearance', 'Seasonal styling for the home screen.',
      '<div class="grid two">' +
      selectField('ui.festiveMode', 'Festive mode', [
        { value: 'auto', label: 'Automatic (1 December – 6 January)' },
        { value: 'on', label: 'On (preview / test)' },
        { value: 'off', label: 'Off' }
      ], 'Automatic enables the festive theme from 1 December to 6 January. Choose On to test it now.') +
      '</div>');

    html += card('Remote configuration', 'Aurora fetches this profile from the config server on boot and every few minutes.',
      '<div class="grid">' + toggleField('remoteConfig.enabled', 'Poll this server', 'Enable remote configuration on the TV.') + '</div>' +
      '<div class="grid two" style="margin-top:14px">' +
      inputField('remoteConfig.url', 'Config URL (bootstrap)', { placeholder: endpoint, warn: onLocalhost, hint: onLocalhost ? 'Open this UI via the server LAN IP so the TV can reach the generated URL.' : 'One-time bootstrap value; the TV keeps its local URL/token.' }) +
      inputField('remoteConfig.token', 'Config token (bootstrap)', { type: 'password', placeholder: 'Bearer token', hint: 'One-time bootstrap value; the TV keeps its local token.' }) +
      inputField('remoteConfig.pollMinutes', 'Poll interval (minutes)', { type: 'number', placeholder: '5', hint: 'This value can be managed remotely.' }) +
      '</div>' +
      '<div class="inline-actions">' +
      '<button type="button" class="btn ghost small" data-use-server>Use this server</button>' +
      '<button type="button" class="btn ghost small" data-download>Download config.json</button>' +
      '<span class="test-result" data-test-result="remote">' + esc(endpoint) + '</span>' +
      '</div>' +
      '<details class="bootstrap"><summary>TV bootstrap snippet (paste into config.json)</summary>' +
      '<pre id="bootstrap-text">' + esc(bootstrap) + '</pre>' +
      '<div class="inline-actions"><button type="button" class="btn ghost small" data-copy-snippet>Copy snippet</button></div>' +
      '</details>');

    html += card('Home Assistant', 'Native entity widgets, sensors and optional TV control through Home Assistant.',
      '<div class="grid">' + toggleField('ha.enabled', 'Home Assistant', 'Connect for entity widgets, sensors and control.') + '</div>' +
      '<div class="grid two" style="margin-top:14px">' +
      inputField('ha.baseUrl', 'URL', { placeholder: 'http://homeassistant.local:8123', span: true }) +
      inputField('ha.token', 'Long-lived token', { type: 'password', placeholder: 'eyJ…' }) +
      entityField('ha.tvEntity', 'TV media_player entity', { domain: 'media_player', placeholder: 'media_player.living_room_tv' }) +
      entityField('ha.musicEntity', 'Music media_player entity', { domain: 'media_player', placeholder: 'media_player.music_assistant' }) +
      entityField('ha.lightEntity', 'Light entity', { domain: 'light', placeholder: 'light.living_room_lamp' }) +
      entityField('ha.climateEntity', 'Climate entity', { domain: 'climate', placeholder: 'climate.living_room' }) +
      entityField('ha.weatherEntity', 'Weather entity', { domain: 'weather', placeholder: 'weather.home' }) +
      entityField('ha.powerEntity', 'Electricity usage sensor', { domain: 'sensor', deviceClasses: ['power', 'energy'], placeholder: 'sensor.tv_plug_power' }) +
      entityField('ha.gasEntity', 'Gas usage sensor', { domain: 'sensor', deviceClasses: ['gas', 'energy'], placeholder: 'sensor.gas_meter' }) +
      '</div>' +
      '<p class="section-note">Entity widgets and named pages are added on the TV using <b>Add entities</b> and <b>Pages</b>.</p>' +
      '<div class="inline-actions"><button type="button" class="btn ghost small" data-test="ha">Test Home Assistant</button>' +
      '<span class="test-result" data-test-result="ha"></span></div>');

    html += card('TV guide', 'Use the TV’s native guide, or an XMLTV feed. Leave the XMLTV URL empty to keep the demo grid.',
      '<div class="grid" style="margin-bottom:14px">' +
      toggleField('epg.nativeGuide', 'Native TV Guide app', 'Launch the built-in TV Guide instead of the XMLTV grid. XMLTV remains the default.') +
      '</div>' +
      '<div class="grid two">' +
      inputField('epg.nativeGuideAppId', 'Native guide app ID', { placeholder: 'Leave empty to detect automatically', hint: 'Optional. On the TV, choose the app from Settings → TV guide → Native guide app.' }) +
      inputField('epg.xmltvUrl', 'XMLTV URL', { placeholder: 'http://epg.local:8080/xmltv.xml', span: true }) +
      inputField('epg.refreshMinutes', 'Refresh interval (minutes)', { type: 'number', placeholder: '60' }) +
      inputField('epg.horizonHours', 'Visible hours', { type: 'number', placeholder: '3' }) +
      '</div>' +
      '<div class="grid" style="margin-top:14px">' + toggleField('epg.demo', 'Demo guide', 'Show sample channels when no XMLTV is configured.') + '</div>' +
      '<div class="grid two" style="margin-top:14px">' +
      readonlyField('Add-on guide feed', SERVER_BASE + '/epg.xml', 'UK Freeview XMLTV with LCN numbers, refreshed hourly on the Home Assistant shared port.') +
      '</div>' +
      '<div class="inline-actions"><button type="button" class="btn ghost small" data-test="xmltv">Test XMLTV</button>' +
      '<button type="button" class="btn ghost small" data-epg-refresh>Refresh add-on guide</button>' +
      '<span class="test-result" data-test-result="xmltv"></span>' +
      '<span class="test-result" data-epg-status></span></div>');

    html += card('Apps menu', 'Apps shown in a second home row when the Apps tile is opened. No apps are enabled by default; without entries the Apps tile is hidden.',
      appsEditor());

    var sources = '';
    ['hdmi1', 'hdmi2', 'hdmi3', 'hdmi4'].forEach(function (id, index) { sources += sourceCard(id, index); });
    sources += sourceCard('livetv', 4);
    html += card('Inputs', 'Labels and optional fallback app IDs used when switching sources.', sources);

    html += '<div class="footer-actions">' +
      '<button type="button" class="btn ghost" data-revert>Discard changes</button>' +
      '<button type="button" class="btn primary" data-save>Save changes</button>' +
      '</div>';

    form.innerHTML = html;
    emptyEl.hidden = true;
    form.hidden = false;
    dirtyEl.hidden = !state.dirty;
    var deleteButton = document.getElementById('delete-device');
    if (deleteButton) deleteButton.disabled = state.devices.length <= 1;
  }

  /* ---------- save / revert / delete / download ---------- */

  function normalizeForSave() {
    var cfg = state.config;
    delete cfg.mqtt;
    delete cfg.ha.dashboards;
    delete cfg.ha.defaultDashboard;
    if (!Array.isArray(cfg.ha.pages) || !cfg.ha.pages.length) {
      cfg.ha.pages = [{ id: 'home', name: 'Home', widgets: [] }];
    }
    if (!cfg.ha.pages.some(function (page) { return page.id === cfg.ha.currentPage; })) {
      cfg.ha.currentPage = cfg.ha.pages[0].id;
    }
    cfg.ui.overlayTimeoutMs = Math.max(1500, Math.min(15000, Number(cfg.ui.overlayTimeoutMs) || 3500));
    if (['auto', 'on', 'off'].indexOf(cfg.ui.festiveMode) === -1) cfg.ui.festiveMode = 'auto';
    cfg.epg.refreshMinutes = Math.max(5, Math.min(1440, Number(cfg.epg.refreshMinutes) || 60));
    cfg.epg.horizonHours = Math.max(1, Math.min(12, Number(cfg.epg.horizonHours) || 3));
    cfg.remoteConfig.pollMinutes = Math.max(1, Math.min(1440, Number(cfg.remoteConfig.pollMinutes) || 5));
    cfg.ha.baseUrl = String(cfg.ha.baseUrl || '').trim().replace(/\/+$/, '');
    cfg.ha.token = String(cfg.ha.token || '').trim();
    cfg.epg.xmltvUrl = String(cfg.epg.xmltvUrl || '').trim();
    cfg.epg.nativeGuide = cfg.epg.nativeGuide === true;
    cfg.epg.nativeGuideAppId = String(cfg.epg.nativeGuideAppId || '').trim();
    if (!cfg.apps || typeof cfg.apps !== 'object') cfg.apps = { items: [] };
    var seenAppIds = {};
    cfg.apps.items = (Array.isArray(cfg.apps.items) ? cfg.apps.items : []).map(function (app) {
      if (!app || !String(app.id || '').trim()) return null;
      var id = String(app.id).trim();
      if (seenAppIds[id]) return null;
      seenAppIds[id] = true;
      return { id: id, name: String(app.name || id).trim() || id };
    }).filter(Boolean);
    cfg.remoteConfig.url = String(cfg.remoteConfig.url || '').trim();
    cfg.remoteConfig.token = String(cfg.remoteConfig.token || '').trim();
    if (cfg.remoteConfig.enabled && !cfg.remoteConfig.token && state.token &&
        cfg.remoteConfig.url.indexOf(SERVER_BASE) === 0) {
      cfg.remoteConfig.token = state.token;
    }
    return cfg;
  }

  async function saveConfig() {
    if (!state.current || state.saving) return;
    state.saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      var data = await api('api/config/' + encodeURIComponent(state.current), {
        method: 'PUT',
        body: JSON.stringify({ config: normalizeForSave() })
      });
      state.config = merge(JSON.parse(JSON.stringify(DEFAULTS)), data.config || {});
    delete state.config.mqtt;
      state.revision = data.revision || '';
      state.updatedAt = data.updatedAt || '';
      state.dirty = false;
      clearDirty();
      showError('');
      render();
      await loadDevices();
      renderDevices();
      toast('Saved. The TV will apply it on its next poll.', 'ok');
    } catch (err) {
      if (!err.unauthorised) {
        showError('Save failed: ' + err.message);
        toast('Save failed', 'bad');
      }
    } finally {
      state.saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
    }
  }

  async function revertConfig() {
    if (!state.current) return;
    if (state.dirty && !window.confirm('Discard unsaved changes?')) return;
    try {
      await loadConfig(state.current);
      toast('Reverted to the saved config', '');
    } catch (err) {
      if (!err.unauthorised) showError('Revert failed: ' + err.message);
    }
  }

  async function deleteDevice() {
    if (!state.current) return;
    if (!window.confirm('Delete the configuration for "' + (state.config.deviceName || state.current) + '"? This cannot be undone.')) return;
    try {
      await api('api/devices/' + encodeURIComponent(state.current), { method: 'DELETE' });
      toast('Device deleted', '');
      state.current = null;
      state.config = null;
      await loadDevices();
      if (state.devices.length) await loadConfig(state.devices[0].id);
      else showEmpty();
    } catch (err) {
      if (!err.unauthorised) showError('Delete failed: ' + err.message);
    }
  }

  async function downloadConfig() {
    if (!state.current) return;
    try {
      var res = await fetch('api/bootstrap/' + encodeURIComponent(state.current), {
        headers: state.token ? { Authorization: 'Bearer ' + state.token } : {},
        cache: 'no-store'
      });
      if (res.status === 401) { openTokenModal('The server rejected that token.'); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'config-' + state.current + '.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Downloaded config-' + state.current + '.json', 'ok');
    } catch (err) {
      showError('Download failed: ' + err.message);
    }
  }


  /* ---------- Home Assistant entity picker ---------- */

  function pickerMatches(entity, domain, deviceClasses) {
    if (!entity || !entity.entity_id) return false;
    if (domain && entity.entity_id.split('.')[0] !== domain) return false;
    if (!deviceClasses.length) return true;
    var attrs = entity.attributes || {};
    var deviceClass = String(attrs.device_class || '').toLowerCase();
    var unit = String(attrs.unit_of_measurement || '').toLowerCase();
    if (deviceClasses.indexOf(deviceClass) !== -1) return true;
    return deviceClasses.indexOf('power') !== -1 && ['w', 'kw', 'wh', 'kwh'].indexOf(unit) !== -1;
  }

  async function fetchPickerEntities(baseUrl, token) {
    try {
      var data = await api('api/ha/entities', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: baseUrl, token: token })
      });
      if (data && data.ok) return data.entities || [];
      if (data && data.error) throw new Error(data.error);
    } catch (e) {
      if (e && e.unauthorised) throw e;
      /* On-TV server has no HA proxy; try HA directly. */
    }
    var base = String(baseUrl || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('Set the Home Assistant URL first');
    var res = await fetch(base + '/api/states', {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('Home Assistant returned HTTP ' + res.status);
    return await res.json();
  }

  function openHaPicker(button) {
    var path = button.getAttribute('data-picker');
    var domain = button.getAttribute('data-domain') || '';
    var deviceClasses = (button.getAttribute('data-device-classes') || '').split(',').filter(Boolean);
    var label = button.getAttribute('data-picker-label') || 'Entity';
    var baseUrl = value('ha.baseUrl');
    var token = value('ha.token');
    if (!baseUrl || !token) {
      toast('Set the Home Assistant URL and token first', 'bad');
      return;
    }
    var overlay = document.createElement('div');
    overlay.className = 'picker-overlay';
    overlay.innerHTML = '<div class="picker-card">' +
      '<div class="picker-head"><div><h2>' + esc(label) + '</h2><p>Choose an entity from Home Assistant</p></div>' +
      '<button type="button" class="btn ghost small" data-picker-close>Close</button></div>' +
      '<input type="search" class="picker-search" data-picker-search placeholder="Search by name or entity ID" autocomplete="off">' +
      '<div class="picker-status" data-picker-status>Loading entities…</div>' +
      '<div class="picker-list" data-picker-list></div>' +
      '</div>';
    document.body.appendChild(overlay);
    var list = overlay.querySelector('[data-picker-list]');
    var status = overlay.querySelector('[data-picker-status]');
    var search = overlay.querySelector('[data-picker-search]');
    var all = [];
    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function render() {
      var query = String(search.value || '').trim().toLowerCase();
      var filtered = all.filter(function (entity) {
        if (!query) return true;
        var name = String((entity.attributes && entity.attributes.friendly_name) || entity.entity_id).toLowerCase();
        return name.indexOf(query) !== -1 || entity.entity_id.toLowerCase().indexOf(query) !== -1;
      });
      if (!filtered.length) {
        list.innerHTML = '<p class="section-note">No matching entities.</p>';
        return;
      }
      list.innerHTML = filtered.map(function (entity) {
        var name = (entity.attributes && entity.attributes.friendly_name) || entity.entity_id;
        return '<button type="button" class="picker-item" data-picker-entity="' + esc(entity.entity_id) + '">' +
          '<span class="picker-item-main"><b>' + esc(name) + '</b><small>' + esc(entity.entity_id) + '</small></span>' +
          '<span class="picker-item-state">' + esc(entity.state) + '</span></button>';
      }).join('');
    }
    function select(id) {
      var input = form.querySelector('[data-path="' + path.replace(/"/g, '\\"') + '"]');
      if (input) {
        input.value = id;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
      close();
    }
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay || event.target.closest('[data-picker-close]')) { close(); return; }
      var item = event.target.closest('[data-picker-entity]');
      if (item) select(item.getAttribute('data-picker-entity'));
    });
    search.addEventListener('input', render);
    document.addEventListener('keydown', function escape(event) {
      if (event.key === 'Escape') { close(); document.removeEventListener('keydown', escape); }
    });
    fetchPickerEntities(baseUrl, token).then(function (entities) {
      all = (entities || []).filter(function (entity) {
        return pickerMatches(entity, domain, deviceClasses);
      });
      if (!all.length && domain) {
        all = (entities || []).filter(function (entity) {
          return entity.entity_id && entity.entity_id.split('.')[0] === domain;
        });
      }
      all.sort(function (a, b) {
        var na = (a.attributes && a.attributes.friendly_name) || a.entity_id;
        var nb = (b.attributes && b.attributes.friendly_name) || b.entity_id;
        return na.localeCompare(nb);
      });
      status.textContent = all.length + (all.length === 1 ? ' entity' : ' entities');
      if (!all.length) {
        list.innerHTML = '<p class="section-note">No matching entities. Check the token and HA connection.</p>';
      } else {
        render();
      }
    }).catch(function (err) {
      status.textContent = err.message;
      list.innerHTML = '<p class="section-note">Could not load entities. If this page is served by the TV, use the on-screen Settings picker instead.</p>';
    });
  }

  /* ---------- tests ---------- */

  async function refreshAddonEpg(button) {
    var status = form.querySelector('[data-epg-status]');
    if (status) { status.className = 'test-result'; status.textContent = 'Refreshing…'; }
    button.disabled = true;
    try {
      var data = await api('/api/epg/refresh', { method: 'POST', body: '{}' });
      if (status) {
        status.className = 'test-result ok';
        status.textContent = data && data.ok
          ? ('Updated · ' + data.channels + ' channels · ' + data.augmented + ' with LCN')
          : ('EPG error: ' + ((data && data.error) || 'unknown'));
      }
      toast('Add-on guide refreshed', 'ok');
    } catch (err) {
      if (status) { status.className = 'test-result bad'; status.textContent = err.message; }
      toast('Could not refresh guide: ' + err.message, 'bad');
    } finally {
      button.disabled = false;
    }
  }

  async function runTest(kind, button) {
    var result = form.querySelector('[data-test-result="' + kind + '"]');
    if (result) { result.className = 'test-result'; result.textContent = 'Testing…'; }
    button.disabled = true;
    try {
      var body = {};
      var endpoint = 'api/test/' + kind;
      if (kind === 'ha') body = { baseUrl: value('ha.baseUrl'), token: value('ha.token') };
      if (kind === 'xmltv') body = { url: value('epg.xmltvUrl') };
      var data = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
      if (data && data.ok) {
        var text = kind === 'ha' ? ('Connected · ' + data.count + ' entities') :
          ('XMLTV · ' + data.channels + ' channels, ' + data.programmes + ' programmes');
        result.className = 'test-result ok';
        result.textContent = text;
      } else {
        result.className = 'test-result bad';
        result.textContent = (data && data.error) || 'Test failed';
      }
    } catch (err) {
      if (!err.unauthorised && result) {
        result.className = 'test-result bad';
        result.textContent = err.message;
      }
    } finally {
      button.disabled = false;
    }
  }

  /* ---------- snippets ---------- */

  function copySnippet() {
    var pre = document.getElementById('bootstrap-text');
    if (!pre) return;
    var text = pre.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Snippet copied', 'ok'); }, function () { toast('Could not copy', 'bad'); });
    } else {
      var area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); toast('Snippet copied', 'ok'); } catch (e) { toast('Could not copy', 'bad'); }
      document.body.removeChild(area);
    }
  }

  function useThisServer() {
    var endpoint = SERVER_BASE + '/api/config/' + encodeURIComponent(state.current);
    var rc = state.config.remoteConfig;
    rc.enabled = true;
    rc.url = endpoint;
    rc.token = state.token || rc.token || '';
    if (!rc.pollMinutes) rc.pollMinutes = 5;
    markDirty();
    render();
    toast('Remote URL filled in. Save changes to apply it.', 'ok');
  }

  /* ---------- device add modal ---------- */

  function openNewDevice() {
    var copy = document.getElementById('new-copy');
    copy.innerHTML = state.devices.map(function (device) {
      return '<option value="' + esc(device.id) + '">' + esc(device.name || device.id) + '</option>';
    }).join('');
    document.getElementById('new-id').value = '';
    document.getElementById('new-name').value = '';
    document.getElementById('new-model').value = '';
    newError.hidden = true;
    deviceModal.hidden = false;
    setTimeout(function () { document.getElementById('new-id').focus(); }, 50);
  }

  function openImportDevice() {
    importError.hidden = true;
    importError.textContent = '';
    document.getElementById('import-ip').value = '';
    importModal.hidden = false;
    setTimeout(function () { document.getElementById('import-ip').focus(); }, 50);
  }

  function closeImportDevice() {
    importModal.hidden = true;
    importError.hidden = true;
  }

  async function importDevice() {
    var input = document.getElementById('import-ip');
    var button = document.getElementById('import-save');
    var ip = input.value.trim();
    importError.hidden = true;
    if (!ip) {
      importError.hidden = false;
      importError.textContent = 'Enter the TV IP address';
      return;
    }
    button.disabled = true;
    button.textContent = 'Importing…';
    try {
      var data = await api('api/import/tv', {
        method: 'POST',
        body: JSON.stringify({ ip: ip })
      });
      importModal.hidden = true;
      await loadDevices();
      await loadConfig(data.device.id);
      toast(data.replaced ? 'Imported and updated ' + data.device.name : 'Imported ' + data.device.name, 'ok');
    } catch (err) {
      if (!err.unauthorised) {
        importError.hidden = false;
        importError.textContent = err.message;
      }
    } finally {
      button.disabled = false;
      button.textContent = 'Import TV';
    }
  }

  async function createDevice() {
    var id = slug(document.getElementById('new-id').value);
    var name = document.getElementById('new-name').value.trim() || id;
    var model = document.getElementById('new-model').value.trim();
    var copyFrom = document.getElementById('new-copy').value;
    newError.hidden = true;
    if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(id)) {
      newError.hidden = false;
      newError.textContent = 'Device ID must use lowercase letters, numbers, hyphen or underscore.';
      return;
    }
    if (!copyFrom) {
      newError.hidden = false;
      newError.textContent = 'Add at least one existing device first.';
      return;
    }
    try {
      await api('api/devices', {
        method: 'POST',
        body: JSON.stringify({ id: id, name: name, model: model, copyFrom: copyFrom })
      });
      deviceModal.hidden = true;
      await loadDevices();
      await loadConfig(id);
      toast('Device created', 'ok');
    } catch (err) {
      if (!err.unauthorised) {
        newError.hidden = false;
        newError.textContent = err.message;
      }
    }
  }

  /* ---------- empty state ---------- */

  function showEmpty() {
    state.config = null;
    form.hidden = true;
    form.innerHTML = '';
    emptyEl.hidden = false;
    title.textContent = 'No device selected';
    meta.textContent = 'Add a device to get started.';
    clearDirty();
    renderDevices();
  }

  /* ---------- events ---------- */

  function handleFieldChange(event) {
    var el = event.target;
    if (el.dataset && el.dataset.path) {
      var valueToSet = el.type === 'checkbox' ? el.checked : el.value;
      setPath(state.config, el.dataset.path, valueToSet);
      markDirty();
      return;
    }
    if (el.dataset && el.dataset.appField) {
      var items = appItems();
      var index = Number(el.dataset.appIndex);
      if (items[index]) {
        items[index][el.dataset.appField] = el.value;
        markDirty();
      }
    }
  }

  function handleFormClick(event) {
    var target = event.target.closest('button');
    if (!target) return;

    if (target.matches('[data-picker]')) { openHaPicker(target); return; }
    if (target.matches('[data-save]')) { saveConfig(); return; }
    if (target.matches('[data-revert]')) { revertConfig(); return; }
    if (target.matches('[data-download]')) { downloadConfig(); return; }
    if (target.matches('[data-use-server]')) { useThisServer(); return; }
    if (target.matches('[data-copy-snippet]')) { copySnippet(); return; }
    if (target.matches('[data-app-add]')) {
      appItems().push({ id: '', name: '' });
      markDirty();
      render();
      return;
    }
    if (target.matches('[data-app-remove]')) {
      appItems().splice(Number(target.getAttribute('data-app-remove')), 1);
      markDirty();
      render();
      return;
    }
    if (target.matches('[data-app-up]')) {
      var up = Number(target.getAttribute('data-app-up'));
      var upItems = appItems();
      if (up > 0) {
        var swapUp = upItems[up - 1];
        upItems[up - 1] = upItems[up];
        upItems[up] = swapUp;
        markDirty();
        render();
      }
      return;
    }
    if (target.matches('[data-epg-refresh]')) {
      refreshAddonEpg(target);
      return;
    }
    if (target.matches('[data-reset-field]')) {
      var resetPath = target.getAttribute('data-reset-field');
      var defaultValue = getPath(DEFAULTS, resetPath);
      if (defaultValue === undefined) {
        toast('No default for this setting', 'bad');
        return;
      }
      var field = form.querySelector('[data-path="' + resetPath.replace(/"/g, '\\"') + '"]');
      if (field) {
        if (field.type === 'checkbox') field.checked = !!defaultValue;
        else field.value = defaultValue == null ? '' : String(defaultValue);
      }
      setPath(state.config, resetPath, defaultValue);
      markDirty();
      toast('Reset to default', 'ok');
      return;
    }
    if (target.matches('[data-app-down]')) {
      var down = Number(target.getAttribute('data-app-down'));
      var downItems = appItems();
      if (down < downItems.length - 1) {
        var swapDown = downItems[down + 1];
        downItems[down + 1] = downItems[down];
        downItems[down] = swapDown;
        markDirty();
        render();
      }
      return;
    }

    var test = target.getAttribute('data-test');
    if (test) { runTest(test, target); return; }

  }

  function bind() {
    form.addEventListener('input', handleFieldChange);
    form.addEventListener('change', handleFieldChange);
    form.addEventListener('click', handleFormClick);
    form.addEventListener('submit', function (event) { event.preventDefault(); });

    document.getElementById('save').addEventListener('click', saveConfig);
    document.getElementById('revert').addEventListener('click', revertConfig);
    document.getElementById('delete-device').addEventListener('click', deleteDevice);
    document.getElementById('download-config').addEventListener('click', downloadConfig);
    document.getElementById('add-device').addEventListener('click', openNewDevice);
    document.getElementById('empty-add').addEventListener('click', openNewDevice);
    document.getElementById('import-device').addEventListener('click', openImportDevice);
    document.getElementById('empty-import').addEventListener('click', openImportDevice);
    document.getElementById('import-cancel').addEventListener('click', closeImportDevice);
    document.getElementById('import-save').addEventListener('click', importDevice);
    document.getElementById('import-ip').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); importDevice(); }
    });
    document.getElementById('token-btn').addEventListener('click', function () { openTokenModal(''); });

    deviceList.addEventListener('click', function (event) {
      var button = event.target.closest('[data-device]');
      if (button) selectDevice(button.getAttribute('data-device'));
    });

    document.getElementById('token-save').addEventListener('click', saveToken);
    document.getElementById('token-cancel').addEventListener('click', function () {
      closeTokenModal();
      if (!state.devices.length) showError('An access token is required to load configurations.');
    });
    tokenInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') saveToken();
    });

    document.getElementById('new-cancel').addEventListener('click', function () { deviceModal.hidden = true; });
    document.getElementById('new-save').addEventListener('click', createDevice);

    document.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveConfig();
      }
      if (event.key === 'Escape') {
        if (!tokenModal.hidden) closeTokenModal();
        if (!deviceModal.hidden) deviceModal.hidden = true;
        if (importModal && !importModal.hidden) closeImportDevice();
      }
    });

    window.addEventListener('beforeunload', function (event) {
      if (state.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    var nameInput = document.getElementById('new-name');
    var idInput = document.getElementById('new-id');
    nameInput.addEventListener('input', function () {
      if (!idInput.dataset.edited) idInput.value = slug(nameInput.value);
    });
    idInput.addEventListener('input', function () { idInput.dataset.edited = '1'; });
  }

  /* ---------- boot ---------- */

  async function boot() {
    try {
      showError('');
      var devices = await loadDevices();
      if (!devices.length) {
        showEmpty();
        return;
      }
      var preferred = localStorage.getItem(DEVICE_KEY);
      var exists = devices.some(function (d) { return d.id === preferred; });
      var target = exists ? preferred : (state.current && devices.some(function (d) { return d.id === state.current; }) ? state.current : devices[0].id);
      await loadConfig(target);
    } catch (err) {
      if (err.unauthorised) {
        setServerStatus(false, 'Token required');
        return;
      }
      setServerStatus(false, 'Server unreachable');
      showError('Cannot reach the config server: ' + err.message);
    }
  }

  bind();
  boot();
})();
