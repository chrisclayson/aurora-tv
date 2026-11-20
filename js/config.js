/* Aurora — configuration store.
   Precedence: localStorage (user edits) > config.json (provisioned seed) > defaults. */
(function (A) {
  'use strict';

  var STORAGE_KEY = 'aurora.config.v1';

  var DEFAULTS = {
    schema: 1,
    deviceId: 'living-room',
    deviceName: 'Living Room',
    model: '',
    ha: {
      enabled: false,
      baseUrl: '',
      token: '',
      pages: [
        { id: 'home', name: 'Home', widgets: [] }
      ],
      currentPage: 'home',
      tvEntity: '',
      musicEntity: '',
      lightEntity: '',
      powerEntity: ''
    },
    epg: {
      xmltvUrl: '',
      demo: true,
      refreshMinutes: 60,
      horizonHours: 3
    },
    sources: {
      hdmi1: { label: 'HDMI 1', sub: 'Apple TV', appId: '', haSource: 'HDMI1' },
      hdmi2: { label: 'HDMI 2', sub: 'Games console', appId: '', haSource: 'HDMI2' },
      hdmi3: { label: 'HDMI 3', sub: 'Media PC', appId: '', haSource: 'HDMI3' },
      hdmi4: { label: 'HDMI 4', sub: 'Spare input', appId: '', haSource: 'HDMI4' },
      livetv: { label: 'Live TV', sub: 'Antenna / cable', appId: 'org.tizen.tv-viewer', haSource: 'TV' }
    },
    livetv: {
      guideAppId: '',
      defaultChannel: ''
    },
    ui: {
      lastExternal: 'livetv',
      dashboardDuration: 30,
      overlayTimeoutMs: 3500
    },
    remoteConfig: {
      enabled: false,
      url: '',
      token: '',
      pollMinutes: 5
    },
    localServer: {
      enabled: true,
      token: '',
      host: ''
    }
  };

  var state = {
    config: null,
    seeded: false,
    loaded: false,
    error: '',
    listeners: []
  };

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function merge(base, override) {
    if (!isPlainObject(override)) return base;
    var out = {};
    Object.keys(base).forEach(function (key) { out[key] = base[key]; });
    Object.keys(override).forEach(function (key) {
      if (isPlainObject(base[key]) && isPlainObject(override[key])) {
        out[key] = merge(base[key], override[key]);
      } else if (override[key] !== undefined) {
        out[key] = override[key];
      }
    });
    return out;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalize(cfg) {
    // MQTT support was removed; drop credentials left by older configs.
    delete cfg.mqtt;
    if (!cfg.sources || typeof cfg.sources !== 'object') cfg.sources = clone(DEFAULTS.sources);
    Object.keys(DEFAULTS.sources).forEach(function (id) {
      if (!cfg.sources[id]) cfg.sources[id] = clone(DEFAULTS.sources[id]);
    });
    // Native Home Assistant pages replace the old iframe dashboards.
    delete cfg.ha.dashboards;
    delete cfg.ha.defaultDashboard;
    if (!Array.isArray(cfg.ha.pages) || !cfg.ha.pages.length) {
      cfg.ha.pages = clone(DEFAULTS.ha.pages);
    }
    var seenPages = {};
    cfg.ha.pages = cfg.ha.pages.filter(function (page) {
      return page && page.id;
    }).map(function (page) {
      var seenWidgets = {};
      var widgets = Array.isArray(page.widgets) ? page.widgets.filter(function (widget) {
        if (!widget || !widget.entity) return false;
        var id = String(widget.entity);
        if (seenWidgets[id]) return false;
        seenWidgets[id] = true;
        return true;
      }).map(function (widget) {
        return {
          entity: String(widget.entity),
          type: widget.type ? String(widget.type) : ''
        };
      }) : [];
      return {
        id: String(page.id),
        name: String(page.name || page.id).trim() || String(page.id),
        widgets: widgets
      };
    }).filter(function (page) {
      if (seenPages[page.id]) return false;
      seenPages[page.id] = true;
      return true;
    });
    if (!cfg.ha.pages.length) cfg.ha.pages = clone(DEFAULTS.ha.pages);
    var pageIds = cfg.ha.pages.map(function (page) { return page.id; });
    if (pageIds.indexOf(cfg.ha.currentPage) === -1) cfg.ha.currentPage = pageIds[0];
    cfg.epg.horizonHours = Math.max(1, Math.min(12, Number(cfg.epg.horizonHours) || 3));
    cfg.epg.refreshMinutes = Math.max(5, Math.min(1440, Number(cfg.epg.refreshMinutes) || 60));
    cfg.ui.dashboardDuration = Math.max(5, Math.min(3600, Number(cfg.ui.dashboardDuration) || 30));
    cfg.ui.overlayTimeoutMs = Math.max(1500, Math.min(15000, Number(cfg.ui.overlayTimeoutMs) || 3500));
    if (!cfg.sources[cfg.ui.lastExternal]) cfg.ui.lastExternal = 'livetv';
    // Older seeds used non-existent input app IDs. HDMI uses the native
    // TVWindow API; only keep a non-default app ID as a deliberate fallback.
    ['hdmi1', 'hdmi2', 'hdmi3', 'hdmi4'].forEach(function (id) {
      var src = cfg.sources[id];
      if (src && src.appId === 'org.tizen.' + id) src.appId = '';
    });
    if (cfg.sources.livetv && cfg.sources.livetv.appId === 'org.tizen.tv') {
      cfg.sources.livetv.appId = 'org.tizen.tv-viewer';
    }
    cfg.deviceId = String(cfg.deviceId || 'tv').replace(/[^a-zA-Z0-9_-]/g, '-') || 'tv';
    cfg.deviceName = String(cfg.deviceName || 'Living Room').trim() || 'Living Room';
    cfg.ha.baseUrl = String(cfg.ha.baseUrl || '').trim().replace(/\/+$/, '');
    cfg.ha.token = String(cfg.ha.token || '').trim();
    cfg.ha.tvEntity = String(cfg.ha.tvEntity || '').trim();
    cfg.ha.musicEntity = String(cfg.ha.musicEntity || '').trim();
    cfg.ha.lightEntity = String(cfg.ha.lightEntity || '').trim();
    delete cfg.ha.motionEntity;
    cfg.ha.powerEntity = String(cfg.ha.powerEntity || '').trim();
    cfg.epg.xmltvUrl = String(cfg.epg.xmltvUrl || '').trim();
    if (!cfg.remoteConfig || typeof cfg.remoteConfig !== 'object') cfg.remoteConfig = clone(DEFAULTS.remoteConfig);
    cfg.remoteConfig.url = String(cfg.remoteConfig.url || '').trim();
    cfg.remoteConfig.token = String(cfg.remoteConfig.token || '').trim();
    cfg.remoteConfig.pollMinutes = Math.max(1, Math.min(1440, Number(cfg.remoteConfig.pollMinutes) || 5));
    if (!cfg.localServer || typeof cfg.localServer !== 'object') cfg.localServer = { enabled: true };
    cfg.localServer.enabled = cfg.localServer.enabled !== false;
    cfg.localServer.token = String(cfg.localServer.token || '').trim();
    cfg.localServer.host = String(cfg.localServer.host || '').trim();
    return cfg;
  }

  function embeddedSeed() {
    var embedded = window.AURORA_SEED;
    return embedded && typeof embedded === 'object' ? embedded : null;
  }

  function loadSeed() {
    if (typeof fetch !== 'function') return Promise.resolve(embeddedSeed());
    return fetch('config.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (seed) { return seed || embeddedSeed(); })
      .catch(function () { return embeddedSeed(); });
  }

  function init() {
    var saved = null;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) {
      state.error = 'Could not read saved settings';
    }

    // A saved profile already has the provisioned sources, identity and Home
    // Assistant settings. Resolve immediately instead of waiting for a local
    // config.json fetch on every launch; new defaults are filled in by
    // normalize().
    if (saved && typeof saved === 'object' && !Array.isArray(saved) && Object.keys(saved).length) {
      state.config = normalize(merge(clone(DEFAULTS), saved));
      state.loaded = true;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config)); } catch (e) { /* ignore quota */ }
      return Promise.resolve(state.config);
    }

    return loadSeed().then(function (seed) {
      var base = clone(DEFAULTS);
      if (seed && typeof seed === 'object') {
        base = merge(base, seed);
        state.seeded = true;
      }
      state.config = normalize(base);
      state.loaded = true;
      // Persist the merged result so a broken config.json cannot wedge boot.
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config)); } catch (e) { /* ignore quota */ }
      return state.config;
    });
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
      return true;
    } catch (e) {
      state.error = 'Could not persist settings';
      return false;
    }
  }

  function save() {
    if (!state.config) return false;
    state.config = normalize(state.config);
    if (!persist()) return false;
    notify();
    return true;
  }

  function previewRemote(remote) {
    if (!state.config || !isPlainObject(remote)) return null;
    return normalize(merge(state.config, remote));
  }

  function applyRemote(remote) {
    if (!state.config || !isPlainObject(remote)) return null;
    state.config = normalize(merge(state.config, remote));
    persist();
    notify();
    return state.config;
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    return loadSeed().then(function (seed) {
      state.config = normalize(merge(clone(DEFAULTS), seed || {}));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config)); } catch (e) { /* ignore */ }
      notify();
      return state.config;
    });
  }

  function get() {
    return state.config;
  }

  function cloneConfig() {
    return clone(state.config);
  }

  function onChange(fn) {
    state.listeners.push(fn);
  }

  function notify() {
    state.listeners.forEach(function (fn) {
      try { fn(state.config); } catch (e) { /* a listener must not break config */ }
    });
  }

  A.Config = {
    DEFAULTS: DEFAULTS,
    init: init,
    get: get,
    clone: cloneConfig,
    save: save,
    reset: reset,
    normalize: normalize,
    previewRemote: previewRemote,
    applyRemote: applyRemote,
    onChange: onChange,
    isSeeded: function () { return state.seeded; },
    error: function () { return state.error; }
  };
})(window.Aurora = window.Aurora || {});
