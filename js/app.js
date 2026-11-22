/* Aurora — application logic: navigation, guide, Home Assistant and remote config. */
(function (A) {
  'use strict';

  var U = A.Util;

  var state = {
    screen: 'home',
    bootedAt: Date.now(),
    tileIndex: 0,
    tiles: [],
    focusTileId: '',
    homeRegion: 'tiles',
    sensorIndex: 0,
    sensorPress: null,
    apps: { open: false, index: 0, focusId: '' },
    appCatalog: { items: [], updated: 0, loading: false },
    notifications: { index: 0 },
    appPicker: { items: [], index: 0, loading: false, error: '', selectedId: '', mode: 'apps', path: '', title: '' },
    lastExternal: 'livetv',
    currentSource: '',
    sourceChangedAt: 0,
    previewSource: '',
    backgrounded: false,
    currentChannel: null,
    channelTimer: null,
    calendar: { events: [], loading: false, error: '', updated: 0, lastAttempt: 0, available: false },
    calendarTimer: null,
    weather: { forecast: [], loading: false, error: '', updated: 0, lastAttempt: 0, available: false },
    weatherTimer: null,
    haKey: '',
    haDashboard: '',
    haTemp: null,
    haOverlayTimer: null,
    tickTimer: null,
    clockTimer: null,
    epgTimer: null,
    remoteTimer: null,
    sourcesTimer: null,
    hdmiPortsKey: 'init',
    liveTimer: null,
    liveToken: 0,
    sourceRenderTimer: null,
    localServerStatus: { enabled: false, ready: false, error: '', url: '', revision: '' },
    setupOverlayScheduled: false,
    setupAttempts: 0,
    remote: {
      inFlight: null,
      lastAttempt: 0,
      lastSync: 0,
      revision: '',
      error: '',
      pending: null,
      pendingRevision: ''
    },
    guide: null,
    settings: {
      draft: null,
      index: 0,
      rows: [],
      actions: [],
      dirty: false,
      importMode: false,
      importTimer: null
    },
    savedLabel: '',
    festiveKey: '',
    picker: {
      path: '',
      label: '',
      title: '',
      domain: '',
      deviceClasses: [],
      index: 0,
      items: []
    }
  };

  var ACCENTS = ['blue', 'violet', 'teal', 'orange'];
  var refreshChannelSoon = U.throttle(function () { refreshChannel(); }, 1500);

  /* ---------- small helpers ---------- */

  function cfg() { return A.Config.get(); }

  function q(sel) { return document.querySelector(sel); }

  function tileIndexById(id) {
    for (var i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i].id === id) return i;
    }
    return 0;
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
      if (!target[parts[i]] || typeof target[parts[i]] !== 'object') target[parts[i]] = {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  }

  function mask(value) {
    return value ? '••••••••' : 'Not set';
  }

  function homeSubtitle() {
    var conf = cfg();
    if (state.currentChannel && state.currentChannel.name) {
      return conf.deviceName + ' · ' + state.currentChannel.name +
        (state.currentChannel.program ? ' · ' + state.currentChannel.program : '');
    }
    if (state.previewSource && conf.sources[state.previewSource]) {
      return conf.deviceName + ' · ' + conf.sources[state.previewSource].label + ' (preview)';
    }
    return conf.deviceName + ' · ' + (conf.ha.enabled ? 'Home Assistant ready' : 'Choose an input to begin');
  }

  function channelLabel(channel) {
    if (!channel) return '';
    var number = String(channel.number == null ? '' : channel.number).trim();
    var name = String(channel.name == null ? '' : channel.name).trim();
    if (number && name) return number + ' · ' + name;
    return number || name;
  }

  function haNowPlaying() {
    var id = cfg().ha.tvEntity;
    if (!id || !A.HA.configured) return '';
    var entity = A.HA.entity(id);
    if (!entity || entity.state === 'off' || entity.state === 'unavailable' || entity.state === 'unknown') {
      return '';
    }
    var attrs = entity.attributes || {};
    var title = String(attrs.media_title || attrs.media_series_title || '').trim();
    if (!title) return '';
    if (/^hdmi\s*\d+$/i.test(title) || /^live\s*tv$/i.test(title)) return '';
    return title;
  }

  function statusModel() {
    var conf = cfg();
    var haOk = A.HA.connected || A.HA.restOk;
    return {
      ha: {
        ok: haOk,
        error: !haOk && !!A.HA.error,
        label: 'HA',
        title: haOk
          ? (A.HA.connected ? 'Home Assistant connected' : 'Home Assistant polling over REST')
          : (conf.ha.enabled ? (A.HA.error || 'Connecting to Home Assistant') : 'Home Assistant disabled')
      }
    };
  }

  function sourceName(id) {
    var conf = cfg();
    return conf.sources[id] ? conf.sources[id].label : id;
  }

  /* ---------- remote configuration ---------- */

  function remoteInfo() {
    var rc = cfg().remoteConfig || {};
    return {
      enabled: !!(rc.enabled && rc.url),
      url: rc.url || '',
      pollMinutes: rc.pollMinutes || 5,
      lastSync: state.remote.lastSync ? new Date(state.remote.lastSync).toISOString() : null,
      revision: state.remote.revision || '',
      error: state.remote.error || '',
      pending: !!state.remote.pending
    };
  }

  function remoteFetchJson(url, headers, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('Remote configuration request timed out'));
      }, timeoutMs || 5000);
      fetch(url, { headers: headers, cache: 'no-store' }).then(function (res) {
        if (done) return;
        if (!res.ok) {
          done = true;
          clearTimeout(timer);
          reject(new Error('Remote configuration returned HTTP ' + res.status));
          return;
        }
        return res.json().then(function (body) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(body);
        });
      }).catch(function (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function looksLikeConfig(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      (value.deviceId || value.deviceName || value.sources || value.ha || value.epg || value.ui);
  }

  function preserveLocalServer(remote) {
    if (!remote || typeof remote !== 'object') return remote;
    var current = (cfg().localServer) || { enabled: true, token: '' };
    if (!remote.localServer || typeof remote.localServer !== 'object') {
      remote.localServer = { enabled: current.enabled, token: current.token };
    } else {
      remote.localServer.enabled = current.enabled;
      remote.localServer.token = current.token;
    }
    return remote;
  }

  function preserveLocalPages(remote) {
    if (!remote || !remote.ha || typeof remote.ha !== 'object') return remote;
    var local = cfg().ha || {};
    var localPages = Array.isArray(local.pages) ? local.pages : [];
    var localHasWidgets = localPages.some(function (page) {
      return page && Array.isArray(page.widgets) && page.widgets.length > 0;
    });
    var remotePages = Array.isArray(remote.ha.pages) ? remote.ha.pages : [];
    var remoteHasWidgets = remotePages.some(function (page) {
      return page && Array.isArray(page.widgets) && page.widgets.length > 0;
    });
    if (localHasWidgets && !remoteHasWidgets) {
      remote.ha.pages = localPages;
      remote.ha.currentPage = local.currentPage;
    }
    return remote;
  }

  function applyRemoteConfig(remote, revision, silent) {
    remote = preserveLocalServer(remote);
    remote = preserveLocalPages(remote);
    var applied = A.Config.applyRemote(remote);
    if (!applied) return false;
    var conf = A.Config.get();
    state.lastExternal = conf.ui.lastExternal || state.lastExternal;
    state.remote.lastSync = Date.now();
    state.remote.revision = revision || '';
    state.remote.error = '';
    state.remote.pending = null;
    applyConfig();
    if (state.screen === 'home') renderHome();
    if (state.screen === 'guide') {
      state.guide = buildGuide();
      renderGuideScreen();
    }
    updateHomeChrome();
    if (!silent) A.UI.toast('Configuration updated from the web server', 'ok', 3200);
    return true;
  }

  function applyPendingRemote() {
    if (!state.remote.pending) return;
    var pending = state.remote.pending;
    state.remote.pending = null;
    applyRemoteConfig(pending.remote, pending.revision, false);
  }

  function syncRemoteConfig(manual) {
    var rc = cfg().remoteConfig || {};
    if (!rc.enabled || !rc.url) {
      if (manual) A.UI.toast('Remote configuration is not enabled', 'error', 3200);
      return Promise.resolve(false);
    }
    if (state.remote.inFlight) return state.remote.inFlight;

    state.remote.lastAttempt = Date.now();
    var headers = { 'Accept': 'application/json' };
    if (rc.token) headers.Authorization = 'Bearer ' + rc.token;
    var url = rc.url + (rc.url.indexOf('?') === -1 ? '?' : '&') + '_aurora=' + Date.now();

    var task = remoteFetchJson(url, headers).then(function (payload) {
      var remote = payload && payload.config ? payload.config : payload;
      if (!looksLikeConfig(remote)) throw new Error('The remote endpoint did not return an Aurora config');
      // Never let a remote profile change the transport it arrived over: that
      // would let a stale seed disable polling or replace the token and lock
      // the TV out. URL/token/enabled are local bootstrap settings. The poll
      // interval may be managed remotely.
      if (remote.remoteConfig && typeof remote.remoteConfig === 'object' && !Array.isArray(remote.remoteConfig)) {
        var localRemote = cfg().remoteConfig || {};
        remote.remoteConfig.enabled = localRemote.enabled;
        remote.remoteConfig.url = localRemote.url;
        remote.remoteConfig.token = localRemote.token;
        if (remote.remoteConfig.pollMinutes == null) {
          remote.remoteConfig.pollMinutes = localRemote.pollMinutes;
        }
      } else {
        delete remote.remoteConfig;
      }
      var revision = (payload && (payload.revision || payload.version)) || '';
      remote = preserveLocalServer(remote);
      remote = preserveLocalPages(remote);
      var preview = A.Config.previewRemote(remote);
      if (!preview) throw new Error('The remote config could not be merged');
      var changed = JSON.stringify(preview) !== JSON.stringify(A.Config.get());
      state.remote.error = '';
      state.remote.lastSync = Date.now();
      state.remote.revision = revision || state.remote.revision;

      if (!changed) {
        if (manual) A.UI.toast('Remote configuration is already up to date', 'ok', 2600);
        if (state.screen === 'settings') renderSettingsScreen();
        return false;
      }

      var editing = state.screen === 'editor' || state.screen === 'entity-picker';
      if (state.screen === 'settings' || editing || A.UI.modalOpen()) {
        state.remote.pending = { remote: remote, revision: revision };
        state.remote.pendingRevision = revision || '';
        if (manual) A.UI.toast('Update available — leave Settings to apply it', '', 3800);
        if (state.screen === 'settings') renderSettingsScreen();
        setTimeout(function () {
          var busy = state.screen === 'settings' || state.screen === 'editor' ||
            state.screen === 'entity-picker' || A.UI.modalOpen();
          if (state.remote.pending && !busy) applyPendingRemote();
        }, 2500);
        return false;
      }

      return applyRemoteConfig(remote, revision, false);
    }).then(function (result) {
      state.remote.inFlight = null;
      return result;
    }, function (err) {
      state.remote.inFlight = null;
      state.remote.error = err.message || 'Remote configuration failed';
      if (state.screen === 'settings') renderSettingsScreen();
      if (manual) A.UI.toast('Remote config: ' + state.remote.error, 'error', 5000);
      return false;
    });

    state.remote.inFlight = task;
    return task;
  }

  function scheduleRemoteSync() {
    clearInterval(state.remoteTimer);
    state.remoteTimer = setInterval(function () {
      var rc = cfg().remoteConfig || {};
      if (!rc.enabled || !rc.url) return;
      if (Date.now() - state.remote.lastAttempt >= (rc.pollMinutes || 5) * 60000) {
        syncRemoteConfig(false);
      }
    }, 30000);
  }

  /* ---------- home ---------- */

  function buildTiles() {
    var conf = cfg();
    var tiles = [];
    var connectedHdmi = A.Platform.hdmiPorts();
    ['hdmi1', 'hdmi2', 'hdmi3', 'hdmi4'].forEach(function (id, index) {
      var src = conf.sources[id];
      if (!src) return;
      if (connectedHdmi && connectedHdmi.indexOf(index + 1) === -1) return;
      var nowPlaying = state.currentSource === id ? haNowPlaying() : '';
      tiles.push({
        id: id,
        kind: 'HDMI',
        label: src.label,
        sub: nowPlaying || src.sub || 'External input',
        icon: 'hdmi',
        accent: ACCENTS[index % ACCENTS.length],
        active: state.currentSource === id
      });
    });

    var channel = state.currentChannel;
    var channelSub = channelLabel(channel);
    tiles.push({
      id: 'livetv',
      kind: 'LIVE TV',
      label: conf.sources.livetv ? conf.sources.livetv.label : 'Live TV',
      sub: channelSub,
      icon: 'tv',
      accent: 'red',
      badge: channelSub ? 'LIVE' : '',
      active: state.currentSource === 'livetv'
    });

    var guideOnNow = '';
    var guideChannels = A.EPG.channels();
    var guideChannel = guideChannels[0];
    if (state.currentChannel && state.currentChannel.name) {
      guideChannels.forEach(function (item) {
        if (String(item.name).toLowerCase() === String(state.currentChannel.name).toLowerCase()) {
          guideChannel = item;
        }
      });
    }
    if (guideChannel) {
      var nowNext = A.EPG.nowNext(guideChannel.id);
      if (nowNext.now) guideOnNow = nowNext.now.title;
    }
    tiles.push({
      id: 'guide',
      kind: 'EPG',
      label: 'TV Guide',
      sub: guideOnNow ? 'On now: ' + guideOnNow : 'Browse channels',
      icon: 'guide',
      accent: 'indigo'
    });

    if (conf.apps && conf.apps.items && conf.apps.items.length) {
      tiles.push({
        id: 'apps',
        kind: 'APPS',
        label: 'Apps',
        sub: conf.apps.items.length + (conf.apps.items.length === 1 ? ' app' : ' apps') + ' · ' + conf.apps.items[0].name,
        icon: 'apps',
        accent: 'violet'
      });
    }

    tiles.push({
      id: 'ha',
      kind: 'HOME',
      label: 'Home Assistant',
      sub: A.HA.configured ? 'Entity dashboard' : 'Not configured',
      icon: 'home',
      accent: 'amber'
    });

    var musicEntity = A.HA.musicEntity ? A.HA.musicEntity() : '';
    var musicState = musicEntity && A.HA.entity(musicEntity);
    var musicSub = 'Configure a player';
    if (musicEntity) {
      musicSub = musicState && musicState.attributes && musicState.attributes.media_title
        ? musicState.attributes.media_title
        : (musicState ? musicState.state : 'Unavailable');
    }
    tiles.push({
      id: 'music',
      kind: 'AUDIO',
      label: 'Music',
      sub: musicSub,
      icon: 'music',
      accent: 'blue'
    });

    tiles.push({
      id: 'cameras',
      kind: 'CAMERAS',
      label: 'Cameras',
      sub: 'Live camera feeds',
      icon: 'camera',
      accent: 'violet'
    });

    tiles.push({
      id: 'settings',
      kind: 'SYSTEM',
      label: 'Settings',
      sub: 'Network, guide, Home Assistant',
      icon: 'gear',
      accent: 'slate'
    });

    tiles.push({
      id: 'samsunghub',
      kind: 'SAMSUNG',
      label: 'Samsung Hub',
      sub: 'Apps, sources and TV',
      icon: 'dashboard',
      accent: 'indigo'
    });

    if (artModeAvailable()) {
      tiles.push({
        id: 'artmode',
        kind: 'FRAME',
        label: 'Art Mode',
        sub: 'Show artwork on the Frame',
        icon: 'palette',
        accent: 'teal'
      });
    }

    tiles.push({
      id: 'tvsettings',
      kind: 'TV',
      label: 'TV Settings',
      sub: 'Picture, sound, network',
      icon: 'sliders',
      accent: 'teal'
    });

    return tiles;
  }

  function appIcon(app) {
    var text = String((app && (app.name + ' ' + app.id)) || '').toLowerCase();
    if (/music|spotify|tidal|deezer|tunein|radio/.test(text)) return 'music';
    if (/guide|epg/.test(text)) return 'guide';
    if (/browser|internet/.test(text)) return 'wifi';
    if (/camera|security/.test(text)) return 'camera';
    return 'play';
  }

  function ensureAppCatalog() {
    var conf = cfg();
    var apps = (conf.apps && conf.apps.items) || [];
    if ((!apps.length && !conf.epg.nativeGuideAppId) || state.appCatalog.loading) return;
    if (state.appCatalog.updated && Date.now() - state.appCatalog.updated < 5 * 60 * 1000) return;
    state.appCatalog.loading = true;
    A.Platform.listApps().then(function (items) {
      state.appCatalog.items = items || [];
      state.appCatalog.updated = Date.now();
      state.appCatalog.loading = false;
      if (state.screen === 'home') renderHome();
      else if (state.screen === 'settings' && !A.UI.modalOpen()) renderSettingsScreen();
    }).catch(function () {
      state.appCatalog.loading = false;
      state.appCatalog.updated = Date.now();
    });
  }

  function nativeGuideAppName(id) {
    if (!id) return '';
    var name = '';
    [state.appCatalog.items, state.appPicker.installed].forEach(function (list) {
      (list || []).forEach(function (app) {
        if (!name && app && app.id === id) name = app.name || id;
      });
    });
    return name || id;
  }

  function appList() {
    var items = (cfg().apps && cfg().apps.items) || [];
    var catalog = {};
    (state.appCatalog.items || []).forEach(function (item) { catalog[item.id] = item; });
    return items.map(function (app, index) {
      var installed = catalog[app.id];
      return {
        id: app.id,
        name: app.name,
        icon: installed ? installed.icon : '',
        iconName: appIcon(app),
        index: index
      };
    });
  }

  function notificationCount() {
    return A.HA.configured && A.HA.notificationList ? A.HA.notificationList().length : 0;
  }

  function festiveMode() {
    return cfg().ui.festiveMode || 'auto';
  }

  function festiveActive(date) {
    var mode = festiveMode();
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    var d = date || new Date();
    var month = d.getMonth();
    var day = d.getDate();
    return (month === 11 && day >= 1) || (month === 0 && day <= 6);
  }

  function festiveTag(date) {
    var d = date || new Date();
    if (d.getMonth() === 0 && d.getDate() <= 6) return '❄ HAPPY NEW YEAR';
    return '❄ MERRY CHRISTMAS';
  }

  function isChristmasDay(date) {
    var d = date || new Date();
    return d.getMonth() === 11 && d.getDate() === 25;
  }

  function christmasCountdown(date) {
    var d = date || new Date();
    if (!festiveActive(d) || d.getMonth() === 0 || isChristmasDay(d)) return '';
    var christmas = new Date(d.getFullYear(), 11, 25);
    var days = Math.ceil((christmas.getTime() - d.getTime()) / 86400000);
    if (days <= 0) return '';
    return days + (days === 1 ? ' more sleep' : ' more sleeps') + ' 🎁';
  }

  function buildFairyLights() {
    var host = q('#fairy-lights');
    if (!host || host.childElementCount) return;
    var colors = ['#ff4d5a', '#ffd166', '#3ddc84'];
    for (var i = 0; i < 28; i++) {
      var bulb = document.createElement('span');
      bulb.className = 'fairy-bulb';
      bulb.style.left = (((i + 0.5) / 28) * 100).toFixed(2) + '%';
      bulb.style.top = (2 + (i % 3)) + 'px';
      bulb.style.setProperty('--bulb', colors[i % colors.length]);
      bulb.style.animationDelay = (-(i % 8) * 0.37).toFixed(2) + 's';
      host.appendChild(bulb);
    }
  }

  function updateFestiveChrome() {
    var countdown = q('#christmas-countdown');
    if (!countdown) return;
    var text = christmasCountdown();
    countdown.textContent = text;
    countdown.hidden = !text;
  }

  var SNOWFLAKE_SVGS = [
    '<path d="M32 4v56M7.8 18l48.4 28M7.8 46l48.4-28"/>' +
      '<path d="M32 14l-6-6M32 14l6-6M32 50l-6 6M32 50l6 6"/>' +
      '<path d="M15 22l-2-8M15 22l8-2M49 42l2 8M49 42l-8 2"/>' +
      '<path d="M49 22l2-8M49 22l-8-2M15 42l-2 8M15 42l8 2"/>',
    '<path d="M32 6v52M10 19l44 26M10 45l44-26"/>' +
      '<path d="M32 16l-5-5M32 16l5-5M32 48l-5 5M32 48l5 5"/>' +
      '<path d="M18 24l-7-1M18 24l-1-7M46 40l7 1M46 40l1 7"/>' +
      '<path d="M46 24l7-1M46 24l1-7M18 40l-7 1M18 40l-1 7"/>' +
      '<circle cx="32" cy="32" r="3" fill="currentColor" stroke="none"/>',
    '<path d="M32 4v56M4 32h56M12 12l40 40M52 12L12 52"/>' +
      '<path d="M32 12l-5-5M32 12l5-5M32 52l-5 5M32 52l5 5"/>' +
      '<circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/>'
  ];

  function snowflakeSvg(index) {
    return '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" ' +
      'stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
      SNOWFLAKE_SVGS[index % SNOWFLAKE_SVGS.length] + '</svg>';
  }

  function buildFestiveSnow() {
    var host = q('#festive-snow');
    if (!host || host.childElementCount) return;
    for (var i = 0; i < 36; i++) {
      var flake = document.createElement('span');
      var size = 3 + ((i * 7) % 5);
      flake.className = 'snowflake';
      flake.style.left = ((i * 37) % 100) + '%';
      flake.style.width = size + 'px';
      flake.style.height = size + 'px';
      flake.style.animationDuration = (13 + (i % 9) * 2.3).toFixed(1) + 's';
      flake.style.animationDelay = (-(i * 1.9)).toFixed(1) + 's';
      flake.style.opacity = (0.26 + ((i * 11) % 40) / 100).toFixed(2);
      host.appendChild(flake);
    }
    for (var j = 0; j < 9; j++) {
      var large = document.createElement('span');
      var largeSize = 17 + ((j * 13) % 24);
      large.className = 'snowflake snowflake-large';
      large.style.left = ((j * 29 + 9) % 94) + '%';
      large.style.width = largeSize + 'px';
      large.style.height = largeSize + 'px';
      large.style.animationDuration = (20 + (j % 7) * 2.9).toFixed(1) + 's';
      large.style.animationDelay = (-(j * 2.7)).toFixed(1) + 's';
      large.style.opacity = (0.28 + ((j * 7) % 24) / 100).toFixed(2);
      large.innerHTML = snowflakeSvg(j);
      host.appendChild(large);
    }
  }

  function applyFestiveMode(force, quiet) {
    var now = new Date();
    var key = now.toDateString() + '|' + festiveMode();
    if (!force && state.festiveKey === key) return festiveActive(now);
    state.festiveKey = key;
    var active = festiveActive(now);
    document.body.classList.toggle('festive', active);
    var layer = q('#festive-layer');
    if (layer) {
      layer.hidden = !active;
      if (active) {
        buildFestiveSnow();
        buildFairyLights();
      }
    }
    updateFestiveChrome();
    if (active && !quiet && state.screen === 'home') updateHomeChrome();
    return active;
  }

  function artModeAvailable() {
    var model = String((A.Platform.info && A.Platform.info.model) || cfg().model || '').toUpperCase();
    return /LS03/.test(model);
  }

  function openArtMode() {
    if (!artModeAvailable()) {
      A.UI.toast('Art Mode is not supported on this TV', 'error', 3200);
      return;
    }
    if (!A.Platform.caps.appLaunch) {
      A.UI.toast('Preview — Art Mode would open', 'ok', 3200);
      return;
    }
    A.UI.toast('Opening Art Mode', '', 1600);
    return A.Platform.hideLivePreview().then(function () {
      return A.Platform.launchArtMode();
    }).catch(function (err) {
      A.UI.toast('Could not open Art Mode: ' + err.message, 'error', 4500);
    });
  }

  function onModelReady() {
    if (state.screen === 'home') renderHome();
  }

  function renderHomeNotifications() {
    var button = q('#home-notify');
    if (!button) return false;
    var list = A.HA.configured && A.HA.notificationList ? A.HA.notificationList() : [];
    var count = list.length;
    if (!count) {
      if (state.homeRegion === 'notifications') state.homeRegion = 'tiles';
      return false;
    }
    var icon = q('#home-notify-icon');
    var badge = q('#home-notify-badge');
    if (icon && !icon.firstChild) icon.innerHTML = A.UI.icon('bell');
    if (badge) badge.textContent = count > 99 ? '99+' : String(count);
    return true;
  }

  function renderHome() {
    ensureAppCatalog();
    state.tiles = buildTiles();
    if (state.tileIndex >= state.tiles.length) state.tileIndex = 0;
    if (state.focusTileId) state.tileIndex = tileIndexById(state.focusTileId);
    var focusId = state.tiles[state.tileIndex] ? state.tiles[state.tileIndex].id : 'hdmi1';

    updateFestiveChrome();
    var notifyVisible = renderHomeNotifications();
    var button = q('#home-notify');
    if (button) button.hidden = !notifyVisible;
    if (!notifyVisible && state.homeRegion === 'notifications') state.homeRegion = 'tiles';

    var sensors = A.HA.sensors();
    if (state.homeRegion === 'sensors') {
      var sensorCount = sensorList().length;
      if (!sensorCount) state.homeRegion = 'tiles';
      else state.sensorIndex = U.clamp(state.sensorIndex, 0, sensorCount - 1);
    }

    var apps = appList();
    if (state.apps.open && !apps.length) state.apps.open = false;
    if (state.apps.open) {
      state.apps.index = U.clamp(state.apps.index, 0, Math.max(0, apps.length - 1));
      state.apps.focusId = apps[state.apps.index] ? apps[state.apps.index].id : '';
    }

    A.UI.renderHome({
      now: new Date(),
      subtitle: homeSubtitle(),
      tiles: state.tiles,
      sensors: sensors,
      sensorIndex: state.sensorIndex,
      status: statusModel(),
      weather: weatherModel(),
      calendar: state.calendar,
      focusId: focusId,
      greeting: festiveActive() && isChristmasDay() ? 'Merry Christmas' : '',
      festiveTag: festiveActive() ? festiveTag() : '',
      focusRegion: state.apps.open ? 'apps' : state.homeRegion,
      appsOpen: state.apps.open,
      apps: apps,
      appFocusId: state.apps.focusId,
      onTile: activateTile,
      onHover: function (id) {
        if (state.apps.open) return;
        state.tileIndex = tileIndexById(id);
        state.focusTileId = id;
        state.homeRegion = 'tiles';
      },
      onSensor: activateSensor,
      onSensorHover: function (index) {
        state.homeRegion = 'sensors';
        state.sensorIndex = index;
      },
      onApp: launchAppItem,
      onAppHover: function (id) {
        state.homeRegion = 'apps';
        state.apps.index = Math.max(0, apps.map(function (app) { return app.id; }).indexOf(id));
        state.apps.focusId = id;
      }
    });
  }

  function updateHomeChrome() {
    if (state.screen !== 'home') return;
    var sub = q('#home-sub');
    if (sub) sub.textContent = homeSubtitle();
    var title = q('#home-title');
    if (title) {
      title.textContent = festiveActive() && isChristmasDay()
        ? 'Merry Christmas'
        : A.UI.greeting(new Date());
    }
    updateFestiveChrome();
    var date = q('#home-date');
    if (date) {
      date.textContent = U.fmtDate(new Date()).toUpperCase() +
        (festiveActive() ? ' · ' + festiveTag() : '');
    }
    renderSensorsHome();
    A.UI.renderStatus(statusModel());
    A.UI.renderWeather(weatherModel());
    var notifyVisible = renderHomeNotifications();
    var notifyButton = q('#home-notify');
    if (notifyButton) notifyButton.hidden = !notifyVisible;
    if (!notifyVisible && state.homeRegion === 'notifications') {
      state.homeRegion = 'tiles';
    }
  }

  function sensorList() {
    var sensors = A.HA.sensors();
    var list = [];
    if (sensors.climate && sensors.climate.current != null) {
      list.push({ kind: 'climate', label: 'Temperature', entityId: sensors.climate.id, data: sensors.climate });
    }
    if (sensors.light) {
      list.push({ kind: 'light', label: 'Lights', entityId: sensors.light.id, data: sensors.light });
    }
    if (sensors.power) {
      list.push({ kind: 'power', label: 'Electricity Usage', entityId: sensors.power.id, data: sensors.power });
    }
    if (sensors.gas) {
      list.push({ kind: 'gas', label: 'Gas Usage', entityId: sensors.gas.id, data: sensors.gas });
    }
    return list;
  }

  function renderSensorsHome() {
    var list = sensorList();
    if (state.homeRegion === 'sensors') {
      if (!list.length) state.homeRegion = 'tiles';
      else state.sensorIndex = U.clamp(state.sensorIndex, 0, list.length - 1);
    }
    A.UI.renderSensors(A.HA.sensors(), {
      focus: state.homeRegion === 'sensors' ? state.sensorIndex : -1,
      onSensor: activateSensor,
      onHover: function (index) {
        state.homeRegion = 'sensors';
        state.sensorIndex = index;
      }
    });
  }

  function focusSensors() {
    if (!sensorList().length) return;
    state.homeRegion = 'sensors';
    state.sensorIndex = U.clamp(state.sensorIndex, 0, sensorList().length - 1);
    renderHome();
  }

  function moveSensor(delta) {
    var list = sensorList();
    if (!list.length) return;
    cancelSensorPress();
    state.sensorIndex = (state.sensorIndex + delta + list.length) % list.length;
    state.homeRegion = 'sensors';
    A.UI.renderSensors(A.HA.sensors(), {
      focus: state.sensorIndex,
      onSensor: activateSensor,
      onHover: function (index) { state.sensorIndex = index; }
    });
    A.UI.applySensorFocus(state.sensorIndex, true);
  }

  function cancelSensorPress() {
    if (state.sensorPress) {
      clearTimeout(state.sensorPress.timer);
      state.sensorPress = null;
    }
  }

  function beginSensorPress(index) {
    cancelSensorPress();
    var item = sensorList()[index];
    if (!item) return;
    var press = { index: index, long: false, timer: null };
    if (item.kind === 'climate' || item.kind === 'light') {
      press.timer = setTimeout(function () {
        if (state.sensorPress !== press) return;
        press.long = true;
        if (A.HANative && A.HANative.openDetailForEntity) {
          A.HANative.openDetailForEntity(item.entityId, 'home');
        }
      }, 650);
    }
    state.sensorPress = press;
  }

  function sensorKeyUp(code) {
    if (code !== 13 || !state.sensorPress) return false;
    var press = state.sensorPress;
    clearTimeout(press.timer);
    state.sensorPress = null;
    if (!press.long) activateSensor(press.index);
    return true;
  }

  function activateSensor(index) {
    var item = sensorList()[index];
    if (!item) return;
    if (item.kind === 'climate' || item.kind === 'light') {
      if (A.HANative && A.HANative.toggleEntity) A.HANative.toggleEntity(item.entityId);
      return;
    }
    openEnergyGraph(item);
  }

  function openEnergyGraph(item) {
    if (!A.HA.history) {
      A.UI.toast('Energy history is not available', 'error', 3000);
      return;
    }
    A.UI.toast('Loading 24-hour usage…', '', 1400);
    A.HA.history(item.entityId, 24).then(function (points) {
      if (!points.length) {
        A.UI.toast('No history available for ' + item.label, 'error', 3000);
        return;
      }
      var deviceClass = String((item.data && item.data.device_class) || '').toLowerCase();
      var cumulative = deviceClass === 'energy' || deviceClass === 'gas';
      var chart = points;
      if (cumulative && points.length > 1) {
        var deltas = [];
        for (var i = 1; i < points.length; i++) {
          var diff = points[i].v - points[i - 1].v;
          if (isFinite(diff) && diff >= 0) deltas.push({ t: points[i].t, v: diff });
        }
        if (deltas.length > 1) chart = deltas;
      }
      var latest = chart[chart.length - 1];
      var summaryValue;
      var summaryLabel;
      if (cumulative) {
        var total = chart.reduce(function (sum, point) { return sum + point.v; }, 0);
        summaryValue = (Math.round(total * 100) / 100) + ((item.data.unit ? ' ' + item.data.unit : ''));
        summaryLabel = 'Usage';
      } else {
        summaryValue = latest.v + ((item.data.unit ? ' ' + item.data.unit : ''));
        summaryLabel = 'Latest';
      }
      A.UI.energyGraph({
        title: item.label,
        subtitle: 'Last 24 hours',
        points: chart,
        unit: (item.data && item.data.unit) || '',
        summaryLabel: summaryLabel,
        summaryValue: summaryValue,
        color: item.kind === 'gas' ? '#fbbf24' : '#60a5fa'
      });
    }).catch(function (err) {
      A.UI.toast('Could not load ' + item.label + ': ' + err.message, 'error', 4500);
    });
  }

  function moveTile(delta) {
    if (!state.tiles.length) return;
    state.tileIndex = (state.tileIndex + delta + state.tiles.length) % state.tiles.length;
    state.focusTileId = state.tiles[state.tileIndex].id;
    A.UI.applyFocus(state.focusTileId, true);
    updateHomeChrome();
  }

  function moveApp(delta) {
    var apps = cfg().apps.items || [];
    if (!apps.length) return;
    state.apps.index = (state.apps.index + delta + apps.length) % apps.length;
    state.apps.focusId = apps[state.apps.index].id;
    state.homeRegion = 'apps';
    A.UI.applyFocus(state.apps.focusId, true, 'app');
  }

  function openAppsRow() {
    var apps = cfg().apps.items || [];
    if (!apps.length) return;
    state.apps.open = true;
    state.apps.index = 0;
    state.apps.focusId = apps[0].id;
    state.homeRegion = 'apps';
    renderHome();
  }

  function closeAppsRow() {
    if (!state.apps.open) return;
    state.apps.open = false;
    state.homeRegion = 'tiles';
    state.focusTileId = 'apps';
    state.tileIndex = tileIndexById('apps');
    renderHome();
  }

  function launchAppItem(id) {
    var apps = cfg().apps.items || [];
    var app = null;
    apps.forEach(function (item) { if (item.id === id) app = item; });
    if (!app) return;
    if (!A.Platform.caps.appLaunch) {
      A.UI.toast('Preview — ' + app.name + ' would open', 'ok', 3200);
      return;
    }
    A.UI.toast('Opening ' + app.name, '', 1600);
    return A.Platform.hideLivePreview().then(function () {
      return A.Platform.launchApp(app.id);
    }).catch(function (err) {
      A.UI.toast('Could not open ' + app.name + ': ' + err.message, 'error', 5000);
    });
  }

  function focusNotifications() {
    if (!notificationCount()) return;
    state.homeRegion = 'notifications';
    state.apps.open = false;
    renderHome();
  }

  function focusTiles() {
    state.homeRegion = 'tiles';
    renderHome();
  }

  function notificationLabel(item, index) {
    return item && item.title ? item.title : ('Notification ' + (index + 1));
  }

  function notificationTime(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    var today = new Date();
    if (date.toDateString() === today.toDateString()) return U.fmtTime(date);
    return U.fmtDateShort(date) + ' · ' + U.fmtTime(date);
  }

  function renderNotifications() {
    var list = A.HA.notificationList ? A.HA.notificationList() : [];
    var host = q('#notifications-list');
    var status = q('#notifications-status');
    if (status) {
      status.textContent = list.length + (list.length === 1 ? ' notification' : ' notifications');
    }
    if (!host) return;
    state.notifications.index = U.clamp(state.notifications.index, 0, Math.max(0, list.length));
    var html = list.map(function (item, index) {
      return '<button type="button" class="notification-item' +
        (index === state.notifications.index ? ' focused' : '') +
        '" data-notification-index="' + index + '">' +
        '<span class="notification-icon">' + A.UI.icon('bell') + '</span>' +
        '<span class="notification-main">' +
        '<span class="notification-title">' + U.esc(item.title || 'Notification') + '</span>' +
        '<span class="notification-message">' + U.esc(item.message || '') + '</span>' +
        '</span>' +
        '<span class="notification-time">' + U.esc(notificationTime(item.created_at)) + '</span>' +
        '</button>';
    }).join('');
    if (list.length) {
      html += '<button type="button" class="notification-item notification-all' +
        (state.notifications.index === list.length ? ' focused' : '') +
        '" data-notification-all="1">' +
        '<span class="notification-icon">' + A.UI.icon('close') + '</span>' +
        '<span class="notification-main"><span class="notification-title">Dismiss all notifications</span>' +
        '<span class="notification-message">Clear every notification from Home Assistant</span></span>' +
        '</button>';
    } else {
      html = '<div class="notifications-empty"><span class="ha-empty-title">No notifications</span>' +
        '<span class="ha-empty-sub">Home Assistant persistent notifications appear here.</span></div>';
    }
    host.innerHTML = html;
    var node = host.querySelector('.notification-item.focused');
    if (node) {
      try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {
        try { node.scrollIntoView(); } catch (err) { /* ignore */ }
      }
    }
  }

  function openNotifications() {
    var list = A.HA.notificationList ? A.HA.notificationList() : [];
    if (!list.length) return;
    state.screen = 'notifications';
    state.notifications.index = 0;
    A.UI.showScreen('notifications');
    renderNotifications();
    if (A.HA.refreshNotifications) A.HA.refreshNotifications().catch(function () { /* ignore */ });
  }

  function closeNotifications() {
    showHome();
    state.homeRegion = 'tiles';
    renderHome();
  }

  function dismissNotificationAt(index) {
    var list = A.HA.notificationList ? A.HA.notificationList() : [];
    if (index >= list.length) {
      if (!list.length) return;
      A.HA.dismissAllNotifications().then(function () {
        A.UI.toast('Notifications dismissed', 'ok', 1800);
        closeNotifications();
      }).catch(function (err) {
        A.UI.toast('Could not dismiss notifications: ' + err.message, 'error', 4500);
      });
      return;
    }
    var item = list[index];
    if (!item || !item.notification_id) return;
    A.HA.dismissNotification(item.notification_id).then(function () {
      if (!notificationCount()) {
        closeNotifications();
        return;
      }
      state.notifications.index = U.clamp(state.notifications.index, 0, notificationCount() - 1);
      renderNotifications();
    }).catch(function (err) {
      A.UI.toast('Could not dismiss notification: ' + err.message, 'error', 4500);
      renderNotifications();
    });
  }

  function notificationsKey(code) {
    var list = A.HA.notificationList ? A.HA.notificationList() : [];
    if (code === 10009 || code === 27) {
      closeNotifications();
      return true;
    }
    if (!list.length) {
      if (code === 13) closeNotifications();
      return true;
    }
    if (code === 40) {
      state.notifications.index = U.clamp(state.notifications.index + 1, 0, list.length);
      renderNotifications();
      return true;
    }
    if (code === 38) {
      state.notifications.index = U.clamp(state.notifications.index - 1, 0, list.length);
      renderNotifications();
      return true;
    }
    if (code === 13) {
      dismissNotificationAt(state.notifications.index);
      return true;
    }
    if (code === 406) {
      if (list.length) {
        A.HA.dismissAllNotifications().then(function () {
          A.UI.toast('Notifications dismissed', 'ok', 1800);
          closeNotifications();
        }).catch(function (err) {
          A.UI.toast('Could not dismiss notifications: ' + err.message, 'error', 4500);
        });
      }
      return true;
    }
    return false;
  }

  function isInputTile(id) {
    return id === 'livetv' || /^hdmi[1-4]$/.test(String(id));
  }

  function activateTile(id) {
    if (id === 'guide') return openGuide();
    if (id === 'apps') return openAppsRow();
    if (id === 'ha') return A.HANative.open();
    if (id === 'music') return A.HANative.openMusic();
    if (id === 'cameras') return A.HANative.openCameras();
    if (id === 'samsunghub') return openSamsungHub();
    if (id === 'artmode') return openArtMode();
    if (id === 'tvsettings') return openTvSettings();
    if (id === 'settings') return openSettings();
    if (isInputTile(id)) {
      // Confirm with SOURCE_INFO so a stale indicator cannot make the active
      // tile switch instead of closing the menu.
      return A.Platform.currentInput().catch(function () {
        return state.currentSource;
      }).then(function (actual) {
        if (actual) state.currentSource = actual;
        if (state.currentSource === id) {
          exitHome();
          return;
        }
        return activateSource(id, { background: true });
      });
    }
    return activateSource(id, { background: true });
  }

  function exitHome() {
    A.Platform.exitApp().then(function (ok) {
      if (ok) return;
      setInputBackdrop(false);
      A.UI.toast('Preview — Aurora would close and return to the previous input', '', 3200);
    }).catch(function (err) {
      setInputBackdrop(false);
      A.UI.toast('Could not close Aurora: ' + err.message, 'error', 4000);
    });
  }

  function showHome() {
    if (state.settings.importMode) disableTvImport(true);
    if (A.HANative) A.HANative.stopLive();
    state.screen = 'home';
    state.backgrounded = false;
    state.focusTileId = '';
    state.homeRegion = 'tiles';
    state.apps.open = false;
    state.apps.index = 0;
    state.apps.focusId = '';
    cancelSensorPress();
    state.sensorIndex = 0;
    applyFestiveMode(false, true);
    if (state.remote.pending) applyPendingRemote();
    A.UI.showScreen('home');
    renderHome();
    updateLivePreview();
    refreshCurrentSource();
    loadCalendarIfStale();
    loadWeatherIfStale();
  }

  /* ---------- source switching ---------- */

  function activateSource(id, options) {
    options = options || {};
    var background = options.background === true;
    var conf = cfg();
    var src = conf.sources[id];
    if (!src) return;
    var previousSource = state.lastExternal;
    state.lastExternal = id;
    state.previewSource = '';
    state.backgrounded = !background;
    conf.ui.lastExternal = id;
    try { A.Config.save(); } catch (e) { /* non fatal */ }
    if (!options.silent) A.UI.toast('Switching to ' + src.label, '', 1800);

    var switching;
    if (background) {
      switching = A.Platform.switchSource(id, { background: true });
    } else {
      switching = A.Platform.hideLivePreview().then(function () {
        return A.Platform.switchSource(id);
      });
    }

    return switching.then(function (result) {
      if (result.simulated) {
        state.backgrounded = false;
        state.previewSource = id;
        updateHomeChrome();
        updateLivePreview();
        A.UI.toast('Preview mode — ' + src.label + ' would open on the TV', 'ok', 4000);
      } else if (result.via === 'none') {
        state.backgrounded = false;
        state.lastExternal = previousSource;
        conf.ui.lastExternal = previousSource;
        try { A.Config.save(); } catch (e) { /* non fatal */ }
        updateHomeChrome();
        updateLivePreview();
        A.UI.toast('Could not switch to ' + src.label + '. Check the native input app IDs in Settings.', 'error', 6000);
      } else if (background) {
        state.backgrounded = !result.overlay;
        state.currentSource = id;
        state.sourceChangedAt = Date.now();
        renderHome();
        refreshChannel();
        if (!result.overlay) updateLivePreview();
      }
      return result;
    }).catch(function (err) {
      state.backgrounded = false;
      updateLivePreview();
      A.UI.toast('Could not switch input: ' + err.message, 'error', 5000);
    });
  }

  function channelFromHA() {
    // HA's media_title describes whatever is on the TV, including HDMI apps.
    // Only use it as a channel when Live TV is actually the current source.
    if (state.currentSource !== 'livetv') return null;
    if (!A.HA.canControlTv()) return null;
    var entity = A.HA.entity(cfg().ha.tvEntity);
    if (!entity) return null;
    var attrs = entity.attributes || {};
    var name = attrs.media_title || attrs.media_channel || '';
    if (!name) return null;
    return {
      number: attrs.media_channel || '',
      name: String(name),
      program: attrs.media_series_title || '',
      source: 'home_assistant'
    };
  }

  function refreshChannel() {
    A.Platform.getCurrentChannel().then(function (channel) {
      if (!channel && state.currentSource === 'livetv') channel = channelFromHA();
      var known = channelLabel(channel);
      // Keep the last tuned channel when the TV or HA cannot report one.
      if (!known && channelLabel(state.currentChannel)) return;
      var changed = JSON.stringify(channel) !== JSON.stringify(state.currentChannel);
      state.currentChannel = channel;
      if (!changed) return;
      if (state.screen === 'home') renderHome();
      updateHomeChrome();
    });
  }

  /* ---------- guide ---------- */

  function buildGuide() {
    var conf = cfg();
    var now = new Date();
    var halfHour = 30 * 60000;
    var start = Math.floor(now.getTime() / halfHour) * halfHour - halfHour;
    var end = start + conf.epg.horizonHours * 3600000;
    var channels = A.EPG.channels().slice(0, 30);
    var programs = {};
    channels.forEach(function (channel) {
      programs[channel.id] = A.EPG.range(channel.id, start, end);
    });

    var guide = {
      start: start,
      end: end,
      now: now,
      channels: channels,
      programs: programs,
      channelIndex: 0,
      programIndex: 0
    };

    // Prefer the channel we are currently watching, then the first programme on air.
    if (state.currentChannel) {
      var currentNumber = String(state.currentChannel.number || '').replace(/\.0+$/, '');
      var currentName = String(state.currentChannel.name || '').toLowerCase();
      channels.forEach(function (channel, index) {
        if (currentNumber && String(channel.number || '').replace(/\.0+$/, '') === currentNumber) {
          guide.channelIndex = index;
        } else if (currentName && String(channel.name).toLowerCase() === currentName) {
          guide.channelIndex = index;
        }
      });
    }
    var list = programs[channels[guide.channelIndex] ? channels[guide.channelIndex].id : ''] || [];
    var onNow = -1;
    list.forEach(function (program, index) {
      if (program.start <= now.getTime() && program.stop > now.getTime()) onNow = index;
    });
    guide.programIndex = onNow >= 0 ? onNow : 0;
    return guide;
  }

  function guideFocusProgram() {
    if (!state.guide) return null;
    var channel = state.guide.channels[state.guide.channelIndex];
    if (!channel) return null;
    var list = state.guide.programs[channel.id] || [];
    return { channel: channel, program: list[state.guide.programIndex] || null };
  }

  function focusGuideItem() {
    var focus = guideFocusProgram();
    if (!focus) return;
    if (focus.program) A.UI.setGuideFocus(focus.channel.id, focus.program.start);
  }

  function renderGuideScreen() {
    if (!state.guide) state.guide = buildGuide();
    var guide = state.guide;
    guide.now = new Date();
    var focus = guideFocusProgram();
    var detail = null;
    if (focus && focus.program) {
      detail = {
        channelName: focus.channel.name,
        time: U.fmtTime(focus.program.start) + ' – ' + U.fmtTime(focus.program.stop),
        title: focus.program.title,
        desc: focus.program.desc,
        canTune: true
      };
    }
    A.UI.renderGuide({
      now: guide.now,
      start: new Date(guide.start),
      end: new Date(guide.end),
      channels: guide.channels,
      programs: guide.programs,
      source: A.EPG.data().source,
      sourceLabel: A.EPG.data().source === 'demo' ? 'DEMO GUIDE' : 'XMLTV',
      windowLabel: U.fmtTime(guide.start) + ' – ' + U.fmtTime(guide.end),
      error: A.EPG.data().error,
      detail: detail,
      hint: 'Use the arrow keys to browse',
      onSelect: function (channelId, start) {
        var channel = A.EPG.channel(channelId);
        var program = A.EPG.programAt(channelId, start);
        watchProgram(channel, program);
      },
      onHover: function (channelId, start) {
        var channel = A.EPG.channel(channelId);
        var program = A.EPG.programAt(channelId, start);
        for (var i = 0; i < guide.channels.length; i++) {
          if (guide.channels[i].id === channelId) guide.channelIndex = i;
        }
        var list = guide.programs[channelId] || [];
        list.forEach(function (item, index) {
          if (item.start === start) guide.programIndex = index;
        });
        if (channel && program) {
          A.UI.renderGuideDetail({
            channelName: channel.name,
            time: U.fmtTime(program.start) + ' – ' + U.fmtTime(program.stop),
            title: program.title,
            desc: program.desc,
            canTune: true
          });
        }
      }
    });
    focusGuideItem();
  }

  function openGuide() {
    if (cfg().epg.nativeGuide) {
      openNativeGuide().catch(function (err) {
        A.UI.toast('Could not open the native TV Guide: ' + err.message, 'error', 4500);
        openXmltvGuide();
      });
      return;
    }
    openXmltvGuide();
  }

  function openNativeGuide() {
    var conf = cfg();
    var appId = String(conf.epg.nativeGuideAppId || (conf.livetv && conf.livetv.guideAppId) || '').trim();
    A.UI.toast('Opening TV Guide', '', 1600);
    function launch(id) {
      return A.Platform.hideLivePreview().then(function () {
        return A.Platform.launchApp(id);
      });
    }
    if (appId) {
      if (!A.Platform.caps.appLaunch) {
        A.UI.toast('Preview — native TV Guide (' + appId + ') would open', 'ok', 3200);
        return Promise.resolve(false);
      }
      return launch(appId);
    }
    if (!A.Platform.caps.appLaunch) {
      A.UI.toast('Preview — the native TV Guide app would open', 'ok', 3200);
      return Promise.resolve(false);
    }
    return A.Platform.listApps().then(function (apps) {
      var found = null;
      var preferred = [
        'com.samsung.tv.coba.epg',
        'org.tizen.epg',
        'com.samsung.tv.guide',
        'com.samsung.tv.tvguide',
        '111477000794'
      ];
      preferred.forEach(function (id) {
        if (found) return;
        apps.forEach(function (app) { if (app.id === id) found = app; });
      });
      if (!found) {
        apps.forEach(function (app) {
          if (found) return;
          var name = String(app.name || '').trim();
          if (/(^|[.\-_])epg($|[.\-_])/i.test(app.id) ||
              /^(tv|program(me)?) guide$/i.test(name)) {
            found = app;
          }
        });
      }
      if (found) return launch(found.id);
      // Some TVs hide the system guide from getAppsInfo; try the known IDs.
      function attempt(index) {
        if (index >= preferred.length) {
          throw new Error('No guide app found. Set its app ID in Settings.');
        }
        return launch(preferred[index]).catch(function () {
          return attempt(index + 1);
        });
      }
      return attempt(0);
    });
  }

  function openXmltvGuide() {
    state.screen = 'guide';
    state.guide = buildGuide();
    A.UI.showScreen('guide');
    renderGuideScreen();
    updateLivePreview();
    if (Date.now() - (A.EPG.data().updated || 0) > 5 * 60000) {
      loadEPG().then(function () {
        if (state.screen === 'guide') {
          state.guide = buildGuide();
          renderGuideScreen();
        }
      });
    }
  }

  function moveGuide(dx, dy) {
    if (!state.guide) return;
    var guide = state.guide;
    var channel = guide.channels[guide.channelIndex];
    var list = channel ? (guide.programs[channel.id] || []) : [];

    if (dx !== 0 && list.length) {
      guide.programIndex = U.clamp(guide.programIndex + dx, 0, list.length - 1);
      renderGuideScreen();
      return;
    }

    if (dy !== 0 && guide.channels.length) {
      var anchor = list[guide.programIndex] ? list[guide.programIndex].start : Date.now();
      guide.channelIndex = U.clamp(guide.channelIndex + dy, 0, guide.channels.length - 1);
      var nextChannel = guide.channels[guide.channelIndex];
      var nextList = guide.programs[nextChannel.id] || [];
      var found = 0;
      for (var i = 0; i < nextList.length; i++) {
        if (nextList[i].start <= anchor) found = i;
      }
      guide.programIndex = nextList.length ? found : 0;
      renderGuideScreen();
    }
  }

  function watchProgram(channel, program) {
    if (!channel) return;
    var live = cfg().sources.livetv;
    if (!live) return;
    if (!program) {
      A.UI.toast('No programme selected', '', 1600);
      return;
    }
    A.UI.toast('Tuning to ' + channel.name + ' · ' + program.title, '', 2200);
    var source = A.EPG.data().source;

    function revealLive() {
      return A.Platform.switchSource('livetv');
    }
    function tuneHA() {
      if (!A.HA.playChannel || !A.HA.canControlTv()) {
        return Promise.reject(new Error('Home Assistant TV control is not configured'));
      }
      A.UI.toast('Tuning via Home Assistant…', '', 1600);
      return A.HA.playChannel(channel.number).then(revealLive);
    }
    function tuneNative() {
      if (!A.Platform.caps.tvchannel) {
        return Promise.reject(new Error('Native tuning is not available'));
      }
      return A.Platform.tuneChannelNumber(channel.number).then(revealLive);
    }
    function openLiveInstead() {
      A.UI.toast('Could not tune to ' + channel.name + ' — opening Live TV', 'error', 4000);
      revealLive();
    }

    if (source === 'xmltv' && channel.number) {
      // Prefer Home Assistant when it is configured: the public certificate on
      // many retail TVs cannot use tizen.tvchannel.tune.
      if (A.HA.playChannel && A.HA.canControlTv()) {
        tuneHA().catch(tuneNative).catch(openLiveInstead);
      } else {
        tuneNative().catch(tuneHA).catch(openLiveInstead);
      }
    } else {
      if (source === 'demo') A.UI.toast('Demo guide — opening Live TV', '', 2500);
      revealLive();
    }
  }

  /* ---------- Home Assistant ---------- */

  function focusHAFrame() {
    var frame = q('#ha-frame');
    if (!frame) return;
    try { frame.focus(); } catch (e) { /* ignore */ }
    try {
      if (frame.contentWindow) frame.contentWindow.focus();
    } catch (e) { /* cross-origin focus is allowed, but ignore failures */ }
  }

  function setHADashboard(dashboardId, durationSeconds, returnTo) {
    var conf = cfg();
    if (!conf.ha.enabled || !conf.ha.baseUrl) {
      A.UI.toast('Configure Home Assistant in Settings first', 'error', 4200);
      return;
    }
    var dashboard = A.HA.dashboard(dashboardId);
    if (!dashboard) {
      A.UI.toast('Unknown dashboard "' + dashboardId + '"', 'error', 4000);
      return;
    }

    var previous = state.haTemp;
    var seconds = Math.min(3600, Math.max(0, Number(durationSeconds) || 0));
    var target = String(returnTo || '').trim();
    if (!target) target = state.lastExternal || 'home';
    if (target !== 'home' && !conf.sources[target]) {
      var resolved = resolveSource(target);
      target = resolved && conf.sources[resolved] ? resolved : 'home';
    }

    state.haDashboard = dashboard.id;
    if (seconds > 0) {
      state.haTemp = {
        id: dashboard.id,
        duration: seconds,
        endsAt: Date.now() + seconds * 1000,
        returnTo: target
      };
    } else {
      state.haTemp = null;
    }
    if (previous && previous.id === dashboard.id && seconds > 0) {
      // Keep a running countdown when the same dashboard is re-requested.
      state.haTemp.endsAt = Date.now() + seconds * 1000;
    }

    A.UI.showHA(A.HA.dashboardUrl(dashboard.id), dashboard.name);
    state.screen = 'ha';
    A.Platform.hideLivePreview();
    A.UI.setHACountdown(state.haTemp ? state.haTemp.endsAt - Date.now() : 0, !!state.haTemp);
    showHAOverlay();
    setTimeout(focusHAFrame, 350);
  }

  function showHAOverlay() {
    A.UI.setHAOverlay(true);
    clearTimeout(state.haOverlayTimer);
    state.haOverlayTimer = setTimeout(function () {
      if (state.screen === 'ha') A.UI.setHAOverlay(false);
    }, cfg().ui.overlayTimeoutMs);
  }

  function cycleDashboard(delta) {
    var dashboards = cfg().ha.dashboards;
    if (!dashboards.length) return;
    var index = 0;
    dashboards.forEach(function (dashboard, i) {
      if (dashboard.id === state.haDashboard) index = i;
    });
    index = (index + delta + dashboards.length) % dashboards.length;
    var dashboard = dashboards[index];
    state.haDashboard = dashboard.id;
    A.UI.showHA(A.HA.dashboardUrl(dashboard.id), dashboard.name);
    showHAOverlay();
    setTimeout(focusHAFrame, 350);
    A.UI.toast(dashboard.name, '', 1400);
  }

  function exitHA(reason) {
    var temp = state.haTemp;
    clearTimeout(state.haOverlayTimer);
    state.haTemp = null;
    state.haDashboard = '';
    state.screen = 'home';
    A.UI.setHACountdown(0, false);
    var frame = q('#ha-frame');
    if (frame) frame.setAttribute('src', 'about:blank');

    if (reason === 'timeout' && temp && temp.returnTo && temp.returnTo !== 'home') {
      A.UI.showScreen('home');
      A.UI.toast('Returning to ' + sourceName(temp.returnTo), '', 2000);
      if (temp.returnTo === 'livetv' && state.currentChannel && state.currentChannel.number) {
        A.Platform.tuneChannelNumber(state.currentChannel.number)
          .catch(function () { /* best effort */ })
          .then(function () { activateSource(temp.returnTo, { silent: true }); });
        return;
      }
      activateSource(temp.returnTo, { silent: true });
      return;
    }
    showHome();
  }

  /* ---------- one-time installed identity migration ---------- */

  var IDENTITY_KEY = 'aurora.identity.v1';
  var IDENTITY_MAP = {
    'QE50QN90CATXXU': { id: 'lounge', name: 'Lounge' },
    'QE32LS03CBUXXH': { id: 'conservatory', name: 'Conservatory' },
    'QE32LS03TCUXXH': { id: 'bedroom', name: 'Bedroom' },
    // Some firmware builds report the internal model code instead.
    '23_PTM_QTV_T09': { id: 'lounge', name: 'Lounge' },
    '23_KSUE_FTV_T09': { id: 'conservatory', name: 'Conservatory' },
    '20_KANTSU2_FHD_FRAME': { id: 'bedroom', name: 'Bedroom' }
  };
  var identityAttempts = 0;

  function migrateDeviceIdentity() {
    var done = false;
    try { done = !!localStorage.getItem(IDENTITY_KEY); } catch (e) { done = false; }
    if (done) return;
    var model = (A.Platform.info && A.Platform.info.model) || cfg().model || '';
    var target = IDENTITY_MAP[model];
    if (!target) {
      identityAttempts++;
      if (identityAttempts < 15) setTimeout(migrateDeviceIdentity, 1000);
      return;
    }
    var conf = cfg();
    if (conf.deviceId !== target.id || conf.deviceName !== target.name) {
      conf.deviceId = target.id;
      conf.deviceName = target.name;
      if (!conf.model) conf.model = model;
      var rc = conf.remoteConfig;
      if (rc && rc.url) {
        rc.url = String(rc.url)
          .replace(/\/living-room\b/g, '/' + target.id)
          .replace(/\/studio\b/g, '/' + target.id)
          .replace(/deviceId=living-room\b/g, 'deviceId=' + target.id)
          .replace(/deviceId=studio\b/g, 'deviceId=' + target.id);
      }
      try { A.Config.save(); } catch (e) { /* non fatal */ }
    }
    try { localStorage.setItem(IDENTITY_KEY, '1'); } catch (e) { /* ignore */ }
    updateHomeChrome();
    if (state.screen === 'settings') renderSettingsScreen();
  }

  /* ---------- first-run setup QR ---------- */

  var SETUP_SHOWN_KEY = 'aurora.setup.qr.shown';

  /* Accepts "192.168.1.2", "http://192.168.1.2:8099/" or a hostname and
     returns just the host part used in QR codes and URLs. */
  function bareHost(value) {
    var host = String(value || '').trim();
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
    if (host.charAt(0) !== '[') host = host.replace(/:\d+$/, '');
    return host;
  }

  function localHost() {
    return bareHost(cfg().localServer.host) || A.LocalServer.localIP() || A.Platform.localIP();
  }

  function openSetupQR(force) {
    var conf = cfg();
    if (!conf.localServer.enabled) {
      if (force) A.UI.toast('Enable the TV web server first', 'error', 3500);
      return Promise.resolve(false);
    }
    var token = ensureLocalToken(conf);
    var manualHost = bareHost(conf.localServer.host);
    var knownIp = manualHost || A.LocalServer.localIP();
    var ipPromise = knownIp ? Promise.resolve(knownIp) : A.Platform.localIPAsync(5000).then(function (ip) {
      return ip || A.LocalServer.localIP();
    });
    return ipPromise.then(function (ip) {
      if (!ip) {
        if (force) A.UI.toast('Could not determine the TV IP address', 'error', 4000);
        return false;
      }
      var url = 'http://' + ip + ':8099/?token=' + encodeURIComponent(token);
      setInputBackdrop(false);
      A.Platform.hideLivePreview();
      A.UI.showSetupQR({ url: url, token: token });
      return true;
    });
  }

  function dismissSetupQR() {
    if (!A.UI.setupOpen()) return;
    A.UI.hideSetupQR();
    var token = cfg().localServer.token || '';
    try { localStorage.setItem(SETUP_SHOWN_KEY, token || '1'); } catch (e) { /* ignore */ }
    updateLivePreview();
  }

  function setupAlreadyShown() {
    var shown = '';
    try { shown = localStorage.getItem(SETUP_SHOWN_KEY) || ''; } catch (e) { shown = ''; }
    if (!shown) return false;
    var token = cfg().localServer.token || '';
    if (!token) return false;
    // A new token (fresh install or reset config) means a new setup QR.
    return shown === token;
  }

  function maybeShowFirstRunSetup() {
    if (state.setupOverlayScheduled) return;
    if (setupAlreadyShown()) return;
    if (state.screen !== 'home' || A.UI.modalOpen() || A.UI.setupOpen()) {
      setTimeout(maybeShowFirstRunSetup, 2000);
      return;
    }
    state.setupOverlayScheduled = true;
    openSetupQR(false).then(function (shown) {
      if (shown) return;
      state.setupOverlayScheduled = false;
      state.setupAttempts = (state.setupAttempts || 0) + 1;
      if (state.setupAttempts >= 4) {
        A.UI.toast('Could not detect this TV\'s IP. Set it in Settings → On-TV web configuration.', '', 7000);
        return;
      }
      setTimeout(maybeShowFirstRunSetup, 3000);
    });
  }

  function liveSourceLabel(sourceId) {
    var sources = cfg().sources || {};
    if (sources[sourceId]) return sources[sourceId].label;
    if (sourceId.indexOf('hdmi') === 0) return 'HDMI ' + sourceId.slice(4);
    return 'Live TV';
  }

  function setLiveSourceLabel(sourceId) {
    var label = liveSourceLabel(sourceId);
    ['guide-live-source', 'guide-live-fallback-sub'].forEach(function (id) {
      var node = q('#' + id);
      if (node) node.textContent = label;
    });
  }

  function liveFrameRect() {
    if (state.screen !== 'guide') return null;
    var node = q('#guide-live-video');
    if (!node) return null;
    var rect = node.getBoundingClientRect();
    if (!rect || rect.width < 20 || rect.height < 20) return null;
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function setInputBackdrop(visible) {
    document.body.classList.toggle('input-backdrop', !!visible);
  }

  function updateLivePreview() {
    clearTimeout(state.liveTimer);
    var token = ++state.liveToken;
    if (state.screen === 'home') {
      if (state.backgrounded || A.UI.modalOpen() || A.UI.setupOpen()) {
        setInputBackdrop(false);
        A.Platform.hideLivePreview();
        return;
      }
      state.liveTimer = setTimeout(function () {
        if (token !== state.liveToken) return;
        A.Platform.showInputBackdrop().then(function (ok) {
          if (token !== state.liveToken) return;
          setInputBackdrop(ok);
        });
      }, 120);
      return;
    }
    setInputBackdrop(false);
    if (state.screen !== 'guide') {
      A.Platform.hideLivePreview();
      return;
    }
    if (state.backgrounded || A.UI.modalOpen() || A.UI.setupOpen()) {
      A.Platform.hideLivePreview();
      return;
    }
    state.liveTimer = setTimeout(function () {
      if (token !== state.liveToken) return;
      var rect = liveFrameRect();
      if (!rect) {
        A.Platform.hideLivePreview();
        return;
      }
      A.Platform.currentInput().then(function (actual) {
        if (token !== state.liveToken) return;
        var sourceId = actual || state.lastExternal || 'livetv';
        setLiveSourceLabel(sourceId);
        return A.Platform.showLivePreview(rect, sourceId);
      }).catch(function () {
        /* The styled placeholder remains visible. */
      });
    }, 180);
  }

  function refreshCurrentSource() {
    return A.Platform.currentInput().then(function (actual) {
      // SOURCE_INFO can be blank while an app owns the screen. Keep the last
      // known input rather than inventing one from the saved preference.
      if (!actual) return state.currentSource;
      // Source changes take a moment to settle. Keep the value we just set so
      // a stale SOURCE_INFO read cannot flip the indicator back.
      if (Date.now() - state.sourceChangedAt < 8000 && actual !== state.currentSource) {
        return state.currentSource;
      }
      if (actual === state.currentSource) return actual;
      state.currentSource = actual;
      if (state.screen === 'home') renderHome();
      if (actual === 'livetv') refreshChannel();
      return actual;
    }).catch(function () { return state.currentSource; });
  }

  function refreshHdmiSources() {
    refreshCurrentSource();
    return A.Platform.refreshVideoSources().then(function () {
      var ports = A.Platform.hdmiPorts();
      var key = ports == null ? 'unknown' : ports.join(',');
      if (key === state.hdmiPortsKey) return;
      state.hdmiPortsKey = key;
      if (state.screen === 'home') renderHome();
    }).catch(function () { /* detection is best effort */ });
  }

  function weatherModel() {
    var id = cfg().ha.weatherEntity;
    if (!id || !A.HA.configured) return { available: false, forecast: [] };
    var entity = A.HA.entity(id);
    var attrs = (entity && entity.attributes) || {};
    var temperature = attrs.temperature == null || attrs.temperature === '' ? null : Number(attrs.temperature);
    return {
      available: true,
      name: attrs.friendly_name || id,
      condition: entity ? entity.state : '',
      temperature: isFinite(temperature) ? temperature : null,
      unit: attrs.temperature_unit || '°C',
      forecast: state.weather.forecast || []
    };
  }

  function loadWeather(force) {
    var w = state.weather;
    var id = cfg().ha.weatherEntity;
    if (!A.HA.configured || !id) {
      w.forecast = [];
      w.loading = false;
      w.error = '';
      w.updated = 0;
      w.available = false;
      if (state.screen === 'home') A.UI.renderWeather(weatherModel());
      return;
    }
    w.available = true;
    if (w.loading && !force) return;
    w.loading = true;
    w.lastAttempt = Date.now();
    A.HA.weatherForecast(3).then(function (forecast) {
      w.loading = false;
      w.error = '';
      w.updated = Date.now();
      w.forecast = forecast || [];
      if (state.screen === 'home') A.UI.renderWeather(weatherModel());
    }).catch(function (err) {
      w.loading = false;
      w.error = err.message || 'Weather forecast unavailable';
      if (state.screen === 'home') A.UI.renderWeather(weatherModel());
    });
  }

  function loadWeatherIfStale() {
    var w = state.weather;
    var id = cfg().ha.weatherEntity;
    if (!A.HA.configured || !id) {
      if (w.available || w.forecast.length || w.error) {
        w.available = false;
        w.forecast = [];
        w.loading = false;
        w.error = '';
        w.updated = 0;
        if (state.screen === 'home') A.UI.renderWeather(weatherModel());
      }
      return;
    }
    w.available = true;
    if (w.updated && Date.now() - w.updated < 10 * 60000) return;
    if (w.loading) return;
    if (w.lastAttempt && Date.now() - w.lastAttempt < 60000) return;
    loadWeather();
  }

  function calendarWindow() {
    var now = new Date();
    return {
      now: now,
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3)
    };
  }

  function loadCalendar(force) {
    var c = state.calendar;
    if (!A.HA.configured) {
      c.events = [];
      c.loading = false;
      c.error = '';
      c.updated = 0;
      c.available = false;
      if (state.screen === 'home') renderHome();
      return;
    }
    if (!A.HA.calendars || !A.HA.calendars().length) {
      c.events = [];
      c.loading = false;
      c.error = '';
      c.available = false;
      if (state.screen === 'home') renderHome();
      return;
    }
    if (c.loading && !force) return;
    c.available = true;
    c.loading = true;
    c.lastAttempt = Date.now();
    var win = calendarWindow();
    A.HA.calendarEvents(win.start, win.end).then(function (events) {
      c.loading = false;
      c.error = '';
      c.updated = Date.now();
      c.events = (events || []).filter(function (event) {
        return event.end && event.end > win.now && event.start < win.end;
      });
      if (state.screen === 'home') renderHome();
    }).catch(function (err) {
      c.loading = false;
      c.error = err.message || 'Calendar unavailable';
      if (state.screen === 'home') renderHome();
    });
  }

  function loadCalendarIfStale() {
    var c = state.calendar;
    if (!A.HA.configured) {
      if (c.available || c.events.length || c.error) {
        c.available = false;
        c.events = [];
        c.loading = false;
        c.error = '';
        c.updated = 0;
        if (state.screen === 'home') renderHome();
      }
      return;
    }
    var calendars = A.HA.calendars ? A.HA.calendars() : [];
    if (!calendars.length) {
      if (c.available || c.events.length || c.error) {
        c.available = false;
        c.events = [];
        c.loading = false;
        c.error = '';
        c.updated = 0;
        if (state.screen === 'home') renderHome();
      }
      return;
    }
    c.available = true;
    if (c.updated && Date.now() - c.updated < 5 * 60000) return;
    if (c.loading) return;
    if (c.lastAttempt && Date.now() - c.lastAttempt < 60000) return;
    loadCalendar();
  }

  function openSamsungHub() {
    if (!A.Platform.caps.appLaunch) {
      A.UI.toast('Preview — Samsung Hub (com.samsung.tv.csfs) would open', 'ok', 4000);
      return;
    }
    A.UI.toast('Opening Samsung Hub', '', 1600);
    return A.Platform.hideLivePreview().then(function () {
      return A.Platform.launchApp('com.samsung.tv.csfs');
    }).catch(function (err) {
      A.UI.toast('Could not open Samsung Hub: ' + err.message, 'error', 5000);
    });
  }

  /* ---------- native TV settings ---------- */

  function openTvSettings() {
    A.UI.toast('Opening TV settings', '', 1600);
    return A.Platform.hideLivePreview().then(function () {
      return A.Platform.launchTvSettings();
    }).then(function (result) {
      if (result && result.simulated) {
        A.UI.toast('Preview — the TV settings app would open', 'ok', 3200);
      }
      return result;
    }).catch(function (err) {
      A.UI.toast('Could not open TV settings: ' + err.message, 'error', 5000);
      return false;
    });
  }

  /* ---------- Home Assistant entity picker ---------- */

  function pickerMatches(id, picker) {
    var domain = String(id).split('.')[0];
    if (picker.domain && domain !== picker.domain) return false;
    var entity = A.HA.entity(id);
    var attrs = (entity && entity.attributes) || {};
    if (picker.deviceClasses && picker.deviceClasses.length) {
      var deviceClass = String(attrs.device_class || '').toLowerCase();
      var unit = String(attrs.unit_of_measurement || '').toLowerCase();
      var byClass = picker.deviceClasses.indexOf(deviceClass) !== -1;
      var byUnit = picker.deviceClasses.indexOf('power') !== -1 &&
        ['w', 'kw', 'wh', 'kwh'].indexOf(unit) !== -1;
      if (!byClass && !byUnit) return false;
    }
    return true;
  }

  function buildPickerItems(picker) {
    var all = Object.keys(A.HA.states || {});
    var matches = all.filter(function (id) { return pickerMatches(id, picker); });
    if (!matches.length && picker.domain) {
      matches = all.filter(function (id) {
        return String(id).split('.')[0] === picker.domain;
      });
    }
    var items = [
      { id: '', name: 'Clear selection', state: '', special: 'clear' },
      { id: '__manual__', name: 'Type manually…', state: '', special: 'manual' }
    ];
    matches.sort(function (a, b) {
      var ea = A.HA.entity(a) || {};
      var eb = A.HA.entity(b) || {};
      var na = (ea.attributes && ea.attributes.friendly_name) || a;
      var nb = (eb.attributes && eb.attributes.friendly_name) || b;
      return na.localeCompare(nb);
    });
    matches.forEach(function (id) {
      var entity = A.HA.entity(id);
      var attrs = (entity && entity.attributes) || {};
      items.push({
        id: id,
        name: attrs.friendly_name || id,
        state: entity ? entity.state : 'unavailable'
      });
    });
    return items;
  }

  function openEntityPicker(row) {
    if (!state.settings.draft) return;
    var picker = row.picker || { domain: 'media_player' };
    var current = getPath(state.settings.draft, row.id) || '';
    var items = buildPickerItems(picker);
    var selected = 2;
    items.forEach(function (item, index) {
      if (item.id === current) selected = index;
    });
    if (items.length <= 2) selected = 1;
    state.picker = {
      path: row.id,
      label: row.label,
      title: 'Choose ' + (row.label || 'entity'),
      domain: picker.domain || '',
      deviceClasses: picker.deviceClasses || [],
      index: Math.min(selected, items.length - 1),
      items: items
    };
    state.screen = 'entity-picker';
    A.UI.showScreen('entity-picker');
    renderEntityPicker();
  }

  function pickerCurrent() {
    return state.settings.draft ? (getPath(state.settings.draft, state.picker.path) || '') : '';
  }

  function renderEntityPicker() {
    var title = q('#picker-title');
    if (title) title.textContent = state.picker.title || 'Choose entity';
    var status = q('#picker-status');
    if (status) {
      if (!A.HA.configured) status.textContent = 'Configure Home Assistant first';
      else if (!Object.keys(A.HA.states || {}).length) status.textContent = 'Home Assistant entities are still loading';
      else status.textContent = Math.max(0, state.picker.items.length - 2) + ' matching entities';
    }
    var host = q('#picker-list');
    var empty = q('#picker-empty');
    var current = pickerCurrent();
    if (empty) empty.hidden = true;
    if (!host) return;
    host.innerHTML = state.picker.items.map(function (item, index) {
      var cls = 'entity-picker-item' + (index === state.picker.index ? ' focused' : '') +
        (item.special ? ' special' : '');
      var isCurrent = item.id && item.id === current;
      return '<button type="button" class="' + cls + '" data-picker-item="' + index + '">' +
        '<span class="entity-picker-main"><span class="entity-picker-name">' + U.esc(item.name) + '</span>' +
        (item.id && !item.special ? '<span class="entity-picker-id">' + U.esc(item.id) + '</span>' : '') + '</span>' +
        (item.state ? '<span class="entity-picker-state">' + U.esc(item.state) + '</span>' : '') +
        (isCurrent ? '<span class="entity-picker-current">Current</span>' : '') +
        '</button>';
    }).join('');
    var node = host.querySelector('.entity-picker-item.focused');
    if (node) {
      try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {
        try { node.scrollIntoView(); } catch (err) { /* ignore */ }
      }
    }
  }

  function closeEntityPicker() {
    state.screen = 'settings';
    A.UI.showScreen('settings');
    renderSettingsScreen();
  }

  function selectPickerItem(item) {
    if (!item) return;
    var draft = state.settings.draft;
    if (!draft) return;
    if (item.special === 'clear') {
      setPath(draft, state.picker.path, '');
      state.settings.dirty = true;
      closeEntityPicker();
      A.UI.toast('Cleared ' + state.picker.label, '', 1800);
      return;
    }
    if (item.special === 'manual') {
      var current = pickerCurrent();
      A.UI.editor({
        title: state.picker.label,
        eyebrow: 'HOME ASSISTANT',
        label: 'Entity ID',
        value: current,
        placeholder: state.picker.domain + '.entity_name',
        returnScreen: 'settings',
        hint: 'Press OK to save, Back to cancel.'
      }).then(function (value) {
        if (value == null) return;
        setPath(draft, state.picker.path, String(value).trim());
        state.settings.dirty = true;
        closeEntityPicker();
      });
      return;
    }
    setPath(draft, state.picker.path, item.id);
    state.settings.dirty = true;
    closeEntityPicker();
    A.UI.toast('Selected ' + item.name, 'ok', 1800);
  }

  function entityPickerKey(code) {
    if (code === 10009 || code === 27) {
      closeEntityPicker();
      return true;
    }
    if (code === 38 || code === 40) {
      if (state.picker.items.length) {
        state.picker.index = U.clamp(state.picker.index + (code === 40 ? 1 : -1), 0, state.picker.items.length - 1);
        renderEntityPicker();
      }
      return true;
    }
    if (code === 13) {
      selectPickerItem(state.picker.items[state.picker.index]);
      return true;
    }
    return false;
  }

  /* ---------- apps picker ---------- */

  function appMatchesQuery(app, query) {
    if (!query) return true;
    return (String(app.name || '') + ' ' + String(app.id || '')).toLowerCase().indexOf(query) !== -1;
  }

  function visibleInstalledApps(apps) {
    return (apps || []).filter(function (app) {
      if (!app || !app.id || !app.name) return false;
      return app.show !== false;
    });
  }

  function buildAppPickerItems() {
    var draft = state.settings.draft;
    var configured = draft && draft.apps && Array.isArray(draft.apps.items) ? draft.apps.items : [];
    var installed = visibleInstalledApps(state.appPicker.installed);
    var installedById = {};
    installed.forEach(function (app) { installedById[app.id] = app; });
    var query = String(state.appPicker.query || '').trim();
    var needle = query.toLowerCase();
    var mode = state.appPicker.mode || 'apps';
    var items = [];
    var seen = {};

    items.push({
      id: '',
      special: 'search',
      name: query ? 'Search: ' + query : 'Search apps by name…',
      sub: query ? 'Press OK to change the search' : 'Filter installed apps by name or ID'
    });
    if (query) {
      items.push({ id: '', special: 'clear-search', name: 'Clear search', sub: 'Show all installed apps' });
    }

    if (mode === 'select') {
      var current = String(draft && draft.epg ? (draft.epg.nativeGuideAppId || '') : '');
      items.push({
        id: '',
        special: 'automatic',
        name: current ? 'Automatic (detect installed guide)' : 'Automatic (detected)',
        sub: current ? 'Clear the selected app and detect automatically' : 'Uses the TV’s installed EPG app',
        selected: !current
      });
      if (current && !installedById[current]) {
        var currentItem = {
          id: current,
          name: nativeGuideAppName(current),
          icon: '',
          selected: true,
          installed: false
        };
        if (appMatchesQuery(currentItem, needle)) items.push(currentItem);
      }
      installed.slice().sort(function (a, b) {
        return String(a.name || a.id).localeCompare(String(b.name || b.id));
      }).forEach(function (app) {
        var item = {
          id: app.id,
          name: app.name || app.id,
          icon: app.icon || '',
          selected: app.id === current,
          installed: true
        };
        if (appMatchesQuery(item, needle)) items.push(item);
      });
      return items;
    }

    configured.forEach(function (app) {
      if (!app || !app.id || seen[app.id]) return;
      seen[app.id] = true;
      var installedApp = installedById[app.id];
      var item = {
        id: app.id,
        name: app.name || (installedApp && installedApp.name) || app.id,
        icon: (installedApp && installedApp.icon) || '',
        enabled: true,
        installed: !!installedApp
      };
      if (appMatchesQuery(item, needle)) items.push(item);
    });

    installed.slice().sort(function (a, b) {
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    }).forEach(function (app) {
      if (seen[app.id]) return;
      seen[app.id] = true;
      var item = { id: app.id, name: app.name || app.id, icon: app.icon || '', enabled: false, installed: true };
      if (appMatchesQuery(item, needle)) items.push(item);
    });

    items.push({ id: '', special: 'manual', name: 'Add app ID manually…', sub: 'For apps that are not listed' });
    return items;
  }

  function appPickerFocus(id) {
    var items = state.appPicker.items;
    var index = 0;
    items.forEach(function (item, i) { if (item.id && item.id === id) index = i; });
    state.appPicker.index = U.clamp(index, 0, Math.max(0, items.length - 1));
    state.appPicker.selectedId = id || '';
  }

  function focusFirstAppPickerResult() {
    var items = state.appPicker.items;
    var index = 0;
    items.forEach(function (item, i) {
      if (!index && item.id) index = i;
    });
    state.appPicker.index = index;
  }

  function appPickerIcon(item) {
    if (item.special === 'search') {
      return '<span class="app-picker-icon special">' + A.UI.icon('search') + '</span>';
    }
    if (item.special === 'clear-search') {
      return '<span class="app-picker-icon special">' + A.UI.icon('close') + '</span>';
    }
    if (item.special === 'manual') {
      return '<span class="app-picker-icon special">' + A.UI.icon('apps') + '</span>';
    }
    if (item.special === 'automatic') {
      return '<span class="app-picker-icon special' + (item.selected ? ' selected' : '') + '">' +
        A.UI.icon('guide') + '<span class="app-picker-check">✓</span></span>';
    }
    var source = A.UI.iconUrl(item.icon);
    return '<span class="app-picker-icon' + (item.enabled ? ' enabled' : '') +
      (item.selected ? ' selected' : '') + '">' +
      '<span class="app-icon-glyph">' + A.UI.icon(appIcon(item)) + '</span>' +
      (source ? '<img class="app-icon-img" src="' + U.esc(source) + '" alt="">' : '') +
      '<span class="app-picker-check">✓</span>' +
      '</span>';
  }

  function renderAppPicker() {
    var picker = state.appPicker;
    var status = q('#app-picker-status');
    var host = q('#app-picker-list');
    var empty = q('#app-picker-empty');
    var draft = state.settings.draft || {};
    var configured = draft.apps && Array.isArray(draft.apps.items) ? draft.apps.items : [];
    var installed = visibleInstalledApps(picker.installed);
    var selectMode = picker.mode === 'select';
    var titleNode = q('#app-picker-title');
    if (titleNode) titleNode.textContent = picker.title || (selectMode ? 'Native guide app' : 'Apps menu');
    var reorderHint = q('#app-picker-reorder');
    if (reorderHint) reorderHint.hidden = selectMode;
    if (status) {
      if (picker.loading) status.textContent = 'Loading installed apps…';
      else if (picker.error) status.textContent = picker.error;
      else if (selectMode) {
        var currentId = draft.epg ? (draft.epg.nativeGuideAppId || '') : '';
        status.textContent = (currentId ? 'Selected: ' + nativeGuideAppName(currentId) : 'Automatic selection') +
          ' · ' + installed.length + ' installed' +
          (picker.query ? ' · “' + picker.query + '”' : '');
      } else {
        var count = configured.length;
        status.textContent = count + (count === 1 ? ' app enabled' : ' apps enabled') +
          ' · ' + installed.length + ' installed' +
          (picker.query ? ' · “' + picker.query + '”' : '');
      }
    }
    if (empty) empty.hidden = !(picker.error && !(picker.items || []).length);
    if (!host) return;
    if (!picker.items.length) {
      host.innerHTML = '';
      return;
    }
    picker.index = U.clamp(picker.index, 0, picker.items.length - 1);
    var html = picker.items.map(function (item, index) {
      var cls = 'entity-picker-item app-picker-item' +
        (index === picker.index ? ' focused' : '') +
        (item.enabled ? ' enabled' : '') +
        (item.selected ? ' selected' : '') +
        (item.special ? ' special' : '');
      var right = '';
      if (item.special === 'search') right = '<span class="app-picker-state">Search</span>';
      else if (item.special === 'clear-search') right = '<span class="app-picker-state">Clear</span>';
      else if (item.special === 'manual') right = '<span class="app-picker-state">Add</span>';
      else if (item.special === 'automatic') {
        right = '<span class="app-picker-state">' + (item.selected ? 'Selected' : 'Auto') + '</span>';
      } else if (selectMode) {
        right = '<span class="app-picker-state">' + (item.selected ? 'Selected' : 'Select') + '</span>';
      } else {
        right = '<span class="app-picker-state">' + (item.enabled ? 'On' : 'Off') + '</span>';
      }
      return '<button type="button" class="' + cls + '" data-app-index="' + index + '">' +
        appPickerIcon(item) +
        '<span class="entity-picker-main">' +
        '<span class="entity-picker-name">' + U.esc(item.name) + '</span>' +
        '<span class="entity-picker-id">' +
        (item.id ? U.esc(item.id) + (item.installed ? '' : ' · not installed') : U.esc(item.sub || '')) +
        '</span>' +
        '</span>' + right +
        '</button>';
    }).join('');
    var normal = picker.items.filter(function (item) { return item.id; }).length;
    if (!normal && picker.query) {
      html += '<div class="app-picker-no-results">No matching apps. Press the red key or choose Search to try again.</div>';
    }
    host.innerHTML = html;
    U.$$('#app-picker-list .app-icon-img').forEach(function (img) {
      img.onerror = function () { this.style.display = 'none'; };
    });
    var node = host.querySelector('.app-picker-item.focused');
    if (node) {
      try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {
        try { node.scrollIntoView(); } catch (err) { /* ignore */ }
      }
    }
  }

  function openAppPicker(options) {
    if (!state.settings.draft) return;
    options = options || {};
    var mode = options.mode === 'select' ? 'select' : 'apps';
    state.screen = 'app-picker';
    state.appPicker = {
      items: [],
      index: 0,
      loading: true,
      error: '',
      selectedId: '',
      query: '',
      installed: [],
      mode: mode,
      path: options.path || (mode === 'select' ? 'epg.nativeGuideAppId' : ''),
      title: options.title || ''
    };
    A.UI.showScreen('app-picker');
    renderAppPicker();
    A.Platform.listApps(true).then(function (apps) {
      if (state.screen !== 'app-picker') return;
      state.appPicker.installed = (apps || []).slice();
      state.appCatalog.items = (apps || []).slice();
      state.appCatalog.updated = Date.now();
      state.appPicker.loading = false;
      state.appPicker.items = buildAppPickerItems();
      if (mode === 'select') {
        var draft = state.settings.draft || {};
        var currentId = draft.epg ? (draft.epg.nativeGuideAppId || '') : '';
        if (currentId) {
          appPickerFocus(currentId);
        } else {
          var autoIndex = 0;
          state.appPicker.items.forEach(function (item, index) {
            if (item.special === 'automatic') autoIndex = index;
          });
          state.appPicker.index = autoIndex;
        }
      } else {
        appPickerFocus(state.appPicker.selectedId);
      }
      renderAppPicker();
    }).catch(function (err) {
      if (state.screen !== 'app-picker') return;
      state.appPicker.loading = false;
      state.appPicker.error = 'Could not list installed apps: ' + err.message;
      state.appPicker.items = buildAppPickerItems();
      renderAppPicker();
    });
  }

  function refreshAppPicker(focusId) {
    state.appPicker.items = buildAppPickerItems();
    appPickerFocus(focusId);
    renderAppPicker();
  }

  function closeAppPicker() {
    state.screen = 'settings';
    A.UI.showScreen('settings');
    renderSettingsScreen();
  }

  function toggleAppPickerItem(item) {
    if (!item || item.special || !item.id) return;
    var draft = state.settings.draft;
    if (!draft || !draft.apps) return;
    var list = draft.apps.items || [];
    var found = -1;
    list.forEach(function (app, index) { if (app.id === item.id) found = index; });
    if (found >= 0) list.splice(found, 1);
    else list.push({ id: item.id, name: item.name });
    draft.apps.items = list;
    state.settings.dirty = true;
    refreshAppPicker(item.id);
  }

  function moveAppPickerItem(item, delta) {
    if (!item || item.special || !item.enabled || !item.id) return;
    var draft = state.settings.draft;
    if (!draft || !draft.apps || !Array.isArray(draft.apps.items)) return;
    var list = draft.apps.items;
    var pos = -1;
    list.forEach(function (app, index) { if (app.id === item.id) pos = index; });
    var next = pos + delta;
    if (pos < 0 || next < 0 || next >= list.length) return;
    var swap = list[pos];
    list[pos] = list[next];
    list[next] = swap;
    state.settings.dirty = true;
    refreshAppPicker(item.id);
  }

  function addManualApp() {
    if (!state.settings.draft) return;
    A.UI.editor({
      title: 'Add app',
      eyebrow: 'APPS MENU',
      label: 'Tizen application ID',
      value: '',
      placeholder: 'e.g. 3201907018807',
      returnScreen: 'app-picker',
      hint: 'The app name is taken from the installed app list where possible. Press OK to save, Back to cancel.'
    }).then(function (value) {
      if (value == null) return;
      var id = String(value).trim();
      if (!id) return;
      var draft = state.settings.draft;
      if (!draft.apps) draft.apps = { items: [] };
      if (!Array.isArray(draft.apps.items)) draft.apps.items = [];
      var exists = draft.apps.items.some(function (app) { return app.id === id; });
      if (!exists) {
        var installed = state.appPicker.installed || [];
        var name = id;
        installed.forEach(function (app) { if (app.id === id) name = app.name || id; });
        draft.apps.items.push({ id: id, name: name });
        state.settings.dirty = true;
      }
      state.screen = 'app-picker';
      A.UI.showScreen('app-picker');
      state.appPicker.query = '';
      refreshAppPicker(id);
    });
  }

  function promptAppSearch() {
    A.UI.editor({
      title: 'Search apps',
      eyebrow: 'APPS MENU',
      label: 'App name or ID',
      value: state.appPicker.query || '',
      placeholder: 'e.g. Netflix',
      returnScreen: 'app-picker',
      hint: 'Leave blank and save to show every app. Press OK to save, Back to cancel.'
    }).then(function (value) {
      if (value == null) return;
      state.appPicker.query = String(value).trim();
      state.screen = 'app-picker';
      A.UI.showScreen('app-picker');
      state.appPicker.items = buildAppPickerItems();
      focusFirstAppPickerResult();
      renderAppPicker();
    });
  }

  function clearAppSearch() {
    state.appPicker.query = '';
    state.appPicker.items = buildAppPickerItems();
    focusFirstAppPickerResult();
    renderAppPicker();
  }

  function activateAppPickerItem() {
    var item = state.appPicker.items[state.appPicker.index];
    if (!item) return;
    if (item.special === 'search') {
      promptAppSearch();
      return;
    }
    if (item.special === 'clear-search') {
      clearAppSearch();
      return;
    }
    if (state.appPicker.mode === 'select') {
      var draft = state.settings.draft;
      var path = state.appPicker.path || 'epg.nativeGuideAppId';
      if (item.special === 'automatic') {
        setPath(draft, path, '');
        state.settings.dirty = true;
        closeAppPicker();
        A.UI.toast('Native guide app set to Automatic', 'ok', 2200);
        return;
      }
      if (item.id) {
        setPath(draft, path, item.id);
        state.settings.dirty = true;
        closeAppPicker();
        A.UI.toast('Selected ' + item.name, 'ok', 2200);
      }
      return;
    }
    if (item.special === 'manual') {
      addManualApp();
      return;
    }
    toggleAppPickerItem(item);
  }

  function appPickerKey(code) {
    if (code === 10009 || code === 27) {
      closeAppPicker();
      return true;
    }
    if (!state.appPicker.items.length) return true;
    if (code === 403) {
      promptAppSearch();
      return true;
    }
    if (code === 38) {
      state.appPicker.index = U.clamp(state.appPicker.index - 1, 0, state.appPicker.items.length - 1);
      renderAppPicker();
      return true;
    }
    if (code === 40) {
      state.appPicker.index = U.clamp(state.appPicker.index + 1, 0, state.appPicker.items.length - 1);
      renderAppPicker();
      return true;
    }
    if (code === 13) {
      activateAppPickerItem();
      return true;
    }
    if (code === 37 || code === 39) {
      if (state.appPicker.mode !== 'select') {
        moveAppPickerItem(state.appPicker.items[state.appPicker.index], code === 39 ? 1 : -1);
      }
      return true;
    }
    return false;
  }

  /* ---------- settings ---------- */

  function formatSyncTime(iso) {
    var date = new Date(iso);
    return isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
  }

  function buildSettings() {
    var draft = state.settings.draft;
    var rows = [];
    var actions = [];

    function add(section) { rows.push({ section: section }); }
    function row(id, label, hint, kind, value, extra) {
      var item = {
        id: id,
        label: label,
        hint: hint,
        kind: kind,
        value: value
      };
      if (extra) Object.keys(extra).forEach(function (key) { item[key] = extra[key]; });
      rows.push(item);
      actions.push(item);
    }

    add('Device');
    row('deviceName', 'Name', 'Shown in the header and remote config', 'text', draft.deviceName);
    row('deviceId', 'Device ID', 'Remote config identifier, e.g. conservatory', 'text', draft.deviceId);

    add('Appearance');
    var festiveLabels = { auto: 'Automatic', on: 'On', off: 'Off' };
    row('ui.festiveMode', 'Festive mode',
      'Automatic from 1 December to 6 January · choose On to preview',
      'cycle', festiveLabels[draft.ui.festiveMode] || 'Automatic',
      { cycleValues: ['auto', 'on', 'off'] });

    add('On-TV web configuration');
    var localStatus = A.LocalServer.status();
    var localIp = bareHost(draft.localServer.host) || A.LocalServer.localIP() || A.Platform.localIP() || '<TV-IP>';
    row('localServer.enabled', 'TV web server', 'Port 8099 · ' +
      (localStatus.ready ? 'running' : (localStatus.enabled ? (localStatus.error || 'starting') : 'stopped')),
      'toggle', !!draft.localServer.enabled);
    row('localServer.import', 'Import from TV',
      state.settings.importMode
        ? 'Enabled · ' + (localHost() ? 'http://' + localHost() + ':8099/api/config/local' : 'port 8099')
        : 'Temporarily open port 8099 without a token (5 min max). Ends when Settings closes.',
      'action', '', { actionLabel: state.settings.importMode ? 'Disable' : 'Enable' });
    row('localServer.host', 'TV IP address', 'Optional override if automatic detection fails', 'text',
      bareHost(draft.localServer.host) || 'Automatic');
    row('localServer.token', 'Web access token', 'Enter this in the browser when prompted', 'text',
      draft.localServer.token || 'Not set');
    row('localServerInfo', 'Open in a browser', 'http://' + localIp + ':8099', 'action', '',
      { actionLabel: 'Show' });
    row('setupQr', 'Setup QR code', 'Scan with a phone to open the config page', 'action', '',
      { actionLabel: 'Show' });

    add('Home Assistant');
    row('ha.enabled', 'Home Assistant', 'Entity dashboard, sensors and TV control', 'toggle', !!draft.ha.enabled);
    row('ha.baseUrl', 'URL', 'http://homeassistant.local:8123', 'text', draft.ha.baseUrl || 'Not set');
    row('ha.token', 'Long-lived token', 'Needed for REST, WebSocket, areas and service calls', 'secret', mask(draft.ha.token));
    row('ha.tvEntity', 'TV media_player entity', 'Choose the TV media_player from HA', 'entity',
      draft.ha.tvEntity || 'Not set', { picker: { domain: 'media_player' } });
    row('ha.musicEntity', 'Music media_player entity', 'Choose the music player from HA', 'entity',
      draft.ha.musicEntity || 'Not set', { picker: { domain: 'media_player' } });
    row('ha.lightEntity', 'Light entity', 'Choose a light from HA', 'entity',
      draft.ha.lightEntity || 'Not set', { picker: { domain: 'light' } });
    row('ha.climateEntity', 'Climate entity', 'Current temperature shown on the home sensor strip', 'entity',
      draft.ha.climateEntity || 'Not set', { picker: { domain: 'climate' } });
    row('ha.weatherEntity', 'Weather entity', 'Hourly forecast shown beside the clock', 'entity',
      draft.ha.weatherEntity || 'Not set', { picker: { domain: 'weather' } });
    row('ha.powerEntity', 'Electricity usage sensor', 'Power or energy sensor shown on the home strip', 'entity',
      draft.ha.powerEntity || 'Not set', { picker: { domain: 'sensor', deviceClasses: ['power', 'energy'] } });
    row('ha.gasEntity', 'Gas usage sensor', 'Gas meter or usage sensor shown beside electricity', 'entity',
      draft.ha.gasEntity || 'Not set', { picker: { domain: 'sensor', deviceClasses: ['gas', 'energy'] } });

    add('TV guide');
    row('epg.nativeGuide', 'Native TV Guide app', 'Use the TV’s built-in guide instead of the XMLTV grid', 'toggle',
      !!draft.epg.nativeGuide);
    row('epg.nativeGuideApp', 'Native guide app',
      draft.epg.nativeGuideAppId
        ? 'Selected: ' + nativeGuideAppName(draft.epg.nativeGuideAppId)
        : 'Automatic — detect the installed guide app',
      'action', '',
      { actionLabel: draft.epg.nativeGuideAppId ? 'Change' : 'Choose' });
    row('epg.xmltvUrl', 'XMLTV URL', 'CORS-enabled plain XMLTV (.xml)', 'text',
      draft.epg.xmltvUrl || 'Not set');
    row('epg.demo', 'Demo guide', 'Sample channels when no XMLTV is configured', 'toggle', !!draft.epg.demo);

    add('Apps menu');
    var appCount = draft.apps && draft.apps.items ? draft.apps.items.length : 0;
    row('apps.configure', 'Apps menu', appCount
      ? appCount + (appCount === 1 ? ' app selected · press to reorder' : ' apps selected · press to reorder')
      : 'Choose installed apps and their order', 'action', '',
      { actionLabel: appCount ? String(appCount) : 'Choose' });

    add('Live TV inputs');
    ['hdmi1', 'hdmi2', 'hdmi3', 'hdmi4'].forEach(function (id) {
      row('sources.' + id + '.appId', draft.sources[id].label + ' fallback app ID',
        'Optional. HDMI switching uses the native TVWindow API.',
        'text', draft.sources[id].appId || 'Automatic');
    });
    row('sources.livetv.appId', 'Live TV fallback app ID',
      'Used only if TVWindow is unavailable. Usually org.tizen.tv-viewer.',
      'text', draft.sources.livetv.appId || 'Not set');
    row('livetv.defaultChannel', 'Live TV default channel', 'Native tune before opening the TV app (optional)',
      'text', draft.livetv.defaultChannel || 'Not set');

    add('Remote configuration');
    row('remoteConfig.enabled', 'Web configuration', 'Poll a config server for settings', 'toggle',
      !!draft.remoteConfig.enabled);
    row('remoteConfig.url', 'Config URL', 'http://server:8090/api/config/conservatory', 'text',
      draft.remoteConfig.url || 'Not set');
    row('remoteConfig.token', 'Config token', 'Bearer token for the config server', 'secret',
      mask(draft.remoteConfig.token));
    row('remoteConfig.pollMinutes', 'Poll interval', 'Minutes between checks', 'text',
      String(draft.remoteConfig.pollMinutes) + ' min');
    var remoteState = remoteInfo();
    var remoteHint = !remoteState.enabled ? 'Remote config is disabled'
      : (remoteState.error ? ('Error: ' + remoteState.error)
        : (remoteState.pending ? 'Update waiting — close Settings to apply'
          : 'Last sync: ' + (remoteState.lastSync ? formatSyncTime(remoteState.lastSync) : 'never')));
    row('remoteSync', 'Sync now', remoteHint, 'action', '',
      { actionLabel: 'Sync' });

    add('Maintenance');
    row('save', 'Save changes', '', 'action', '', { actionLabel: 'Save', primary: true });
    row('reset', 'Reset to defaults', 'Also removes the saved token and Home Assistant credentials', 'action', '',
      { actionLabel: 'Reset', danger: true });
    row('diagnostics', 'Diagnostics', 'Capabilities, firmware and recent errors', 'action', '',
      { actionLabel: 'Open' });

    state.settings.rows = rows;
    state.settings.actions = actions;
    state.settings.index = U.clamp(state.settings.index, 0, actions.length - 1);
    return rows;
  }

  function renderSettingsScreen() {
    A.UI.renderSettings({
      rows: buildSettings(),
      focusIndex: state.settings.index,
      savedLabel: state.savedLabel,
      onActivate: activateSetting,
      onHover: function (index) { state.settings.index = index; }
    });
  }

  function openSettings() {
    ensureAppCatalog();
    state.screen = 'settings';
    state.settings.draft = A.Config.clone();
    state.settings.index = 0;
    state.settings.dirty = false;
    state.settings.importMode = false;
    state.savedLabel = '';
    A.UI.showScreen('settings');
    renderSettingsScreen();
    A.Platform.hideLivePreview();
  }

  function activateSetting(index) {
    var row = state.settings.actions[index];
    if (!row) return;
    var draft = state.settings.draft;

    if (row.kind === 'toggle') {
      setPath(draft, row.id, !getPath(draft, row.id));
      state.settings.dirty = true;
      renderSettingsScreen();
      return;
    }

    if (row.kind === 'cycle') {
      cycleSetting(index, 1);
      return;
    }

    if (row.kind === 'entity') {
      return openEntityPicker(row);
    }

    if (row.kind === 'action') {
      if (row.id === 'save') return saveSettings();
      if (row.id === 'reset') return resetSettings();
      if (row.id === 'diagnostics') return showDiagnostics();
      if (row.id === 'remoteSync') return syncRemoteConfig(true);
      if (row.id === 'localServerInfo') return showLocalServerInfo();
      if (row.id === 'setupQr') return openSetupQR(true);
      if (row.id === 'localServer.import') return toggleTvImport();
      if (row.id === 'apps.configure') return openAppPicker();
      if (row.id === 'epg.nativeGuideApp') {
        return openAppPicker({ mode: 'select', path: 'epg.nativeGuideAppId', title: 'Native guide app' });
      }
      return;
    }

    var current = getPath(draft, row.id);
    var numeric = row.id === 'remoteConfig.pollMinutes';
    var promptValue = current;
    if (row.id === 'remoteConfig.pollMinutes') promptValue = draft.remoteConfig.pollMinutes;
    var options = {
      title: row.label,
      label: row.hint || row.label,
      value: promptValue == null ? '' : String(promptValue),
      secret: row.kind === 'secret',
      numeric: numeric,
      placeholder: row.hint || '',
      hint: row.id === 'ha.token'
        ? 'Profile → Security → Long-lived access tokens.'
        : 'Press OK to save, Back to cancel.'
    };
    options.returnScreen = 'settings';
    A.UI.editor(options).then(function (value) {
      if (value == null) return;
      if (row.id === 'remoteConfig.pollMinutes') {
        var minutes = Number(value);
        if (!isFinite(minutes) || minutes < 1 || minutes > 1440) {
          A.UI.toast('Poll interval must be between 1 and 1440 minutes', 'error');
          return;
        }
        draft.remoteConfig.pollMinutes = Math.round(minutes);
      } else if (row.kind === 'secret') {
        setPath(draft, row.id, value);
      } else {
        setPath(draft, row.id, String(value).trim());
      }
      state.settings.dirty = true;
      renderSettingsScreen();
    });
  }

  function cycleSetting(index, delta) {
    var row = state.settings.actions[index];
    var draft = state.settings.draft;
    if (!row) return;
    if (Array.isArray(row.cycleValues) && row.cycleValues.length) {
      var current = String(getPath(draft, row.id) || row.cycleValues[0]);
      var pos = row.cycleValues.indexOf(current);
      if (pos < 0) pos = 0;
      var next = row.cycleValues[(pos + delta + row.cycleValues.length) % row.cycleValues.length];
      setPath(draft, row.id, next);
      state.settings.dirty = true;
      renderSettingsScreen();
      return;
    }
    if (!row.cycleId) return;
    var dashboards = draft.ha.dashboards || [];
    if (!dashboards.length) return;
    var currentDashboard = 0;
    dashboards.forEach(function (dashboard, i) {
      if (dashboard.id === draft.ha.defaultDashboard) currentDashboard = i;
    });
    currentDashboard = (currentDashboard + delta + dashboards.length) % dashboards.length;
    draft.ha.defaultDashboard = dashboards[currentDashboard].id;
    state.settings.dirty = true;
    renderSettingsScreen();
  }

  function parseDashboards(text) {
    return String(text || '').split(/[,\n;]/).map(function (part) {
      var bits = part.split('|').map(function (bit) { return bit.trim(); }).filter(function (bit) { return bit.length; });
      if (!bits.length) return null;
      var id = bits[0];
      if (!id) return null;
      var name = bits.length > 1 ? bits[1] : id;
      var path = bits.length > 2 ? bits[2] : '/' + id;
      if (!/^\//.test(path)) path = '/' + path;
      return { id: id, name: name || id, path: path };
    }).filter(Boolean);
  }

  function showLocalServerInfo() {
    var status = A.LocalServer.status();
    var ip = localHost();
    var url = 'http://' + (ip || '<this TV\'s IP>') + ':8099/';
    A.UI.infoPanel('On-TV web configuration', [
      ['Status', status.ready ? 'running' : (status.enabled ? (status.error || 'starting') : 'stopped')],
      ['Address', url],
      ['Revision', status.revision || '0'],
      ['How it works', 'The TV runs an embedded WebAssembly HTTP server on port 8099.'],
      ['Access token', cfg().localServer.token || '(not generated yet)'],
      ['Security', 'Use the access token when the browser asks. The server is only reachable on the LAN.'],
      ['Note', 'The server runs only while Aurora is in the foreground.']
    ]);
  }

  function resetSettingItem() {
    var row = state.settings.actions[state.settings.index];
    var draft = state.settings.draft;
    if (!row || !draft) return;
    var path = row.id;
    if (row.id === 'epg.nativeGuideApp') path = 'epg.nativeGuideAppId';
    else if (row.kind === 'action') {
      A.UI.toast('No default for this item', '', 2200);
      return;
    }
    var def = A.Config.defaultFor(path);
    if (def === undefined) {
      A.UI.toast('No default for this item', '', 2200);
      return;
    }
    var current = getPath(draft, path);
    if (JSON.stringify(current) === JSON.stringify(def)) {
      A.UI.toast('Already at the default', '', 2000);
      return;
    }
    setPath(draft, path, (def && typeof def === 'object') ? JSON.parse(JSON.stringify(def)) : def);
    state.settings.dirty = true;
    renderSettingsScreen();
    A.UI.toast('Reset ' + row.label + ' to default', 'ok', 2200);
  }

  function promptSettingsExit() {
    A.UI.confirmSave({
      title: 'Save changes?',
      message: 'You have unsaved settings. Save them before leaving, or discard your changes.',
      saveLabel: 'Save',
      discardLabel: 'Discard',
      cancelLabel: 'Cancel'
    }).then(function (choice) {
      if (choice === 'save') {
        saveSettings();
        return;
      }
      if (choice === 'discard') {
        state.settings.draft = null;
        state.settings.dirty = false;
        showHome();
      }
    });
  }

  function saveSettings() {
    var draft = state.settings.draft;
    if (draft.ha.enabled && draft.ha.baseUrl && !/^https?:\/\//i.test(draft.ha.baseUrl)) {
      A.UI.toast('Home Assistant URL must start with http:// or https://', 'error', 4200);
      return;
    }
    if (draft.remoteConfig.enabled && draft.remoteConfig.url &&
        !/^https?:\/\//i.test(draft.remoteConfig.url)) {
      A.UI.toast('Config URL must start with http:// or https://', 'error', 4200);
      return;
    }
    if (state.settings.importMode) disableTvImport(true);
    var live = A.Config.get();
    Object.keys(draft).forEach(function (key) { live[key] = draft[key]; });
    A.Config.save();
    state.lastExternal = live.ui.lastExternal || state.lastExternal;
    state.settings.dirty = false;
    applyConfig();
    A.UI.toast('Settings saved', 'ok');
    showHome();
    setTimeout(function () { syncRemoteConfig(false); }, 700);
  }

  function resetSettings() {
    A.UI.confirm({
      title: 'Reset everything?',
      message: 'This clears the saved Home Assistant token and all preferences, then reloads config.json if one is bundled.',
      okLabel: 'Reset',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      A.Config.reset().then(function () {
        state.settings.draft = A.Config.clone();
        state.settings.index = 0;
        state.settings.dirty = false;
        applyConfig();
        renderSettingsScreen();
        A.UI.toast('Settings reset', 'ok');
      });
    });
  }

  function showDiagnostics() {
    var diag = A.Platform.diagnostics();
    var conf = cfg();
    var lines = [
      ['Device', conf.deviceName + ' (' + conf.deviceId + ')'],
      ['Model', A.Platform.info.model || conf.model || 'Unknown'],
      ['Firmware', A.Platform.info.firmware || 'Unknown'],
      ['TV address', localHost() ? (localHost() + (A.Platform.info.ipSource ? ' · ' + A.Platform.info.ipSource : '')) : 'not detected'],
      ['Tizen app launch', diag.capabilities.appLaunch ? 'available' : 'unavailable'],
      ['Tizen TV channel API', diag.capabilities.tvchannel ? 'available' : 'unavailable (partner privilege)'],
      ['Tizen TVWindow input API', diag.capabilities.window ? 'available' : 'unavailable'],
      ['HDMI inputs', (function () {
        var ports = A.Platform.hdmiPorts();
        if (ports == null) return 'not detected — showing all configured inputs';
        if (!ports.length) return 'none connected';
        return ports.map(function (port) { return 'HDMI ' + port; }).join(', ');
      })()],
      ['Tizen TV input keys', diag.capabilities.tvinputdevice ? 'available' : 'unavailable'],
      ['B2B input API', diag.capabilities.b2b ? 'available' : 'not present'],
      ['Home Assistant', A.HA.connected ? 'connected' : (A.HA.error || 'not connected')],
      ['Art Mode', artModeAvailable() ? 'supported' : 'not supported'],
      ['Festive mode', festiveMode() + (festiveActive() ? ' · active' : ' · inactive')],
      ['Guide', A.EPG.summary().source + ' · ' + A.EPG.summary().channels + ' channels'],
      ['On-TV server', (function () {
        var s = A.LocalServer.status();
        return (s.ready ? 'running at ' + (localHost() || 'this TV') + ':8099' : (s.enabled ? (s.error || 'starting') : 'stopped'));
      })()],
      ['Remote config', (function () {
        var info = remoteInfo();
        if (!info.enabled) return 'disabled';
        return (info.error ? ('error: ' + info.error) : 'enabled') +
          ' · revision ' + (info.revision || '—') +
          ' · last sync ' + (info.lastSync || 'never');
      })()],
      ['CORS / frame errors', 'See README if HA or XMLTV do not load']
    ];
    (diag.errors || []).slice(-6).forEach(function (error, index) {
      lines.push(['Recent error ' + (index + 1), error]);
    });
    lines.push(['User agent', diag.userAgent]);

    A.Platform.listApps().then(function (apps) {
      var interesting = apps.filter(function (app) {
        return /hdmi|source|tuner|\btv\b/i.test(app.id + ' ' + app.name);
      }).slice(0, 12);
      interesting.forEach(function (app) {
        lines.push(['Input app', app.id + ' — ' + app.name]);
      });
      A.UI.infoPanel('Diagnostics', lines);
    });
  }

  function resolveSource(value) {
    var text = String(value == null ? '' : value).trim().toLowerCase();
    if (!text) return null;
    if (text === 'home' || text === 'launcher') return 'home';
    if (text === 'guide' || text === 'tvguide' || text === 'tv guide') return 'guide';
    if (text === 'ha' || text === 'home assistant' || text === 'homeassistant') return 'ha';
    if (text === 'tv' || text === 'live' || text === 'livetv' || text === 'live tv') return 'livetv';
    var conf = cfg();
    var found = null;
    Object.keys(conf.sources).forEach(function (id) {
      var source = conf.sources[id];
      if (text === id || text === String(source.label).toLowerCase() ||
          text === String(source.haSource || '').toLowerCase()) {
        found = id;
      }
    });
    return found;
  }

  /* ---------- wiring ---------- */

  function onKeyDown(event) {
    var code = event.keyCode;
    if (A.UI.setupOpen()) {
      event.preventDefault();
      event.stopPropagation();
      dismissSetupQR();
      return;
    }
    if (A.UI.modalOpen()) return;

    if (state.screen === 'editor' && A.UI.editorKey(code)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (state.screen === 'entity-picker' && entityPickerKey(code)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (A.HANative && A.HANative.handleKey(code)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Hardware Guide key on Samsung remotes.
    if (code === 458 && state.screen !== 'guide') {
      event.preventDefault();
      event.stopPropagation();
      openGuide();
      return;
    }

    var handled = false;

    if (state.screen === 'home') {
      if (state.homeRegion === 'sensors') {
        if (code === 37) { moveSensor(-1); handled = true; }
        else if (code === 39) { moveSensor(1); handled = true; }
        else if (code === 38 || code === 10009 || code === 27) {
          cancelSensorPress();
          focusTiles();
          handled = true;
        } else if (code === 13) {
          if (!state.sensorPress) beginSensorPress(state.sensorIndex);
          handled = true;
        } else {
          handled = true;
        }
      } else if (state.homeRegion === 'notifications') {
        if (code === 40) { focusTiles(); handled = true; }
        else if (code === 13) { openNotifications(); handled = true; }
        else if (code === 10009 || code === 27) { focusTiles(); handled = true; }
        else handled = true;
      } else if (state.apps.open) {
        if (code === 37) { moveApp(-1); handled = true; }
        else if (code === 39) { moveApp(1); handled = true; }
        else if (code === 13) {
          var appId = cfg().apps.items[state.apps.index] ? cfg().apps.items[state.apps.index].id : '';
          if (appId) launchAppItem(appId);
          handled = true;
        } else if (code === 38 || code === 40 || code === 10009 || code === 27) {
          closeAppsRow();
          handled = true;
        }
      } else {
        if (code === 37) { moveTile(-1); handled = true; }
        else if (code === 39) { moveTile(1); handled = true; }
        else if (code === 13) {
          var tile = state.tiles[state.tileIndex];
          if (tile) activateTile(tile.id);
          handled = true;
        } else if (code === 38) {
          if (notificationCount()) focusNotifications();
          handled = true;
        } else if (code === 40) {
          if (sensorList().length) focusSensors();
          handled = true;
        } else if (code === 10009 || code === 27) {
          exitHome();
          handled = true;
        }
      }
    } else if (state.screen === 'notifications') {
      if (notificationsKey(code)) handled = true;
    } else if (state.screen === 'app-picker') {
      if (appPickerKey(code)) handled = true;
    } else if (state.screen === 'guide') {
      if (code === 37) { moveGuide(-1, 0); handled = true; }
      else if (code === 39) { moveGuide(1, 0); handled = true; }
      else if (code === 38) { moveGuide(0, -1); handled = true; }
      else if (code === 40) { moveGuide(0, 1); handled = true; }
      else if (code === 13) {
        var focus = guideFocusProgram();
        if (focus) watchProgram(focus.channel, focus.program);
        handled = true;
      } else if (code === 10009 || code === 27) {
        showHome();
        handled = true;
      }
    } else if (state.screen === 'settings') {
      if (code === 38) {
        state.settings.index = U.clamp(state.settings.index - 1, 0, state.settings.actions.length - 1);
        renderSettingsScreen();
        handled = true;
      } else if (code === 40) {
        state.settings.index = U.clamp(state.settings.index + 1, 0, state.settings.actions.length - 1);
        renderSettingsScreen();
        handled = true;
      } else if (code === 37 || code === 39) {
        var row = state.settings.actions[state.settings.index];
        if (row && (row.kind === 'toggle' || row.kind === 'cycle')) {
          if (row.kind === 'toggle') {
            setPath(state.settings.draft, row.id, !getPath(state.settings.draft, row.id));
            state.settings.dirty = true;
          } else {
            cycleSetting(state.settings.index, code === 39 ? 1 : -1);
          }
          renderSettingsScreen();
        }
        handled = true;
      } else if (code === 13) {
        activateSetting(state.settings.index);
        handled = true;
      } else if (code === 406) {
        resetSettingItem();
        handled = true;
      } else if (code === 10009 || code === 27) {
        if (state.settings.dirty) {
          promptSettingsExit();
        } else {
          state.settings.draft = null;
          showHome();
        }
        handled = true;
      }
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function loadEPG() {
    return A.EPG.load(cfg()).then(function () {
      if (state.screen === 'home') renderHome();
      updateHomeChrome();
      if (state.screen === 'guide') {
        state.guide = buildGuide();
        renderGuideScreen();
      }
    });
  }

  function scheduleEPGReload() {
    clearInterval(state.epgTimer);
    var minutes = cfg().epg.refreshMinutes;
    state.epgTimer = setInterval(function () {
      loadEPG();
    }, Math.max(5, minutes) * 60000);
  }

  function handleLocalConfig(remote) {
    if (!remote) return;
    var busy = state.screen === 'settings' || state.screen === 'editor' ||
      state.screen === 'entity-picker' || A.UI.modalOpen();
    if (busy) {
      state.remote.pending = { remote: remote, revision: 'local' };
      state.remote.pendingRevision = 'local';
      A.UI.toast('Config update ready — leave Settings to apply', '', 3200);
      return;
    }
    applyRemoteConfig(remote, 'local', false);
  }

  function ensureLocalToken(conf) {
    if (!conf.localServer.enabled) return conf.localServer.token || '';
    if (conf.localServer.token) return conf.localServer.token;
    var bytes = new Uint8Array(8);
    var token = '';
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(bytes);
        token = Array.prototype.map.call(bytes, function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      }
    } catch (e) { /* fall through */ }
    if (!token) token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    conf.localServer.token = token;
    try { A.Config.save(); } catch (e) { /* non fatal */ }
    return token;
  }

  function localServerHandlers() {
    return {
      onConfig: handleLocalConfig,
      onStatus: function (status) {
        state.localServerStatus = status;
        if (state.screen === 'home') updateHomeChrome();
      }
    };
  }

  function configureLocalServer(conf, options) {
    options = options || {};
    if (state.settings.importMode && !options.force) return;
    var local = conf.localServer || { enabled: true };
    var token = Object.prototype.hasOwnProperty.call(options, 'token')
      ? options.token
      : ensureLocalToken(conf);
    var enabled = Object.prototype.hasOwnProperty.call(options, 'enabled')
      ? options.enabled
      : !!local.enabled;
    A.LocalServer.configure(enabled, localServerHandlers(), token);
  }

  function enableTvImport() {
    state.settings.importMode = true;
    configureLocalServer(cfg(), { force: true, enabled: true, token: '' });
    A.LocalServer.push(A.Config.get());
    clearTimeout(state.settings.importTimer);
    state.settings.importTimer = setTimeout(function () {
      if (!state.settings.importMode) return;
      disableTvImport(true);
      if (state.screen === 'settings') renderSettingsScreen();
      A.UI.toast('TV import mode timed out', '', 3000);
    }, 5 * 60 * 1000);
    renderSettingsScreen();
    var ip = localHost() || A.LocalServer.localIP();
    A.UI.toast(ip ? 'Import enabled for ' + ip + ':8099' : 'Import enabled on port 8099', 'ok', 5000);
    setTimeout(function () {
      if (state.screen === 'settings' && state.settings.importMode) renderSettingsScreen();
    }, 1200);
  }

  function disableTvImport(quiet) {
    clearTimeout(state.settings.importTimer);
    state.settings.importTimer = null;
    state.settings.importMode = false;
    configureLocalServer(cfg(), { force: true });
    if (!quiet) {
      A.UI.toast('TV import mode disabled', '', 2200);
      if (state.screen === 'settings') renderSettingsScreen();
    }
  }

  function toggleTvImport() {
    if (state.settings.importMode) disableTvImport();
    else enableTvImport();
  }

  function applyConfig(options) {
    options = options || {};
    var conf = cfg();
    state.lastExternal = conf.ui.lastExternal || 'livetv';
    var haKey = [conf.ha.baseUrl, conf.ha.token, conf.ha.climateEntity, conf.ha.weatherEntity].join('|');
    if (state.haKey !== haKey) {
      state.haKey = haKey;
      state.weather.updated = 0;
      state.calendar.updated = 0;
    }
    A.HA.configure(conf.ha);
    applyFestiveMode(true, true);
    scheduleEPGReload();
    scheduleRemoteSync();
    // The embedded WASM configuration server is the heaviest startup task.
    // Start it after the first frame so the home screen appears immediately.
    if (options.deferLocalServer) {
      setTimeout(function () { configureLocalServer(cfg()); }, 2500);
    } else {
      configureLocalServer(conf);
    }
    loadEPG();
    refreshChannel();
    updateHomeChrome();
    setTimeout(loadCalendarIfStale, 2000);
    setTimeout(loadWeatherIfStale, 2000);
  }

  function startClock() {
    clearInterval(state.tickTimer);
    state.tickTimer = setInterval(function () {
      var now = new Date();
      A.UI.updateClock(now);
      if (now.getSeconds() === 0) applyFestiveMode(false);
      if (state.screen === 'home' && now.getSeconds() === 0) updateHomeChrome();
      if (state.screen === 'music' && A.HANative) A.HANative.tickMusic();
      if (state.haTemp) {
        var remaining = state.haTemp.endsAt - Date.now();
        A.UI.setHACountdown(Math.max(0, remaining), true);
        if (remaining <= 0) exitHA('timeout');
      }
    }, 1000);
  }

  function bindUI() {
    var setupClose = q('#setup-close');
    if (setupClose) {
      setupClose.addEventListener('click', dismissSetupQR);
    }
    document.addEventListener('keydown', onKeyDown);
    var notifyButton = q('#home-notify');
    if (notifyButton) {
      notifyButton.addEventListener('click', function () {
        if (state.screen === 'home') openNotifications();
      });
    }
    document.addEventListener('keyup', function (event) {
      if (sensorKeyUp(event.keyCode)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (A.HANative && A.HANative.handleKeyUp && A.HANative.handleKeyUp(event.keyCode)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (state.settings.importMode) disableTvImport(true);
        setInputBackdrop(false);
        A.Platform.hideLivePreview();
        return;
      }
      state.backgrounded = false;
      refreshChannel();
      refreshHdmiSources();
      updateLivePreview();
      loadCalendarIfStale();
      loadWeatherIfStale();
      if (state.screen === 'home') updateHomeChrome();
      if (state.haTemp) A.UI.setHACountdown(state.haTemp.endsAt - Date.now(), true);
      var rc = cfg().remoteConfig || {};
      if (rc.enabled && rc.url &&
          Date.now() - state.remote.lastAttempt > (rc.pollMinutes || 5) * 60000) {
        syncRemoteConfig(false);
      }
    });
  }

  function boot() {
    A.Config.init().then(function () {
      state.lastExternal = cfg().ui.lastExternal || 'livetv';
      A.Platform.init();
      bindUI();

      A.Config.onChange(function () {
        var conf = cfg();
        if (conf.localServer && conf.localServer.enabled) {
          A.LocalServer.push(A.Config.get());
        }
        if (A.HANative) A.HANative.onConfigChange();
      });

      A.HA.on('state', function (entityId) {
        if (state.screen !== 'home') return;
        var tv = cfg().ha.tvEntity;
        if (!tv || entityId !== tv) return;
        clearTimeout(state.sourceRenderTimer);
        state.sourceRenderTimer = setTimeout(function () {
          if (state.screen === 'home') renderHome();
        }, 250);
      });

      A.HA.on('notifications', function () {
        if (state.screen === 'home') renderHome();
        else if (state.screen === 'notifications') renderNotifications();
      });

      A.HA.on('change', function () {
        A.UI.renderStatus(statusModel());
        if (state.screen === 'home') {
          renderSensorsHome();
          A.UI.renderWeather(weatherModel());
          var sub = q('#home-sub');
          if (sub) sub.textContent = homeSubtitle();
        }
        refreshChannelSoon();
        loadCalendarIfStale();
        loadWeatherIfStale();
        if (A.HANative) A.HANative.onHAChange();
      });

      // Paint the home screen from the saved profile before touching the
      // network, HDMI probing or the embedded server. Everything else starts
      // on the next task so the first frame is not blocked.
      showHome();
      startClock();
      setTimeout(function () {
        applyConfig({ deferLocalServer: true });
        refreshHdmiSources();
        setTimeout(refreshHdmiSources, 1500);
      }, 0);

      state.sourcesTimer = setInterval(refreshHdmiSources, 30000);
      state.channelTimer = setInterval(refreshChannel, 60000);
      state.calendarTimer = setInterval(loadCalendarIfStale, 15 * 60000);
      setTimeout(loadCalendarIfStale, 2500);
      state.weatherTimer = setInterval(loadWeatherIfStale, 15 * 60000);
      setTimeout(loadWeatherIfStale, 2500);

      setTimeout(function () {
        var conf = cfg();
        if (!conf.model && A.Platform.info.model) {
          conf.model = A.Platform.info.model;
          A.Config.save();
        }
        migrateDeviceIdentity();
      }, 400);

      setTimeout(function () {
        syncRemoteConfig(false);
      }, 1200);

      setTimeout(function () {
        maybeShowFirstRunSetup();
      }, 2200);

      setTimeout(function () {
        if (!cfg().ha.enabled && state.screen === 'home') {
          A.UI.toast('Welcome to Aurora. Open Settings to connect Home Assistant and the guide.', '', 6000);
        }
      }, 2200);
    }).catch(function (err) {
      if (A.UI && A.UI.toast) {
        A.UI.toast('Aurora could not start: ' + (err && err.message ? err.message : err), 'error', 8000);
      }
      if (window.console) console.error('[aurora] boot failed', err);
    });
  }

  A.App = {
    boot: boot,
    state: state,
    showHome: showHome,
    onModelReady: onModelReady,
    openGuide: openGuide,
    openSettings: openSettings,
    activateSource: activateSource,
    syncRemote: syncRemoteConfig,
    remoteInfo: remoteInfo
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.Aurora = window.Aurora || {});
