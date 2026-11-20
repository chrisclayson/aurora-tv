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
    lastExternal: 'livetv',
    currentSource: '',
    sourceChangedAt: 0,
    previewSource: '',
    backgrounded: false,
    currentChannel: null,
    channelTimer: null,
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
      dirty: false
    },
    savedLabel: '',
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
      id: 'tvsettings',
      kind: 'TV',
      label: 'TV Settings',
      sub: 'Picture, sound, network',
      icon: 'sliders',
      accent: 'teal'
    });

    return tiles;
  }

  function renderHome() {
    state.tiles = buildTiles();
    if (state.tileIndex >= state.tiles.length) state.tileIndex = 0;
    if (state.focusTileId) state.tileIndex = tileIndexById(state.focusTileId);
    var focusId = state.tiles[state.tileIndex] ? state.tiles[state.tileIndex].id : 'hdmi1';

    A.UI.renderHome({
      now: new Date(),
      subtitle: homeSubtitle(),
      tiles: state.tiles,
      sensors: A.HA.sensors(),
      status: statusModel(),
      focusId: focusId,
      onTile: activateTile,
      onHover: function (id) {
        state.tileIndex = tileIndexById(id);
        state.focusTileId = id;
      }
    });
    A.UI.applyFocus(focusId);
  }

  function updateHomeChrome() {
    if (state.screen !== 'home') return;
    var sub = q('#home-sub');
    if (sub) sub.textContent = homeSubtitle();
    var title = q('#home-title');
    if (title) title.textContent = A.UI.greeting(new Date());
    var date = q('#home-date');
    if (date) date.textContent = U.fmtDate(new Date()).toUpperCase();
    A.UI.renderSensors(A.HA.sensors());
    A.UI.renderStatus(statusModel());
  }

  function moveTile(delta) {
    if (!state.tiles.length) return;
    state.tileIndex = (state.tileIndex + delta + state.tiles.length) % state.tiles.length;
    state.focusTileId = state.tiles[state.tileIndex].id;
    A.UI.applyFocus(state.focusTileId, true);
    updateHomeChrome();
  }

  function isInputTile(id) {
    return id === 'livetv' || /^hdmi[1-4]$/.test(String(id));
  }

  function activateTile(id) {
    if (id === 'guide') return openGuide();
    if (id === 'ha') return A.HANative.open();
    if (id === 'music') return A.HANative.openMusic();
    if (id === 'cameras') return A.HANative.openCameras();
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
    if (A.HANative) A.HANative.stopLive();
    state.screen = 'home';
    state.backgrounded = false;
    state.focusTileId = '';
    if (state.remote.pending) applyPendingRemote();
    A.UI.showScreen('home');
    renderHome();
    updateLivePreview();
    refreshCurrentSource();
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
    if (state.currentChannel && state.currentChannel.name) {
      channels.forEach(function (channel, index) {
        if (String(channel.name).toLowerCase() === String(state.currentChannel.name).toLowerCase()) {
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
    if (source === 'xmltv' && A.Platform.caps.tvchannel) {
      A.Platform.tuneChannelNumber(channel.number).then(function () {
        return A.Platform.switchSource('livetv');
      }).catch(function () {
        A.UI.toast('Tuning is not permitted on this TV — opening Live TV', 'error', 3500);
        A.Platform.switchSource('livetv');
      });
    } else {
      if (source === 'demo') A.UI.toast('Demo guide — opening Live TV', '', 2500);
      A.Platform.switchSource('livetv');
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

    add('On-TV web configuration');
    var localStatus = A.LocalServer.status();
    var localIp = bareHost(draft.localServer.host) || A.LocalServer.localIP() || A.Platform.localIP() || '<TV-IP>';
    row('localServer.enabled', 'TV web server', 'Port 8099 · ' +
      (localStatus.ready ? 'running' : (localStatus.enabled ? (localStatus.error || 'starting') : 'stopped')),
      'toggle', !!draft.localServer.enabled);
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
    row('ha.powerEntity', 'Power sensor entity', 'Choose a power or energy sensor from HA', 'entity',
      draft.ha.powerEntity || 'Not set', { picker: { domain: 'sensor', deviceClasses: ['power', 'energy'] } });

    add('TV guide');
    row('epg.xmltvUrl', 'XMLTV URL', 'CORS-enabled plain XMLTV (.xml)', 'text',
      draft.epg.xmltvUrl || 'Not set');
    row('epg.demo', 'Demo guide', 'Sample channels when no XMLTV is configured', 'toggle', !!draft.epg.demo);

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
    state.screen = 'settings';
    state.settings.draft = A.Config.clone();
    state.settings.index = 0;
    state.settings.dirty = false;
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
    if (!row || !row.cycleId) return;
    var dashboards = draft.ha.dashboards || [];
    if (!dashboards.length) return;
    var current = 0;
    dashboards.forEach(function (dashboard, i) {
      if (dashboard.id === draft.ha.defaultDashboard) current = i;
    });
    current = (current + delta + dashboards.length) % dashboards.length;
    draft.ha.defaultDashboard = dashboards[current].id;
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
      if (code === 37) { moveTile(-1); handled = true; }
      else if (code === 39) { moveTile(1); handled = true; }
      else if (code === 13) {
        var tile = state.tiles[state.tileIndex];
        if (tile) activateTile(tile.id);
        handled = true;
      } else if (code === 38 || code === 40) {
        handled = true; // single rail: absorb to keep the UI still
      } else if (code === 10009 || code === 27) {
        exitHome();
        handled = true;
      }
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
      } else if (code === 10009 || code === 27) {
        if (state.settings.dirty) {
          A.UI.toast('Unsaved changes discarded', '', 2200);
        }
        state.settings.draft = null;
        showHome();
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

  function configureLocalServer(conf) {
    var local = conf.localServer || { enabled: true };
    var token = ensureLocalToken(conf);
    A.LocalServer.configure(!!local.enabled, {
      onConfig: handleLocalConfig,
      onStatus: function (status) {
        state.localServerStatus = status;
        if (state.screen === 'home') updateHomeChrome();
      }
    }, token);
  }

  function applyConfig(options) {
    options = options || {};
    var conf = cfg();
    state.lastExternal = conf.ui.lastExternal || 'livetv';
    A.HA.configure(conf.ha);
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
  }

  function startClock() {
    clearInterval(state.tickTimer);
    state.tickTimer = setInterval(function () {
      var now = new Date();
      A.UI.updateClock(now);
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
    var settingsButton = q('#btn-settings');
    if (settingsButton) {
      settingsButton.addEventListener('click', openSettings);
    }
    var setupClose = q('#setup-close');
    if (setupClose) {
      setupClose.addEventListener('click', dismissSetupQR);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        setInputBackdrop(false);
        A.Platform.hideLivePreview();
        return;
      }
      state.backgrounded = false;
      refreshChannel();
      refreshHdmiSources();
      updateLivePreview();
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

      A.HA.on('change', function () {
        A.UI.renderStatus(statusModel());
        if (state.screen === 'home') {
          A.UI.renderSensors(A.HA.sensors());
          var sub = q('#home-sub');
          if (sub) sub.textContent = homeSubtitle();
        }
        refreshChannelSoon();
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
