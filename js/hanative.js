/* Aurora — native Home Assistant screens, entity browser, pages and cameras. */
(function (A) {
  'use strict';

  var U = A.Util;

  var state = {
    pageId: '',
    tabs: [],
    tabIndex: 0,
    focus: 'grid',
    widgetIndex: 0,
    columns: 4,
    updateTimer: null,
    browser: {
      pane: 'areas',
      areaIndex: 0,
      entityIndex: 0,
      areaId: '',
      areas: [],
      areaEntities: {},
      counts: {},
      registry: null,
      deviceArea: null,
      fallback: false,
      cacheKey: '',
      loading: false,
      error: '',
      loaded: false,
      loadedAt: 0
    },
    pages: {
      index: 0
    },
    cameras: {
      list: [],
      index: 0,
      columns: 3
    },
    music: {
      focus: 1,
      browse: {
        stack: [],
        items: [],
        index: 0,
        title: 'Music Assistant',
        contentType: '',
        contentId: '',
        loading: false,
        error: ''
      }
    },
    live: {
      index: -1,
      entityId: ''
    },
    detail: {
      entityId: '',
      index: 0,
      controls: [],
      values: {},
      clearTimer: null,
      returnScreen: 'ha',
      ignoreOkUntil: 0
    },
    press: null
  };

  function q(sel) { return document.querySelector(sel); }
  function esc(value) { return U.esc(value); }
  function cfg() { return A.Config.get(); }
  function haCfg() { return (cfg() && cfg().ha) || {}; }

  function showScreen(name) {
    A.UI.showScreen(name);
    if (A.App && A.App.state) A.App.state.screen = name;
    if (name !== 'home' && name !== 'guide' && A.Platform && A.Platform.hideLivePreview) {
      A.Platform.hideLivePreview();
    }
  }

  function saveConfig() {
    try { A.Config.save(); } catch (e) { /* non fatal */ }
  }

  function pages() {
    var conf = cfg();
    if (!conf.ha) conf.ha = {};
    if (!Array.isArray(conf.ha.pages) || !conf.ha.pages.length) {
      conf.ha.pages = [{ id: 'home', name: 'Home', widgets: [] }];
    }
    return conf.ha.pages;
  }

  function pageById(id) {
    var list = pages();
    var found = null;
    list.forEach(function (page) { if (page.id === id) found = page; });
    return found;
  }

  function currentPage() {
    var conf = cfg();
    var list = pages();
    var page = pageById(state.pageId || (conf.ha && conf.ha.currentPage)) || list[0];
    state.pageId = page.id;
    if (conf.ha) conf.ha.currentPage = page.id;
    return page;
  }

  function setPage(id) {
    var page = pageById(id);
    if (!page) return;
    state.pageId = page.id;
    state.focus = page.widgets.length ? 'grid' : 'tabs';
    state.widgetIndex = 0;
    state.tabIndex = pages().indexOf(page);
    cfg().ha.currentPage = page.id;
    saveConfig();
    render();
  }

  function cyclePage(delta) {
    var list = pages();
    if (!list.length) return;
    var index = 0;
    list.forEach(function (page, i) { if (page.id === state.pageId) index = i; });
    index = (index + delta + list.length) % list.length;
    setPage(list[index].id);
  }

  function domainOf(entityId) { return String(entityId).split('.')[0]; }
  function domainName(domain) {
    return domain.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function entity(id) { return A.HA.entity(id); }

  function entityName(id, ent) {
    var attrs = (ent && ent.attributes) || {};
    return attrs.friendly_name || id;
  }

  function isOnState(value) {
    return ['on', 'open', 'opening', 'playing', 'heat', 'cool', 'auto', 'home', 'cleaning', 'unlocked', 'active'].indexOf(String(value)) !== -1;
  }

  function stateText(ent, id) {
    if (!ent) return 'Unavailable';
    var attrs = ent.attributes || {};
    var value = String(ent.state == null ? 'unknown' : ent.state);
    if (value === 'unavailable' || value === 'unknown') return value.charAt(0).toUpperCase() + value.slice(1);
    if (domainOf(id) === 'light' && value === 'on' && attrs.brightness != null) {
      return 'On · ' + Math.round(Number(attrs.brightness) / 2.55) + '%';
    }
    if (domainOf(id) === 'climate' && attrs.current_temperature != null) {
      return String(attrs.current_temperature) + '°';
    }
    if (attrs.unit_of_measurement) return value + ' ' + attrs.unit_of_measurement;
    if (value === 'on' || value === 'off') return value.charAt(0).toUpperCase() + value.slice(1);
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function iconFor(domain) {
    var map = {
      light: 'bulb',
      switch: 'bolt',
      input_boolean: 'bolt',
      fan: 'bolt',
      sensor: 'motion',
      binary_sensor: 'motion',
      climate: 'wifi',
      cover: 'chevron',
      media_player: 'play',
      scene: 'dashboard',
      script: 'play',
      button: 'play',
      lock: 'lock',
      vacuum: 'bolt',
      number: 'sliders',
      input_number: 'sliders',
      select: 'sliders',
      input_select: 'sliders',
      camera: 'camera'
    };
    return map[domain] || 'info';
  }

  function updateConnection() {
    var label = 'Connecting';
    var cls = '';
    if (!A.HA.configured) {
      label = 'Not configured';
      cls = 'error';
    } else if (A.HA.connected) {
      label = 'Connected';
      cls = 'ok';
    } else if (A.HA.restOk) {
      label = 'REST';
      cls = 'ok';
    } else if (A.HA.error) {
      label = A.HA.error;
      cls = 'error';
    }
    var node = q('#ha-conn');
    if (node) {
      node.className = 'ha-conn ' + cls;
      var text = q('#ha-conn-label');
      if (text) text.textContent = label;
    }
    var camNode = q('#camera-conn');
    if (camNode) {
      camNode.className = 'ha-conn ' + cls;
      var camText = q('#camera-conn-label');
      if (camText) camText.textContent = label;
    }
    var musicNode = q('#music-conn');
    if (musicNode) {
      musicNode.className = 'ha-conn ' + cls;
      var musicText = q('#music-conn-label');
      if (musicText) musicText.textContent = label;
    }
    var detailNode = q('#ha-detail-conn');
    if (detailNode) {
      detailNode.className = 'ha-conn ' + cls;
      var detailText = q('#ha-detail-conn-label');
      if (detailText) detailText.textContent = label;
    }
  }

  function ensureFocus() {
    state.columns = window.innerWidth < 1500 ? 3 : 4;
    var page = currentPage();
    state.tabs = pages().map(function (item) {
      return { kind: 'page', id: item.id, label: item.name };
    }).concat([
      { kind: 'add', id: 'add', label: '＋ Add entities' },
      { kind: 'pages', id: 'pages', label: 'Pages' }
    ]);
    if (state.tabIndex >= state.tabs.length) state.tabIndex = 0;
    if (state.focus === 'grid' && (!page.widgets.length || state.widgetIndex >= page.widgets.length)) {
      state.focus = 'tabs';
    }
    if (state.focus === 'tabs' && state.tabIndex >= state.tabs.length) state.tabIndex = 0;
    if (state.focus === 'grid' && state.widgetIndex < 0) state.widgetIndex = 0;
  }

  function renderTabs() {
    var host = q('#ha-tabs');
    if (!host) return;
    var current = currentPage().id;
    host.innerHTML = state.tabs.map(function (tab, index) {
      var classes = 'ha-tab';
      if (tab.kind === 'page' && tab.id === current) classes += ' active';
      if (tab.kind !== 'page') classes += ' action';
      if (state.focus === 'tabs' && index === state.tabIndex) classes += ' focused';
      return '<button type="button" class="' + classes + '" data-tab="' + index + '" role="tab">' +
        esc(tab.label) + '</button>';
    }).join('');
  }

  function widgetModel(widget) {
    var id = widget.entity;
    var ent = entity(id);
    var domain = domainOf(id);
    return {
      id: id,
      name: entityName(id, ent),
      domain: domain,
      state: ent ? ent.state : 'unavailable',
      text: stateText(ent, id),
      on: !!(ent && isOnState(ent.state)),
      icon: iconFor(domain)
    };
  }

  function renderGrid() {
    var grid = q('#ha-grid');
    if (!grid) return;
    var page = currentPage();
    var widgets = page.widgets || [];
    var empty = q('#ha-empty');
    if (empty) empty.hidden = widgets.length > 0;
    if (!widgets.length) {
      grid.innerHTML = '';
      return;
    }
    grid.innerHTML = widgets.map(function (widget, index) {
      var item = widgetModel(widget);
      var classes = 'ha-widget' + (item.on ? ' on' : '') +
        (state.focus === 'grid' && state.widgetIndex === index ? ' focused' : '');
      return '<button type="button" class="' + classes + '" data-widget="' + index + '" role="listitem">' +
        '<span class="ha-widget-top"><span class="ha-widget-icon">' + A.UI.icon(item.icon) + '</span>' +
        '<span class="ha-widget-state">' + esc(item.text) + '</span></span>' +
        '<span class="ha-widget-name">' + esc(item.name) + '</span>' +
        '<span class="ha-widget-entity">' + esc(item.id) + '</span>' +
        '</button>';
    }).join('');
  }

  function applyFocus() {
    var screen = A.App && A.App.state ? A.App.state.screen : '';
    if (screen !== 'ha') return;
    var node = null;
    if (state.focus === 'tabs') {
      node = q('#ha-tabs [data-tab="' + state.tabIndex + '"]');
    } else {
      node = q('#ha-grid [data-widget="' + state.widgetIndex + '"]');
    }
    if (!node) return;
    try { node.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' }); } catch (e) {
      try { node.scrollIntoView(); } catch (err) { /* ignore */ }
    }
  }

  function render() {
    ensureFocus();
    var page = currentPage();
    var title = q('#ha-title');
    if (title) title.textContent = page.name || 'Home Assistant';
    updateConnection();
    renderTabs();
    renderGrid();
    applyFocus();
  }

  function scheduleRender() {
    clearTimeout(state.updateTimer);
    state.updateTimer = setTimeout(function () {
      var screen = A.App && A.App.state ? A.App.state.screen : '';
      if (screen === 'ha') render();
      else if (screen === 'cameras') renderCameras();
      else if (screen === 'music') renderMusic();
    }, 250);
  }

  function open() {
    currentPage();
    state.focus = currentPage().widgets.length ? 'grid' : 'tabs';
    state.tabIndex = pages().indexOf(currentPage());
    if (state.tabIndex < 0) state.tabIndex = 0;
    setPageScreen();
  }

  function setPageScreen() {
    showScreen('ha');
    render();
  }

  function activateTab(index) {
    var tab = state.tabs[index];
    if (!tab) return;
    if (tab.kind === 'page') {
      setPage(tab.id);
      return;
    }
    if (tab.kind === 'add') {
      openBrowser();
      return;
    }
    if (tab.kind === 'pages') openPages();
  }

  function infoForEntity(id) {
    var ent = entity(id);
    var attrs = (ent && ent.attributes) || {};
    var lines = [
      ['Entity', id],
      ['State', ent ? ent.state : 'unavailable']
    ];
    Object.keys(attrs).slice(0, 12).forEach(function (key) {
      var value = attrs[key];
      if (value == null) return;
      if (typeof value === 'object') value = JSON.stringify(value);
      lines.push([key.replace(/_/g, ' '), String(value)]);
    });
    A.UI.infoPanel(entityName(id, ent), lines);
  }

  function activateWidget(index) {
    var page = currentPage();
    var widget = page.widgets[index];
    if (!widget) return;
    var id = widget.entity;
    var domain = domainOf(id);
    var ent = entity(id);
    if (!ent) {
      A.UI.toast('Entity is not available in Home Assistant', 'error', 3500);
      return;
    }
    if (['sensor', 'binary_sensor', 'weather', 'sun', 'select', 'input_select', 'number', 'input_number'].indexOf(domain) !== -1) {
      infoForEntity(id);
      return;
    }
    var targetDomain = domain;
    var service = 'toggle';
    if (domain === 'button') service = 'press';
    else if (domain === 'scene' || domain === 'script') { targetDomain = domain; service = 'turn_on'; }
    else if (domain === 'lock') service = ent.state === 'locked' ? 'unlock' : 'lock';
    else if (domain === 'cover') service = ent.state === 'open' ? 'close_cover' : 'open_cover';
    else if (domain === 'climate') service = ent.state === 'off' ? 'turn_on' : 'turn_off';
    else if (domain === 'vacuum') service = ent.state === 'cleaning' ? 'return_to_base' : 'start';
    else if (['light', 'switch', 'fan', 'input_boolean', 'automation', 'group', 'media_player'].indexOf(domain) !== -1) {
      targetDomain = domain === 'media_player' ? 'media_player' : 'homeassistant';
      service = domain === 'media_player' ? 'toggle' : 'toggle';
    } else {
      targetDomain = 'homeassistant';
      service = 'toggle';
    }
    A.HA.callService(targetDomain, service, { entity_id: id }).then(function () {
      A.UI.toast((service === 'toggle' ? 'Toggled ' : service.replace(/_/g, ' ') + ' ') + entityName(id, ent), 'ok', 1800);
    }).catch(function (err) {
      A.UI.toast('Home Assistant: ' + err.message, 'error', 4500);
    });
  }

  /* ---------- detailed entity controls ---------- */

  var MP_PAUSE = 1;
  var MP_VOLUME_SET = 4;
  var MP_VOLUME_MUTE = 8;
  var MP_PREVIOUS = 16;
  var MP_NEXT = 32;
  var MP_STOP = 4096;
  var MP_PLAY = 16384;
  var MP_VOLUME_STEP = 1024;

  var DETAIL_COLORS = [
    { name: 'Warm white', rgb: [255, 214, 170] },
    { name: 'White', rgb: [255, 255, 255] },
    { name: 'Red', rgb: [255, 40, 40] },
    { name: 'Orange', rgb: [255, 140, 20] },
    { name: 'Yellow', rgb: [255, 220, 40] },
    { name: 'Green', rgb: [40, 210, 90] },
    { name: 'Cyan', rgb: [40, 210, 220] },
    { name: 'Blue', rgb: [60, 100, 255] },
    { name: 'Purple', rgb: [160, 70, 255] }
  ];

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function detailValue(key, fallback) {
    var values = state.detail.values || {};
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
  }

  function clearDetailTimer() {
    if (state.detail.clearTimer) {
      clearTimeout(state.detail.clearTimer);
      state.detail.clearTimer = null;
    }
  }

  function scheduleDetailClear() {
    clearDetailTimer();
    state.detail.clearTimer = setTimeout(function () {
      state.detail.values = {};
      if (A.App && A.App.state && A.App.state.screen === 'ha-detail') renderDetail();
    }, 4500);
  }

  function detailCall(domain, service, data, key, value) {
    var payload = { entity_id: state.detail.entityId };
    Object.keys(data || {}).forEach(function (item) { payload[item] = data[item]; });
    if (key) {
      state.detail.values[key] = value;
      scheduleDetailClear();
      if (A.App && A.App.state && A.App.state.screen === 'ha-detail') renderDetail();
    }
    return A.HA.callService(domain, service, payload).then(function () {
      if (A.App && A.App.state && A.App.state.screen === 'ha-detail') {
        setTimeout(function () {
          if (A.App.state.screen === 'ha-detail') renderDetail();
        }, 350);
      }
    }).catch(function (err) {
      A.UI.toast('Home Assistant: ' + err.message, 'error', 4500);
    });
  }

  function optionPayload(field, value) {
    var data = {};
    data[field] = value;
    return data;
  }

  function addOptionControl(controls, key, label, options, current, domain, service, field) {
    if (!Array.isArray(options) || !options.length) return;
    controls.push({
      kind: 'options',
      key: key,
      label: label,
      options: options.slice(),
      value: detailValue(key, current),
      cycle: function (direction) {
        var list = this.options;
        var now = detailValue(key, current);
        var index = list.indexOf(now);
        if (index < 0) index = direction > 0 ? -1 : 0;
        var next = list[(index + direction + list.length) % list.length];
        detailCall(domain, service, optionPayload(field, next), key, next);
      }
    });
  }

  function nearestColorIndex(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3) return 1;
    var best = 0;
    var distance = Infinity;
    DETAIL_COLORS.forEach(function (color, index) {
      var r = rgb[0] - color.rgb[0], g = rgb[1] - color.rgb[1], b = rgb[2] - color.rgb[2];
      var d = r * r + g * g + b * b;
      if (d < distance) { distance = d; best = index; }
    });
    return best;
  }

  function buildDetailControls(id) {
    var ent = entity(id);
    if (!ent) return [];
    var attrs = ent.attributes || {};
    var domain = domainOf(id);
    var controls = [];
    var features = num(attrs.supported_features, 0);

    if (domain === 'climate') {
      var target = attrs.temperature;
      if (target != null && isFinite(Number(target))) {
        var minTemp = num(attrs.min_temp, 7);
        var maxTemp = num(attrs.max_temp, 35);
        var tempStep = num(attrs.target_temp_step, 0.5);
        controls.push({
          kind: 'stepper',
          key: 'temperature',
          label: 'Target temperature',
          value: num(detailValue('temperature', target), target),
          min: minTemp,
          max: maxTemp,
          step: tempStep,
          format: function (value) { return value.toFixed(1) + '°'; },
          change: function (direction) {
            var now = num(detailValue('temperature', target), target);
            var next = Math.round((now + direction * tempStep) / tempStep) * tempStep;
            next = Math.max(minTemp, Math.min(maxTemp, next));
            detailCall('climate', 'set_temperature', { temperature: next }, 'temperature', next);
          }
        });
      }
      addOptionControl(controls, 'hvac_mode', 'Mode', attrs.hvac_modes,
        attrs.hvac_mode || ent.state, 'climate', 'set_hvac_mode', 'hvac_mode');
      addOptionControl(controls, 'preset_mode', 'Preset', attrs.preset_modes,
        attrs.preset_mode, 'climate', 'set_preset_mode', 'preset_mode');
      addOptionControl(controls, 'fan_mode', 'Fan speed', attrs.fan_modes,
        attrs.fan_mode, 'climate', 'set_fan_mode', 'fan_mode');
      addOptionControl(controls, 'swing_mode', 'Swing', attrs.swing_modes,
        attrs.swing_mode, 'climate', 'set_swing_mode', 'swing_mode');
    } else if (domain === 'light') {
      var modes = Array.isArray(attrs.supported_color_modes) ? attrs.supported_color_modes : [];
      var dimmable = attrs.brightness != null || modes.some(function (mode) { return mode !== 'onoff'; });
      if (dimmable) {
        var brightness = attrs.brightness == null ? 0 : Math.round(Number(attrs.brightness) / 255 * 100);
        controls.push({
          kind: 'stepper',
          key: 'brightness',
          label: 'Brightness',
          value: num(detailValue('brightness', brightness), brightness),
          min: 0,
          max: 100,
          step: 5,
          format: function (value) { return value + '%'; },
          change: function (direction) {
            var now = num(detailValue('brightness', brightness), brightness);
            var next = Math.max(0, Math.min(100, now + direction * 5));
            detailCall('light', 'turn_on', { brightness_pct: next }, 'brightness', next);
          }
        });
      }
      var rgbModes = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
      var hasRgb = rgbModes.some(function (mode) { return modes.indexOf(mode) !== -1; }) ||
        Array.isArray(attrs.rgb_color) || Array.isArray(attrs.hs_color);
      if (hasRgb) {
        var colorIndex = num(detailValue('color', nearestColorIndex(attrs.rgb_color)), 1);
        controls.push({
          kind: 'colors',
          key: 'color',
          label: 'Colour',
          colors: DETAIL_COLORS,
          value: colorIndex,
          cycle: function (direction) {
            var now = num(detailValue('color', colorIndex), colorIndex);
            var next = (now + direction + DETAIL_COLORS.length) % DETAIL_COLORS.length;
            detailCall('light', 'turn_on', { rgb_color: DETAIL_COLORS[next].rgb }, 'color', next);
          }
        });
      } else if (attrs.color_temp_kelvin != null || attrs.min_color_temp_kelvin != null) {
        var minK = num(attrs.min_color_temp_kelvin, 2200);
        var maxK = num(attrs.max_color_temp_kelvin, 6500);
        var kelvin = num(attrs.color_temp_kelvin, (minK + maxK) / 2);
        controls.push({
          kind: 'stepper',
          key: 'color_temp',
          label: 'Colour temperature',
          value: num(detailValue('color_temp', kelvin), kelvin),
          min: minK,
          max: maxK,
          step: 250,
          format: function (value) { return Math.round(value) + 'K'; },
          change: function (direction) {
            var now = num(detailValue('color_temp', kelvin), kelvin);
            var next = Math.max(minK, Math.min(maxK, now + direction * 250));
            detailCall('light', 'turn_on', { color_temp_kelvin: next }, 'color_temp', next);
          }
        });
      } else if (attrs.color_temp != null || attrs.min_mireds != null) {
        var minM = num(attrs.min_mireds, 153);
        var maxM = num(attrs.max_mireds, 500);
        var mired = num(attrs.color_temp, 300);
        controls.push({
          kind: 'stepper',
          key: 'color_temp',
          label: 'Colour temperature',
          value: num(detailValue('color_temp', mired), mired),
          min: minM,
          max: maxM,
          step: 20,
          format: function (value) { return Math.round(value) + ' mired'; },
          change: function (direction) {
            var now = num(detailValue('color_temp', mired), mired);
            var next = Math.max(minM, Math.min(maxM, now + direction * 20));
            detailCall('light', 'turn_on', { color_temp: next }, 'color_temp', next);
          }
        });
      }
      addOptionControl(controls, 'effect', 'Effect', attrs.effect_list,
        attrs.effect, 'light', 'turn_on', 'effect');
    } else if (domain === 'media_player') {
      if (features & MP_PREVIOUS) {
        controls.push({ kind: 'button', label: 'Previous', icon: 'previous', activate: function () {
          detailCall('media_player', 'media_previous_track', {}, '');
        } });
      }
      if (features & MP_PLAY) {
        controls.push({ kind: 'button', label: 'Play', icon: 'play', activate: function () {
          detailCall('media_player', 'media_play', {}, '');
        } });
      }
      if (features & MP_PAUSE) {
        controls.push({ kind: 'button', label: 'Pause', icon: 'pause', activate: function () {
          detailCall('media_player', 'media_pause', {}, '');
        } });
      }
      if (!(features & (MP_PLAY | MP_PAUSE)) && (ent.state === 'playing' || ent.state === 'paused')) {
        var playing = ent.state === 'playing';
        controls.push({ kind: 'button', label: playing ? 'Pause' : 'Play', icon: playing ? 'pause' : 'play', activate: function () {
          detailCall('media_player', 'media_play_pause', {}, '');
        } });
      }
      if (features & MP_STOP) {
        controls.push({ kind: 'button', label: 'Stop', icon: 'stop', activate: function () {
          detailCall('media_player', 'media_stop', {}, '');
        } });
      }
      if (features & MP_NEXT) {
        controls.push({ kind: 'button', label: 'Next', icon: 'next', activate: function () {
          detailCall('media_player', 'media_next_track', {}, '');
        } });
      }
      if (features & MP_VOLUME_SET) {
        var volume = attrs.volume_level == null ? 0 : Math.round(Number(attrs.volume_level) * 100);
        controls.push({
          kind: 'stepper',
          key: 'volume',
          label: 'Volume',
          value: num(detailValue('volume', volume), volume),
          min: 0,
          max: 100,
          step: 5,
          format: function (value) { return value + '%'; },
          change: function (direction) {
            var now = num(detailValue('volume', volume), volume);
            var next = Math.max(0, Math.min(100, now + direction * 5));
            detailCall('media_player', 'volume_set', { volume_level: next / 100 }, 'volume', next);
          }
        });
      } else if (features & MP_VOLUME_STEP) {
        controls.push({ kind: 'button', label: 'Volume down', icon: 'volume', activate: function () {
          detailCall('media_player', 'volume_down', {}, '');
        } });
        controls.push({ kind: 'button', label: 'Volume up', icon: 'volume', activate: function () {
          detailCall('media_player', 'volume_up', {}, '');
        } });
      }
      if (features & MP_VOLUME_MUTE) {
        var muted = detailValue('mute', !!attrs.is_volume_muted);
        controls.push({ kind: 'button', label: muted ? 'Unmute' : 'Mute', icon: 'volume', activate: function () {
          var next = !muted;
          detailCall('media_player', 'volume_mute', { is_volume_muted: next }, 'mute', next);
        } });
      }
      addOptionControl(controls, 'source', 'Source', attrs.source_list,
        attrs.source, 'media_player', 'select_source', 'source');
    } else if (domain === 'select' || domain === 'input_select') {
      addOptionControl(controls, 'option', 'Option', attrs.options,
        ent.state, domain, 'select_option', 'option');
    } else if (domain === 'cover') {
      if (attrs.current_position != null && (features & 4)) {
        var position = num(attrs.current_position, 0);
        controls.push({
          kind: 'stepper',
          key: 'position',
          label: 'Position',
          value: num(detailValue('position', position), position),
          min: 0,
          max: 100,
          step: 5,
          format: function (value) { return Math.round(value) + '%'; },
          change: function (direction) {
            var now = num(detailValue('position', position), position);
            var next = Math.max(0, Math.min(100, now + direction * 5));
            detailCall('cover', 'set_cover_position', { position: next }, 'position', next);
          }
        });
      }
    } else if (domain === 'fan') {
      if (attrs.percentage != null) {
        var fanStep = num(attrs.percentage_step, 5);
        var fanPct = num(attrs.percentage, 0);
        controls.push({
          kind: 'stepper',
          key: 'percentage',
          label: 'Fan speed',
          value: num(detailValue('percentage', fanPct), fanPct),
          min: 0,
          max: 100,
          step: fanStep,
          format: function (value) { return Math.round(value) + '%'; },
          change: function (direction) {
            var now = num(detailValue('percentage', fanPct), fanPct);
            var next = Math.max(0, Math.min(100, now + direction * fanStep));
            detailCall('fan', 'set_percentage', { percentage: next }, 'percentage', next);
          }
        });
      }
      addOptionControl(controls, 'preset_mode', 'Preset', attrs.preset_modes,
        attrs.preset_mode, 'fan', 'set_preset_mode', 'preset_mode');
      if (attrs.oscillating != null) {
        var oscillating = detailValue('oscillating', !!attrs.oscillating);
        controls.push({ kind: 'button', label: oscillating ? 'Stop oscillating' : 'Oscillate', icon: 'wind', activate: function () {
          var next = !oscillating;
          detailCall('fan', 'oscillate', { oscillating: next }, 'oscillating', next);
        } });
      }
    } else if (domain === 'number' || domain === 'input_number') {
      if (attrs.min != null && attrs.max != null) {
        var minNum = num(attrs.min, 0);
        var maxNum = num(attrs.max, 100);
        var numStep = num(attrs.step, 1);
        var currentNum = num(ent.state, minNum);
        controls.push({
          kind: 'stepper',
          key: 'number',
          label: domainName(domain),
          value: num(detailValue('number', currentNum), currentNum),
          min: minNum,
          max: maxNum,
          step: numStep,
          format: function (value) { return String(Math.round(value * 100) / 100); },
          change: function (direction) {
            var now = num(detailValue('number', currentNum), currentNum);
            var next = Math.round((now + direction * numStep) / numStep) * numStep;
            next = Math.max(minNum, Math.min(maxNum, next));
            detailCall(domain, 'set_value', { value: next }, 'number', next);
          }
        });
      }
    }

    return controls;
  }

  function detailMediaHero(ent, id) {
    var attrs = ent.attributes || {};
    var picture = attrs.entity_picture || '';
    if (picture && picture.charAt(0) === '/' && A.HA.base) picture = A.HA.base() + picture;
    var title = attrs.media_title || attrs.media_series_title || 'Nothing playing';
    var artist = attrs.media_artist || attrs.media_album_artist || '';
    var album = attrs.media_album_name || '';
    return '<div class="ha-detail-media">' +
      '<div class="ha-detail-art">' +
      '<span class="ha-detail-art-fallback">' + A.UI.icon('music') + '</span>' +
      (picture ? '<img id="ha-detail-art-img" src="' + esc(picture) + '" alt="">' : '') +
      '</div>' +
      '<div class="ha-detail-media-info">' +
      '<span class="ha-detail-state">' + esc(stateText(ent, id)) + '</span>' +
      '<h2>' + esc(title) + '</h2>' +
      (artist ? '<p>' + esc(artist) + '</p>' : '') +
      (album ? '<p class="muted">' + esc(album) + '</p>' : '') +
      '</div></div>';
  }

  function detailRow(control, index, focused) {
    var cls = 'ha-detail-row' + (focused ? ' focused' : '');
    if (control.kind === 'stepper') {
      return '<div class="' + cls + '">' +
        '<span class="ha-detail-label">' + esc(control.label) + '</span>' +
        '<span class="ha-detail-stepper">' +
        '<span class="ha-detail-step">−</span>' +
        '<span class="ha-detail-value">' + esc(control.format(control.value)) + '</span>' +
        '<span class="ha-detail-step">+</span>' +
        '</span></div>';
    }
    if (control.kind === 'options') {
      return '<div class="' + cls + ' options">' +
        '<div class="ha-detail-row-head"><span class="ha-detail-label">' + esc(control.label) + '</span>' +
        '<span class="ha-detail-current-option">' + esc(control.value || '') + '</span></div>' +
        '<div class="ha-detail-options">' + control.options.map(function (option) {
          return '<span class="ha-detail-option' + (option === control.value ? ' active' : '') + '">' +
            esc(option) + '</span>';
        }).join('') + '</div></div>';
    }
    if (control.kind === 'colors') {
      var current = control.colors[control.value] || control.colors[0];
      return '<div class="' + cls + ' options">' +
        '<div class="ha-detail-row-head"><span class="ha-detail-label">' + esc(control.label) + '</span>' +
        '<span class="ha-detail-current-option">' + esc(current ? current.name : '') + '</span></div>' +
        '<div class="ha-detail-colors">' + control.colors.map(function (color, i) {
          return '<span class="ha-detail-color' + (i === control.value ? ' active' : '') + '" ' +
            'style="background:rgb(' + color.rgb.join(',') + ')" title="' + esc(color.name) + '"></span>';
        }).join('') + '</div></div>';
    }
    return '<div class="' + cls + '">' +
      '<span class="ha-detail-button"><span class="ha-detail-button-icon">' +
      A.UI.icon(control.icon || 'play') + '</span>' +
      '<span class="ha-detail-label">' + esc(control.label) + '</span></span></div>';
  }

  function renderDetail() {
    var d = state.detail;
    var id = d.entityId;
    var ent = entity(id);
    if (!ent) { closeDetail(); return; }
    var attrs = ent.attributes || {};
    var domain = domainOf(id);
    updateConnection();
    var title = q('#ha-detail-title');
    var eyebrow = q('#ha-detail-eyebrow');
    if (title) title.textContent = entityName(id, ent);
    if (eyebrow) eyebrow.textContent = 'HOME ASSISTANT · ' + domainName(domain).toUpperCase();

    var controls = buildDetailControls(id);
    d.controls = controls;
    if (!controls.length) { closeDetail(); return; }
    if (d.index >= controls.length) d.index = controls.length - 1;

    var html = '';
    if (domain === 'media_player') html += detailMediaHero(ent, id);
    if (domain === 'climate' && attrs.current_temperature != null) {
      var climateState = String(attrs.hvac_action || ent.state || '').replace(/_/g, ' ');
      if (climateState) climateState = climateState.charAt(0).toUpperCase() + climateState.slice(1);
      html += '<div class="ha-detail-summary">' +
        '<span class="ha-detail-current">' + esc(String(attrs.current_temperature)) + '°</span>' +
        '<span class="ha-detail-sub">' + esc(climateState) + '</span></div>';
    }
    html += '<div class="ha-detail-list">' + controls.map(function (control, index) {
      return detailRow(control, index, index === d.index);
    }).join('') + '</div>';

    var body = q('#ha-detail-body');
    if (body) {
      body.innerHTML = html;
      var art = q('#ha-detail-art-img');
      if (art) {
        art.onerror = function () { this.style.display = 'none'; };
      }
      var focused = body.querySelector('.ha-detail-row.focused');
      if (focused) {
        try { focused.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {
          try { focused.scrollIntoView(); } catch (err) { /* ignore */ }
        }
      }
    }
  }

  function openDetailForEntity(id, returnScreen) {
    state.detail.entityId = id;
    state.detail.index = 0;
    state.detail.values = {};
    state.detail.returnScreen = returnScreen || 'ha';
    state.detail.ignoreOkUntil = returnScreen === 'home' ? Date.now() + 420 : 0;
    clearDetailTimer();
    var controls = buildDetailControls(id);
    if (!controls.length) {
      state.detail.entityId = '';
      state.detail.values = {};
      state.detail.returnScreen = 'ha';
      var domain = domainOf(id);
      if (['sensor', 'binary_sensor', 'weather', 'sun'].indexOf(domain) !== -1) {
        infoForEntity(id);
      } else {
        A.UI.toast('No detailed controls for this entity', '', 2500);
      }
      return;
    }
    showScreen('ha-detail');
    renderDetail();
  }

  function openDetail(index) {
    var page = currentPage();
    var widget = page.widgets[index];
    if (!widget) return;
    openDetailForEntity(widget.entity, 'ha');
  }

  function closeDetail() {
    var back = state.detail.returnScreen || 'ha';
    clearDetailTimer();
    state.detail.values = {};
    state.detail.controls = [];
    state.detail.entityId = '';
    state.detail.index = 0;
    state.detail.returnScreen = 'ha';
    state.detail.ignoreOkUntil = 0;
    if (back === 'home' && A.App && A.App.showHome) {
      A.App.showHome();
      return;
    }
    showScreen('ha');
    render();
  }

  function toggleEntity(id) {
    if (!id) return;
    var ent = entity(id);
    if (!ent) {
      A.UI.toast('Entity is not available in Home Assistant', 'error', 3500);
      return;
    }
    var domain = domainOf(id);
    var targetDomain = 'homeassistant';
    var service = 'toggle';
    if (domain === 'climate') {
      targetDomain = 'climate';
      service = ent.state === 'off' ? 'turn_on' : 'turn_off';
    }
    A.HA.callService(targetDomain, service, { entity_id: id }).then(function () {
      A.UI.toast((service === 'turn_on' ? 'Turned on ' : service === 'turn_off' ? 'Turned off ' : 'Toggled ') + entityName(id, ent), 'ok', 1800);
    }).catch(function (err) {
      A.UI.toast('Home Assistant: ' + err.message, 'error', 4500);
    });
  }

  function adjustDetail(control, direction) {
    if (!control) return;
    if (control.kind === 'stepper' && control.change) control.change(direction);
    else if (control.kind === 'options' && control.cycle) control.cycle(direction);
    else if (control.kind === 'colors' && control.cycle) control.cycle(direction);
  }

  function activateDetail(control) {
    if (!control) return;
    if (control.kind === 'stepper' && control.change) control.change(1);
    else if (control.kind === 'options' && control.cycle) control.cycle(1);
    else if (control.kind === 'colors' && control.cycle) control.cycle(1);
    else if (control.kind === 'button' && control.activate) control.activate();
  }

  function detailKey(code) {
    if (code === 10009 || code === 27) {
      closeDetail();
      return true;
    }
    var d = state.detail;
    if (!d.controls.length) {
      closeDetail();
      return true;
    }
    if (code === 38 || code === 40) {
      d.index = U.clamp(d.index + (code === 40 ? 1 : -1), 0, d.controls.length - 1);
      renderDetail();
      return true;
    }
    var control = d.controls[d.index];
    if (code === 37 || code === 39) {
      adjustDetail(control, code === 39 ? 1 : -1);
      return true;
    }
    if (code === 13) {
      if (Date.now() < (d.ignoreOkUntil || 0)) return true;
      activateDetail(control);
      return true;
    }
    return false;
  }

  function cancelWidgetPress() {
    if (state.press) {
      clearTimeout(state.press.timer);
      state.press = null;
    }
  }

  function beginWidgetPress(index) {
    cancelWidgetPress();
    var press = { index: index, at: Date.now(), long: false, timer: null };
    press.timer = setTimeout(function () {
      if (state.press !== press) return;
      press.long = true;
      openDetail(index);
    }, 650);
    state.press = press;
  }

  function handleKeyUp(code) {
    if (code !== 13) return false;
    var press = state.press;
    if (!press) return false;
    clearTimeout(press.timer);
    state.press = null;
    if (!press.long) activateWidget(press.index);
    return true;
  }

  function haKey(code) {
    if (state.press && code !== 13) cancelWidgetPress();
    if (code === 10009 || code === 27) {
      A.App.showHome();
      return true;
    }
    if (code === 427 || code === 428) {
      cyclePage(code === 428 ? 1 : -1);
      return true;
    }
    if (state.focus === 'tabs') {
      if (code === 37 || code === 39) {
        state.tabIndex = (state.tabIndex + (code === 39 ? 1 : -1) + state.tabs.length) % state.tabs.length;
        renderTabs();
        applyFocus();
        return true;
      }
      if (code === 40) {
        var page = currentPage();
        if (page.widgets.length) {
          state.focus = 'grid';
          state.widgetIndex = 0;
          renderGrid();
          applyFocus();
        }
        return true;
      }
      if (code === 13) {
        activateTab(state.tabIndex);
        return true;
      }
      return false;
    }
    if (code === 37 || code === 39) {
      var page = currentPage();
      state.widgetIndex = U.clamp(state.widgetIndex + (code === 39 ? 1 : -1), 0, page.widgets.length - 1);
      renderGrid();
      applyFocus();
      return true;
    }
    if (code === 40) {
      var pageDown = currentPage();
      if (state.widgetIndex + state.columns < pageDown.widgets.length) {
        state.widgetIndex += state.columns;
        renderGrid();
        applyFocus();
      }
      return true;
    }
    if (code === 38) {
      if (state.widgetIndex < state.columns) {
        state.focus = 'tabs';
        state.tabIndex = Math.max(0, pages().indexOf(currentPage()));
        renderTabs();
        applyFocus();
      } else {
        state.widgetIndex -= state.columns;
        renderGrid();
        applyFocus();
      }
      return true;
    }
    if (code === 13) {
      if (state.press) return true;
      beginWidgetPress(state.widgetIndex);
      return true;
    }
    return false;
  }

  /* ---------- entity browser ---------- */

  function listableEntity(id) {
    var domain = domainOf(id);
    return ['camera', 'device_tracker', 'zone', 'person', 'sun',
      'persistent_notification', 'update', 'tts', 'stt', 'conversation',
      'assist_satellite'].indexOf(domain) === -1;
  }

  function currentPageHas(entityId) {
    var page = currentPage();
    var found = false;
    (page.widgets || []).forEach(function (widget) {
      if (widget.entity === entityId) found = true;
    });
    return found;
  }

  function togglePageEntity(entityId) {
    var page = currentPage();
    var index = -1;
    (page.widgets || []).forEach(function (widget, i) {
      if (widget.entity === entityId) index = i;
    });
    if (index === -1) {
      page.widgets.push({ entity: entityId, type: '' });
      A.UI.toast('Added to ' + page.name, 'ok', 1800);
    } else {
      page.widgets.splice(index, 1);
      A.UI.toast('Removed from ' + page.name, '', 1600);
    }
    saveConfig();
    renderBrowser();
    if (state.focus === 'grid') state.widgetIndex = Math.min(state.widgetIndex, Math.max(0, page.widgets.length - 1));
  }

  function browserAreas() {
    var b = state.browser;
    return b.areas.map(function (area) {
      return {
        id: area.id,
        name: area.name,
        count: b.counts[area.id] || 0
      };
    });
  }

  function browserAreaName() {
    var b = state.browser;
    if (!b.areaId) return 'Select an area';
    var found = null;
    b.areas.forEach(function (area) { if (area.id === b.areaId) found = area.name; });
    return found || 'Entities';
  }

  function browserAreaId(reg) {
    var b = state.browser;
    return reg.area_id || (reg.device_id && b.deviceArea && b.deviceArea[reg.device_id]) || 'unassigned';
  }

  function browserCacheKey() {
    return (A.HA.base ? A.HA.base() : '') + '|' + (haCfg().token || '');
  }

  function makeBrowserEntity(id) {
    var ent = A.HA.states ? A.HA.states[id] : null;
    return {
      id: id,
      name: entityName(id, ent),
      state: ent ? ent.state : 'unavailable',
      areaId: browserAreaId((state.browser.registry && state.browser.registry[id]) || {})
    };
  }

  // Build an area's entity list the first time it is opened. Registries and
  // area counts are loaded up front; the per-area objects and sorting are not.
  function ensureAreaEntities(areaId) {
    var b = state.browser;
    if (Object.prototype.hasOwnProperty.call(b.areaEntities, areaId)) return b.areaEntities[areaId];
    var entities = [];
    Object.keys(A.HA.states || {}).forEach(function (id) {
      if (!listableEntity(id)) return;
      var reg = (b.registry && b.registry[id]) || {};
      if (reg.disabled_by || reg.hidden_by) return;
      if (browserAreaId(reg) !== areaId) return;
      entities.push(makeBrowserEntity(id));
    });
    entities.sort(function (a, b2) { return a.name.localeCompare(b2.name); });
    b.areaEntities[areaId] = entities;
    return entities;
  }

  function currentAreaEntities() {
    var b = state.browser;
    if (!b.areaId) return [];
    return ensureAreaEntities(b.areaId);
  }

  function renderBrowser() {
    var b = state.browser;
    var page = currentPage();
    var pageLabel = q('#ha-browser-page');
    if (pageLabel) pageLabel.textContent = page.name;
    var status = q('#ha-browser-status');
    if (status) {
      if (b.loading) status.textContent = 'Loading areas…';
      else if (b.error) status.textContent = b.error;
      else status.textContent = b.areas.length + (b.areas.length === 1 ? ' area' : ' areas');
    }
    var areaHost = q('#ha-area-list');
    var areas = browserAreas();
    if (areaHost) {
      if (!areas.length && !b.loading) {
        areaHost.innerHTML = '<div class="ha-pane-empty">No areas loaded</div>';
      } else {
        areaHost.innerHTML = areas.map(function (area, index) {
          var cls = 'ha-area-item' + (area.id === b.areaId ? ' active' : '') +
            (b.pane === 'areas' && index === b.areaIndex ? ' focused' : '');
          return '<button type="button" class="' + cls + '" data-area="' + index + '">' +
            '<span class="ha-area-name">' + esc(area.name) + '</span>' +
            '<span class="ha-area-count">' + area.count + '</span></button>';
        }).join('');
      }
    }
    var heading = q('#ha-entity-heading');
    var entities = currentAreaEntities();
    if (heading) {
      heading.textContent = b.areaId
        ? browserAreaName().toUpperCase() + ' · ' + entities.length
        : 'SELECT AN AREA';
    }
    var entityHost = q('#ha-entity-list');
    if (entityHost) {
      if (b.loading) {
        entityHost.innerHTML = '<div class="ha-pane-empty">Reading Home Assistant…</div>';
      } else if (!b.areaId) {
        entityHost.innerHTML = '<div class="ha-pane-empty">Select an area to load its entities</div>';
      } else if (!entities.length) {
        entityHost.innerHTML = '<div class="ha-pane-empty">No entities in this area</div>';
      } else {
        entityHost.innerHTML = entities.map(function (item, index) {
          var added = currentPageHas(item.id);
          var cls = 'ha-entity-item' + (added ? ' added' : '') +
            (b.pane === 'entities' && index === b.entityIndex ? ' focused' : '');
          return '<button type="button" class="' + cls + '" data-entity="' + index + '">' +
            '<span class="ha-entity-main"><span class="ha-entity-name">' + esc(item.name) + '</span>' +
            '<span class="ha-entity-id">' + esc(item.id) + '</span></span>' +
            '<span class="ha-entity-state">' + esc(item.state) + '</span>' +
            '<span class="ha-entity-add">' + (added ? 'Remove' : 'Add') + '</span></button>';
        }).join('');
      }
    }
    var focusNode = null;
    if (b.pane === 'areas') focusNode = q('#ha-area-list .ha-area-item.focused');
    else focusNode = q('#ha-entity-list .ha-entity-item.focused');
    if (focusNode) {
      try { focusNode.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {
        try { focusNode.scrollIntoView(); } catch (err) { /* ignore */ }
      }
    }
  }

  function fallbackBrowser(reason) {
    var b = state.browser;
    b.loading = false;
    b.error = reason || '';
    b.fallback = true;
    b.registry = null;
    b.deviceArea = null;
    b.areas = [{ id: 'unassigned', name: 'Unassigned' }];
    b.counts = {
      unassigned: Object.keys(A.HA.states || {}).filter(listableEntity).length
    };
    b.areaEntities = {};
    b.loaded = true;
    b.loadedAt = Date.now();
    b.cacheKey = browserCacheKey();
    b.areaId = '';
    b.areaIndex = 0;
    b.entityIndex = 0;
    b.pane = 'areas';
    renderBrowser();
  }

  var BROWSER_CACHE_MS = 5 * 60 * 1000;

  function loadBrowser(force) {
    var b = state.browser;
    var key = browserCacheKey();
    if (!force && b.loaded && !b.fallback && b.cacheKey === key &&
        Date.now() - b.loadedAt < BROWSER_CACHE_MS) {
      renderBrowser();
      return;
    }
    b.loading = true;
    b.error = '';
    b.areas = [];
    b.areaEntities = {};
    b.counts = {};
    b.registry = null;
    b.deviceArea = null;
    b.fallback = false;
    b.areaId = '';
    b.pane = 'areas';
    b.areaIndex = 0;
    b.entityIndex = 0;
    renderBrowser();
    if (!A.HA.configured) {
      b.loading = false;
      b.error = 'Configure Home Assistant in Settings first';
      renderBrowser();
      return;
    }
    if (!A.HA.connected) {
      fallbackBrowser('Areas need the Home Assistant WebSocket; showing unassigned entities');
      return;
    }
    Promise.all([
      A.HA.command('config/area_registry/list'),
      A.HA.command('config/entity_registry/list'),
      A.HA.command('config/device_registry/list')
    ]).then(function (result) {
      var areaList = result[0] || [];
      var entityList = result[1] || [];
      var deviceList = result[2] || [];
      var registry = {};
      entityList.forEach(function (item) { if (item.entity_id) registry[item.entity_id] = item; });
      var deviceArea = {};
      deviceList.forEach(function (item) { if (item.id) deviceArea[item.id] = item.area_id || ''; });
      var areas = [];
      areaList.forEach(function (area) {
        if (area && area.area_id) {
          areas.push({ id: area.area_id, name: area.name || area.area_id });
        }
      });
      areas.sort(function (a, b2) { return a.name.localeCompare(b2.name); });
      b.registry = registry;
      b.deviceArea = deviceArea;
      var counts = {};
      Object.keys(A.HA.states || {}).forEach(function (id) {
        if (!listableEntity(id)) return;
        var reg = registry[id] || {};
        if (reg.disabled_by || reg.hidden_by) return;
        var areaId = browserAreaId(reg);
        counts[areaId] = (counts[areaId] || 0) + 1;
      });
      if (counts.unassigned) areas.push({ id: 'unassigned', name: 'Unassigned' });
      b.loading = false;
      b.areas = areas;
      b.counts = counts;
      b.loaded = true;
      b.loadedAt = Date.now();
      b.cacheKey = key;
      b.areaId = '';
      b.areaIndex = 0;
      b.entityIndex = 0;
      b.pane = 'areas';
      renderBrowser();
    }).catch(function (err) {
      fallbackBrowser('Areas unavailable: ' + err.message);
    });
  }

  function openBrowser() {
    currentPage();
    state.browser.pane = 'areas';
    showScreen('ha-browser');
    loadBrowser(false);
  }

  function selectArea(area) {
    if (!area) return;
    var b = state.browser;
    b.areaId = area.id;
    b.entityIndex = 0;
    ensureAreaEntities(area.id);
    b.pane = 'entities';
    renderBrowser();
  }

  function closeBrowser() {
    showScreen('ha');
    render();
  }

  function browserKey(code) {
    var b = state.browser;
    if (code === 10009 || code === 27) {
      if (b.pane === 'entities') {
        b.pane = 'areas';
        renderBrowser();
      } else {
        closeBrowser();
      }
      return true;
    }
    if (code === 38 || code === 40) {
      if (b.pane === 'areas') {
        var areas = browserAreas();
        if (areas.length) b.areaIndex = U.clamp(b.areaIndex + (code === 40 ? 1 : -1), 0, areas.length - 1);
      } else {
        var entities = currentAreaEntities();
        if (entities.length) b.entityIndex = U.clamp(b.entityIndex + (code === 40 ? 1 : -1), 0, entities.length - 1);
      }
      renderBrowser();
      return true;
    }
    if (code === 37) {
      b.pane = 'areas';
      renderBrowser();
      return true;
    }
    if (code === 39) {
      if (b.pane === 'areas') {
        selectArea(browserAreas()[b.areaIndex]);
      } else {
        b.pane = 'entities';
        renderBrowser();
      }
      return true;
    }
    if (code === 13) {
      if (b.pane === 'areas') {
        selectArea(browserAreas()[b.areaIndex]);
      } else {
        var items = currentAreaEntities();
        var item = items[b.entityIndex];
        if (item) togglePageEntity(item.id);
      }
      return true;
    }
    return false;
  }

  /* ---------- pages ---------- */

  function renderPages() {
    var host = q('#ha-pages-list');
    if (!host) return;
    var list = pages();
    var current = currentPage().id;
    var html = list.map(function (page, index) {
      var cls = 'ha-page-item' + (page.id === current ? ' active' : '') +
        (index === state.pages.index ? ' focused' : '');
      return '<button type="button" class="' + cls + '" data-page="' + index + '">' +
        '<span class="ha-page-name">' + esc(page.name) + '</span>' +
        '<span class="ha-page-count">' + page.widgets.length + (page.widgets.length === 1 ? ' widget' : ' widgets') + '</span></button>';
    }).join('');
    var newIndex = list.length;
    html += '<button type="button" class="ha-page-item new' +
      (state.pages.index === newIndex ? ' focused' : '') + '" data-page="' + newIndex + '">' +
      '<span class="ha-page-name">＋ New page</span><span class="ha-page-count">Name it, then add entities</span></button>';
    host.innerHTML = html;
    var node = host.querySelector('.ha-page-item.focused');
    if (node) {
      try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {
        try { node.scrollIntoView(); } catch (err) { /* ignore */ }
      }
    }
  }

  function openPages() {
    state.pages.index = Math.max(0, pages().indexOf(currentPage()));
    showScreen('ha-pages');
    renderPages();
  }

  function closePages() {
    showScreen('ha');
    render();
  }

  function createPage(name) {
    name = String(name || '').trim();
    if (!name) return;
    var list = pages();
    var id = 'page-' + Date.now().toString(36);
    var count = 2;
    while (pageById(id)) { id = 'page-' + Date.now().toString(36) + '-' + count++; }
    list.push({ id: id, name: name, widgets: [] });
    cfg().ha.currentPage = id;
    state.pageId = id;
    state.tabIndex = list.length - 1;
    state.focus = 'tabs';
    saveConfig();
    closePages();
    A.UI.toast('Created page “' + name + '”', 'ok', 2200);
  }

  function promptNewPage() {
    A.UI.editor({
      title: 'New page',
      eyebrow: 'HOME ASSISTANT',
      label: 'Page name',
      value: '',
      placeholder: 'e.g. Lights',
      returnScreen: 'ha-pages',
      hint: 'Press OK to save, Back to cancel.'
    }).then(function (name) {
      if (name == null) return;
      createPage(name);
    });
  }

  function renamePage(index) {
    var list = pages();
    var page = list[index];
    if (!page) return;
    A.UI.editor({
      title: 'Rename page',
      eyebrow: 'HOME ASSISTANT',
      label: 'Page name',
      value: page.name,
      returnScreen: 'ha-pages',
      hint: 'Press OK to save, Back to cancel.'
    }).then(function (name) {
      if (name == null) return;
      name = String(name).trim();
      if (!name) return;
      page.name = name;
      saveConfig();
      renderPages();
      render();
    });
  }

  function deletePage(index) {
    var list = pages();
    if (list.length <= 1) {
      A.UI.toast('Aurora needs at least one page', '', 2500);
      return;
    }
    var page = list[index];
    if (!page) return;
    A.UI.confirm({
      title: 'Delete page?',
      message: 'Delete “' + page.name + '” and its widgets?',
      okLabel: 'Delete',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      list.splice(index, 1);
      if (state.pageId === page.id) {
        state.pageId = list[0].id;
        cfg().ha.currentPage = state.pageId;
      }
      state.pages.index = U.clamp(state.pages.index, 0, list.length);
      saveConfig();
      renderPages();
      render();
    });
  }

  function pagesKey(code) {
    var total = pages().length + 1;
    if (code === 10009 || code === 27) {
      closePages();
      return true;
    }
    if (code === 38 || code === 40) {
      state.pages.index = U.clamp(state.pages.index + (code === 40 ? 1 : -1), 0, total - 1);
      renderPages();
      return true;
    }
    if (code === 13) {
      if (state.pages.index >= pages().length) {
        promptNewPage();
      } else {
        var page = pages()[state.pages.index];
        setPage(page.id);
        showScreen('ha');
        render();
      }
      return true;
    }
    if (code === 403) {
      if (state.pages.index < pages().length) renamePage(state.pages.index);
      return true;
    }
    if (code === 406) {
      if (state.pages.index < pages().length) deletePage(state.pages.index);
      return true;
    }
    return false;
  }

  /* ---------- music ---------- */

  function musicEntityId() {
    return A.HA.musicEntity ? A.HA.musicEntity() : '';
  }

  function musicEntity() {
    var id = musicEntityId();
    return id ? A.HA.entity(id) : null;
  }

  function formatClock(seconds) {
    var value = Math.max(0, Math.floor(Number(seconds) || 0));
    var hours = Math.floor(value / 3600);
    var mins = Math.floor((value % 3600) / 60);
    var secs = value % 60;
    if (hours) return hours + ':' + (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function musicStateLabel(value) {
    var state = String(value || 'idle').toLowerCase();
    if (state === 'playing') return 'Playing';
    if (state === 'paused') return 'Paused';
    if (state === 'idle') return 'Idle';
    if (state === 'off') return 'Off';
    if (state === 'standby') return 'Standby';
    return state.charAt(0).toUpperCase() + state.slice(1);
  }

  function musicPosition(ent) {
    if (!ent) return { position: 0, duration: 0 };
    var attrs = ent.attributes || {};
    var position = Number(attrs.media_position) || 0;
    var duration = Number(attrs.media_duration) || 0;
    if (ent.state === 'playing' && attrs.media_position_updated_at) {
      var updated = Date.parse(attrs.media_position_updated_at);
      if (isFinite(updated)) position += Math.max(0, (Date.now() - updated) / 1000);
    }
    if (duration > 0) position = Math.min(position, duration);
    return { position: position, duration: duration };
  }

  function renderMusic() {
    updateConnection();
    var id = musicEntityId();
    var ent = musicEntity();
    var attrs = (ent && ent.attributes) || {};
    var playerName = attrs.friendly_name || id || 'Music';
    var player = q('#music-player-name');
    if (player) player.textContent = playerName;

    var track = q('#music-track');
    var artist = q('#music-artist');
    var album = q('#music-album');
    var stateNode = q('#music-state');
    var art = q('#music-art');
    var fallback = q('#music-art-fallback');

    if (!id) {
      if (track) track.textContent = 'Configure a music player';
      if (artist) artist.textContent = 'Settings → Home Assistant → Music media_player entity';
      if (album) album.textContent = '';
      if (stateNode) stateNode.textContent = 'Not configured';
      if (art) { art.hidden = true; art.removeAttribute('src'); }
      if (fallback) fallback.hidden = false;
      setMusicPlayButton(false);
      renderMusicProgress({ position: 0, duration: 0 });
      renderMusicControls();
      return;
    }

    if (track) track.textContent = attrs.media_title || (ent ? 'Nothing playing' : 'Unavailable');
    if (artist) artist.textContent = attrs.media_artist || attrs.media_album_artist || '';
    if (album) album.textContent = attrs.media_album_name || '';
    if (stateNode) stateNode.textContent = ent ? musicStateLabel(ent.state) : 'Unavailable';
    var playing = !!(ent && ent.state === 'playing');
    setMusicPlayButton(playing);
    renderMusicProgress(musicPosition(ent));

    var picture = attrs.entity_picture || '';
    if (picture && art && fallback) {
      if (picture.charAt(0) === '/') picture = A.HA.base() + picture;
      art.onerror = function () {
        art.hidden = true;
        fallback.hidden = false;
      };
      if (art.getAttribute('src') !== picture) art.setAttribute('src', picture);
      art.hidden = false;
      fallback.hidden = true;
    } else if (art && fallback) {
      art.hidden = true;
      art.removeAttribute('src');
      fallback.hidden = false;
    }
    renderMusicControls();
  }

  function setMusicPlayButton(playing) {
    var icon = q('#music-play-icon');
    var label = q('#music-play-label');
    if (icon) icon.textContent = playing ? '⏸' : '▶';
    if (label) label.textContent = playing ? 'Pause' : 'Play';
  }

  function renderMusicProgress(progress) {
    var fill = q('#music-progress-fill');
    var pos = q('#music-position');
    var dur = q('#music-duration');
    var duration = Number(progress.duration) || 0;
    var position = Number(progress.position) || 0;
    if (fill) fill.style.width = (duration > 0 ? Math.min(100, Math.max(0, position / duration * 100)) : 0) + '%';
    if (pos) pos.textContent = formatClock(position);
    if (dur) dur.textContent = formatClock(duration);
  }

  function renderMusicControls() {
    var controls = document.querySelectorAll('[data-music-control]');
    for (var i = 0; i < controls.length; i++) {
      controls[i].classList.toggle('focused', i === state.music.focus);
    }
    var node = controls[state.music.focus];
    if (node) {
      try { node.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {
        try { node.scrollIntoView(); } catch (err) { /* ignore */ }
      }
    }
  }

  function openMusic() {
    state.music.focus = 1;
    showScreen('music');
    renderMusic();
  }

  function tickMusic() {
    if (!A.App || !A.App.state || A.App.state.screen !== 'music') return;
    renderMusicProgress(musicPosition(musicEntity()));
  }

  function refreshMusicSoon() {
    if (A.HA.refresh) A.HA.refresh();
    setTimeout(function () {
      if (A.App && A.App.state && A.App.state.screen === 'music') renderMusic();
    }, 350);
  }

  function musicSkip(direction) {
    var id = musicEntityId();
    if (!id) {
      A.UI.toast('Set a Music media_player entity in Settings first', 'error', 3500);
      return;
    }
    var service = direction > 0 ? 'media_next_track' : 'media_previous_track';
    A.HA.callService('media_player', service, { entity_id: id }).then(function () {
      refreshMusicSoon();
    }, function (err) {
      A.UI.toast('Music: ' + err.message, 'error', 4000);
    });
  }

  function musicPlayPause() {
    var id = musicEntityId();
    if (!id) {
      A.UI.toast('Set a Music media_player entity in Settings first', 'error', 3500);
      return;
    }
    var ent = musicEntity();
    var playing = !!(ent && ent.state === 'playing');
    var action = A.HA.callService('media_player', 'media_play_pause', { entity_id: id }).catch(function () {
      return A.HA.callService('media_player', playing ? 'media_pause' : 'media_play', { entity_id: id });
    });
    action.then(function () {
      refreshMusicSoon();
    }, function (err) {
      A.UI.toast('Music: ' + err.message, 'error', 4000);
    });
  }

  function activateMusicControl(index) {
    if (index === 0) musicSkip(-1);
    else if (index === 1) musicPlayPause();
    else if (index === 2) musicSkip(1);
    else if (index === 3) openMusicBrowse();
  }

  function musicKey(code) {
    if (code === 10009 || code === 27) {
      A.App.showHome();
      return true;
    }
    if (code === 427 || code === 428) {
      musicSkip(code === 428 ? 1 : -1);
      return true;
    }
    if (code === 37 || code === 39) {
      state.music.focus = U.clamp(state.music.focus + (code === 39 ? 1 : -1), 0, 3);
      renderMusicControls();
      return true;
    }
    if (code === 13) {
      activateMusicControl(state.music.focus);
      return true;
    }
    return false;
  }

  function openMusicBrowse() {
    var id = musicEntityId();
    if (!id) {
      A.UI.toast('Set a Music media_player entity in Settings first', 'error', 3500);
      return;
    }
    if (!A.HA.connected) {
      A.UI.toast('Music Assistant browsing needs the Home Assistant WebSocket', 'error', 4000);
      return;
    }
    var browse = state.music.browse;
    browse.stack = [];
    browse.items = [];
    browse.index = 0;
    browse.title = 'Music Assistant';
    browse.contentType = '';
    browse.contentId = '';
    browse.loading = true;
    browse.error = '';
    showScreen('music-browse');
    renderMusicBrowse();
    loadMusicBrowse('', '');
  }

  function loadMusicBrowse(contentType, contentId) {
    var browse = state.music.browse;
    browse.loading = true;
    browse.error = '';
    browse.contentType = contentType || '';
    browse.contentId = contentId || '';
    renderMusicBrowse();
    A.HA.browseMedia(musicEntityId(), contentType || null, contentId || null).then(function (result) {
      browse.loading = false;
      browse.items = result && Array.isArray(result.children) ? result.children : [];
      if (result && result.title) browse.title = result.title;
      browse.index = 0;
      renderMusicBrowse();
    }).catch(function (err) {
      browse.loading = false;
      browse.error = err.message;
      browse.items = [];
      renderMusicBrowse();
    });
  }

  function renderMusicBrowse() {
    var browse = state.music.browse;
    var title = q('#music-browse-title');
    if (title) title.textContent = browse.title || 'Music Assistant';
    var status = q('#music-browse-status');
    if (status) {
      if (browse.loading) status.textContent = 'Loading…';
      else if (browse.error) status.textContent = browse.error;
      else status.textContent = browse.items.length + ' items';
    }
    var host = q('#music-browse-list');
    var empty = q('#music-browse-empty');
    if (empty) empty.hidden = browse.loading || browse.error || browse.items.length > 0;
    if (!host) return;
    if (browse.loading) {
      host.innerHTML = '<div class="ha-pane-empty">Reading Music Assistant…</div>';
      return;
    }
    host.innerHTML = browse.items.map(function (item, index) {
      var expandable = !!item.can_expand;
      var playable = !!item.can_play && !!item.media_content_id;
      var cls = 'music-browse-item' + (index === browse.index ? ' focused' : '') +
        (expandable ? ' expandable' : '') + (playable ? ' playable' : '');
      var action = playable ? '▶' : (expandable ? '›' : '');
      return '<button type="button" class="' + cls + '" data-music-item="' + index + '">' +
        '<span class="music-browse-icon">' + A.UI.icon('music') + '</span>' +
        '<span class="music-browse-main"><span class="music-browse-name">' + esc(item.title || item.name || 'Untitled') + '</span>' +
        '<span class="music-browse-kind">' + esc(item.media_class || item.media_content_type || '') + '</span></span>' +
        '<span class="music-browse-action">' + action + '</span></button>';
    }).join('');
    var node = host.querySelector('.music-browse-item.focused');
    if (node) {
      try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {
        try { node.scrollIntoView(); } catch (err) { /* ignore */ }
      }
    }
  }

  function musicBrowseKey(code) {
    var browse = state.music.browse;
    if (code === 10009 || code === 27) {
      if (browse.stack.length) {
        var previous = browse.stack.pop();
        browse.title = previous.title;
        browse.contentType = previous.contentType;
        browse.contentId = previous.contentId;
        browse.items = previous.items;
        browse.index = previous.index;
        renderMusicBrowse();
      } else {
        showScreen('music');
        renderMusic();
      }
      return true;
    }
    if (code === 38 || code === 40) {
      if (browse.items.length) {
        browse.index = U.clamp(browse.index + (code === 40 ? 1 : -1), 0, browse.items.length - 1);
        renderMusicBrowse();
      }
      return true;
    }
    if (code === 13) {
      var item = browse.items[browse.index];
      if (!item || browse.loading) return true;
      if (item.media_content_id && (item.can_play || item.media_class === 'playlist')) {
        A.HA.playMedia(musicEntityId(), item.media_content_id, item.media_content_type).then(function () {
          showScreen('music');
          renderMusic();
          refreshMusicSoon();
          A.UI.toast('Playing ' + (item.title || 'selection'), 'ok', 2200);
        }).catch(function (err) {
          A.UI.toast('Could not play: ' + err.message, 'error', 4500);
        });
        return true;
      }
      if (item.can_expand && item.media_content_id) {
        browse.stack.push({
          title: browse.title,
          contentType: browse.contentType,
          contentId: browse.contentId,
          items: browse.items,
          index: browse.index
        });
        browse.title = item.title || browse.title;
        browse.items = [];
        browse.index = 0;
        loadMusicBrowse(item.media_content_type || '', item.media_content_id);
        return true;
      }
      A.UI.toast('This Music Assistant item cannot be played here', '', 3000);
      return true;
    }
    return false;
  }

  /* ---------- cameras ---------- */

  function cameraColumns() {
    return window.innerWidth >= 1500 ? 3 : 2;
  }

  function renderCameras() {
    state.cameras.list = A.HA.cameras();
    if (state.cameras.index >= state.cameras.list.length) state.cameras.index = 0;
    state.cameras.columns = cameraColumns();
    var host = q('#camera-list');
    var empty = q('#camera-empty');
    var list = state.cameras.list;
    if (empty) empty.hidden = list.length > 0;
    updateConnection();
    if (!host) return;
    if (!list.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = list.map(function (camera, index) {
      var cls = 'camera-card' + (index === state.cameras.index ? ' focused' : '');
      return '<button type="button" class="' + cls + '" data-camera="' + index + '">' +
        '<span class="camera-card-icon">' + A.UI.icon('camera') + '</span>' +
        '<span class="camera-card-main"><span class="camera-card-name">' + esc(camera.name) + '</span>' +
        '<span class="camera-card-id">' + esc(camera.id) + '</span></span>' +
        '<span class="camera-card-state">' + esc(camera.state) + '</span></button>';
    }).join('');
    var node = host.querySelector('.camera-card.focused');
    if (node) {
      try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {
        try { node.scrollIntoView(); } catch (err) { /* ignore */ }
      }
    }
  }

  function openCameras() {
    state.cameras.index = 0;
    showScreen('cameras');
    renderCameras();
  }

  function cameraError(message) {
    var node = q('#camera-live-error');
    if (!node) return;
    if (!message) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    node.hidden = false;
    node.textContent = message;
  }

  function playCameraUrl(url, index) {
    if (!url) return;
    A.Platform.playCamera(url).then(function () {
      if (A.App && A.App.state && A.App.state.screen === 'camera-live' && state.live.index === index) {
        cameraError('');
      }
    }).catch(function (err) {
      if (A.App && A.App.state && A.App.state.screen === 'camera-live' && state.live.index === index) {
        cameraError('Camera stream failed: ' + err.message);
      }
      A.UI.toast('Camera stream failed', 'error', 4500);
    });
  }

  function openCameraLive(index) {
    var list = A.HA.cameras();
    state.cameras.list = list;
    var camera = list[index];
    if (!camera) return;
    state.live.index = index;
    state.live.entityId = camera.id;
    showScreen('camera-live');
    var name = q('#camera-live-name');
    if (name) name.textContent = camera.name + (list.length > 1 ? ' · ' + (index + 1) + '/' + list.length : '');
    cameraError('');
    A.Platform.stopCamera();
    var attrs = camera.attributes || {};
    var direct = attrs.rtsp_url || attrs.stream_url || attrs.stream_source || attrs.rtsp || attrs.hls_url || '';
    if (direct && direct.charAt(0) === '/' && A.HA.base) direct = A.HA.base() + direct;
    function startHls() {
      if (!A.HA.configured || !A.HA.connected) {
        cameraError('Camera streaming needs the Home Assistant WebSocket connection.');
        return;
      }
      cameraError('Starting stream…');
      A.HA.cameraStream(camera.id).then(function (url) {
        if (A.App && A.App.state && A.App.state.screen === 'camera-live' && state.live.index === index) {
          playCameraUrl(url, index);
        }
      }).catch(function (err) {
        cameraError('Could not start stream: ' + err.message);
      });
    }
    if (direct) {
      cameraError('Starting stream…');
      A.Platform.playCamera(direct).then(function () {
        if (A.App && A.App.state && A.App.state.screen === 'camera-live' && state.live.index === index) {
          cameraError('');
        }
      }).catch(function () {
        // RTSP/HLS may be unsupported by AVPlay on this model; try HA's HLS.
        startHls();
      });
      return;
    }
    startHls();
  }

  function stopLive() {
    if (state.live.index >= 0) A.Platform.stopCamera();
    state.live.index = -1;
    state.live.entityId = '';
  }

  function closeCameraLive() {
    stopLive();
    showScreen('cameras');
    renderCameras();
  }

  function camerasKey(code) {
    var list = state.cameras.list.length ? state.cameras.list : A.HA.cameras();
    state.cameras.list = list;
    if (code === 10009 || code === 27) {
      A.App.showHome();
      return true;
    }
    if (!list.length) return false;
    var cols = state.cameras.columns || 3;
    if (code === 37 || code === 39) {
      state.cameras.index = U.clamp(state.cameras.index + (code === 39 ? 1 : -1), 0, list.length - 1);
      renderCameras();
      return true;
    }
    if (code === 38 || code === 40) {
      state.cameras.index = U.clamp(state.cameras.index + (code === 40 ? cols : -cols), 0, list.length - 1);
      renderCameras();
      return true;
    }
    if (code === 13) {
      openCameraLive(state.cameras.index);
      return true;
    }
    return false;
  }

  function cameraLiveKey(code) {
    if (code === 10009 || code === 27) {
      closeCameraLive();
      return true;
    }
    if (code === 458) {
      // Guide is handled by the main app; stop the native player first.
      stopLive();
      return false;
    }
    if (code === 427 || code === 428) {
      var list = A.HA.cameras();
      if (!list.length) return true;
      var delta = code === 428 ? 1 : -1;
      var next = (state.live.index + delta + list.length) % list.length;
      openCameraLive(next);
      return true;
    }
    return false;
  }

  /* ---------- public API ---------- */

  function handleKey(code) {
    if (A.UI.modalOpen()) return false;
    var screen = A.App && A.App.state ? A.App.state.screen : '';
    if (screen === 'ha') return haKey(code);
    if (screen === 'ha-detail') return detailKey(code);
    if (screen === 'ha-browser') return browserKey(code);
    if (screen === 'ha-pages') return pagesKey(code);
    if (screen === 'music') return musicKey(code);
    if (screen === 'music-browse') return musicBrowseKey(code);
    if (screen === 'cameras') return camerasKey(code);
    if (screen === 'camera-live') return cameraLiveKey(code);
    return false;
  }

  function onHAChange() {
    if (!A.App || !A.App.state) return;
    var screen = A.App.state.screen;
    if (screen === 'ha-detail') {
      renderDetail();
    } else if (screen === 'ha' || screen === 'cameras' || screen === 'music') {
      scheduleRender();
    } else if (screen === 'ha-browser') {
      var b = state.browser;
      if (b.areaId) {
        currentAreaEntities().forEach(function (item) {
          var ent = A.HA.states ? A.HA.states[item.id] : null;
          item.name = entityName(item.id, ent);
          item.state = ent ? ent.state : 'unavailable';
        });
      }
      renderBrowser();
    }
  }

  function onConfigChange() {
    if (!A.App || !A.App.state) return;
    var screen = A.App.state.screen;
    if (screen === 'ha') render();
    else if (screen === 'ha-detail') renderDetail();
    else if (screen === 'ha-pages') renderPages();
    else if (screen === 'ha-browser') renderBrowser();
    else if (screen === 'music') renderMusic();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    var screen = A.App && A.App.state ? A.App.state.screen : '';
    if (screen === 'camera-live') stopLive();
  });

  A.HANative = {
    open: open,
    openMusic: openMusic,
    tickMusic: tickMusic,
    openCameras: openCameras,
    handleKey: handleKey,
    handleKeyUp: handleKeyUp,
    toggleEntity: toggleEntity,
    openDetailForEntity: openDetailForEntity,
    onHAChange: onHAChange,
    onConfigChange: onConfigChange,
    stopLive: stopLive
  };
})(window.Aurora = window.Aurora || {});
