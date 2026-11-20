/* Aurora — rendering, focus and overlay helpers. */
(function (A) {
  'use strict';

  var U = A.Util;
  var focused = null;
  var modal = null;
  var editor = null;
  var editorBound = false;

  var ICONS = {
    hdmi: '<path d="M4 9.5h16v4.2a2.3 2.3 0 0 1-2.3 2.3H6.3A2.3 2.3 0 0 1 4 13.7V9.5Z"/><path d="M8 9.5V6.8h8v2.7"/><path d="M8.5 16v1.6M12 16v1.6M15.5 16v1.6"/>',
    tv: '<rect x="3" y="5.5" width="18" height="12" rx="2.2"/><path d="M8.5 21h7M12 17.5V21"/>',
    guide: '<rect x="3.2" y="5" width="17.6" height="15.5" rx="2.2"/><path d="M3.2 9.7h17.6M8.6 9.7v10.8M3.2 14.8h17.6"/>',
    home: '<path d="M4 11.2 12 4l8 7.2v8.3a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19.5v-8.3Z"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9M4 12h5M13 12h7"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/><circle cx="11" cy="12" r="2"/>',
    camera: '<path d="M3.5 8.5h3l1.6-2.2h7.8l1.6 2.2h3v10h-17z"/><circle cx="12" cy="13.5" r="3.1"/>',
    music: '<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    gear: '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.2a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06A2 2 0 1 1 3.14 15.9l.06-.06a1.7 1.7 0 0 0 .34-1.87A1.7 1.7 0 0 0 2 12.94H2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 6.1 3.14l.06.06a1.7 1.7 0 0 0 1.87.34H8.1A1.7 1.7 0 0 0 9.13 2V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06A2 2 0 1 1 18.9 6.1l-.06.06a1.7 1.7 0 0 0-.34 1.87v.04A1.7 1.7 0 0 0 20 9.13h.04a2 2 0 1 1 0 4H20a1.7 1.7 0 0 0-1.56 1.07Z"/>',
    play: '<path d="M8 5.2v13.6L19 12 8 5.2Z"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    check: '<path d="m4.5 12.5 5 5L19.5 7"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    bulb: '<path d="M9.2 18h5.6M10.2 21h3.6M12 3a6.2 6.2 0 0 0-3.6 11.2c.6.5 1 1.2 1 2V17h5.2v-.8c0-.8.4-1.5 1-2A6.2 6.2 0 0 0 12 3Z"/>',
    motion: '<path d="M3 12h2.4l2.2-6 3.2 12 2.4-8 1.6 4H21"/>',
    bolt: '<path d="M13 2 4.5 13.5H10l-1 8.5 8.5-11.5H12l1-8.5Z"/>',
    wifi: '<path d="M2.5 8.5a14 14 0 0 1 19 0M5.5 12a9.5 9.5 0 0 1 13 0M8.6 15.4a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    dashboard: '<rect x="3.2" y="3.2" width="7.5" height="7.5" rx="1.6"/><rect x="13.3" y="3.2" width="7.5" height="4.6" rx="1.6"/><rect x="3.2" y="13.3" width="7.5" height="7.5" rx="1.6"/><rect x="13.3" y="10.4" width="7.5" height="10.4" rx="1.6"/>'
  };

  function icon(name, extraClass) {
    var body = ICONS[name] || ICONS.info;
    return '<svg class="ico ' + (extraClass || '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + body + '</svg>';
  }

  function qs(sel) { return document.querySelector(sel); }

  function showScreen(name) {
    U.$$('.screen').forEach(function (screen) {
      screen.classList.toggle('active', screen.id === 'screen-' + name);
    });
    document.body.setAttribute('data-screen', name);
    if (name !== 'home') document.body.classList.remove('input-backdrop');
  }

  function focusElement(element, options) {
    options = options || {};
    if (focused === element) return;
    if (focused) focused.classList.remove('focused');
    focused = element;
    if (!element) return;
    element.classList.add('focused');
    if (options.scroll !== false) {
      try {
        element.scrollIntoView({ behavior: options.smooth ? 'smooth' : 'auto', block: 'nearest', inline: 'center' });
      } catch (e) {
        try { element.scrollIntoView(); } catch (err) { /* ignore */ }
      }
    }
  }

  function clearFocus() {
    if (focused) focused.classList.remove('focused');
    focused = null;
  }

  function greeting(date) {
    var hour = (date || new Date()).getHours();
    if (hour < 5) return 'Good night.';
    if (hour < 12) return 'Good morning.';
    if (hour < 18) return 'Good afternoon.';
    return 'Good evening.';
  }

  function renderHome(model) {
    var home = qs('#screen-home');
    if (!home) return;

    home.querySelector('#home-date').textContent = U.fmtDate(model.now || new Date()).toUpperCase();
    home.querySelector('#home-title').textContent = greeting(model.now);
    home.querySelector('#home-sub').textContent = model.subtitle || '';

    var rail = home.querySelector('#tile-rail');
    rail.innerHTML = (model.tiles || []).map(function (tile) {
      return '<button class="tile a-' + U.esc(tile.accent || 'blue') + '" data-tile="' + U.esc(tile.id) + '" ' +
        (tile.active ? 'data-active="true" ' : '') +
        'aria-label="' + U.esc(tile.label + (tile.active ? ' — current input' : '')) + '">' +
        '<span class="tile-glow"></span>' +
        '<span class="tile-top">' +
        '<span class="tile-ico">' + icon(tile.icon) + '</span>' +
        '<span class="tile-kind">' +
        (tile.active ? '<span class="tile-active" title="Current input" aria-hidden="true"></span>' : '') +
        U.esc(tile.kind || '') + '</span>' +
        '</span>' +
        (tile.badge ? '<span class="tile-badge">' + U.esc(tile.badge) + '</span>' : '') +
        '<span class="tile-bottom">' +
        '<span class="tile-name">' + U.esc(tile.label) + '</span>' +
        '<span class="tile-meta">' + U.esc(tile.sub || '') + '</span>' +
        '</span>' +
        '</button>';
    }).join('');

    U.$$('#tile-rail .tile').forEach(function (node) {
      node.addEventListener('click', function () {
        if (typeof model.onTile === 'function') model.onTile(node.getAttribute('data-tile'));
      });
      node.addEventListener('mouseenter', function () {
        focusElement(node, { scroll: false });
        if (typeof model.onHover === 'function') model.onHover(node.getAttribute('data-tile'));
      });
    });

    renderSensors(model.sensors || {});
    renderStatus(model.status || {});
    updateClock(model.now || new Date());
    applyFocus(model.focusId);
  }

  function applyFocus(id, scroll) {
    if (!id) return;
    var node = qs('#tile-rail .tile[data-tile="' + id + '"]');
    if (node) focusElement(node, { scroll: !!scroll });
  }

  function renderSensors(sensors) {
    var strip = qs('#sensor-strip');
    if (!strip) return;
    var items = [];

    if (sensors.light) {
      var light = sensors.light;
      var isOn = light.state === 'on';
      var brightness = light.brightness != null ? Math.round((light.brightness / 255) * 100) + '%' : '';
      items.push({
        icon: 'bulb',
        label: light.name || 'Light',
        value: light.state === 'unavailable' ? 'Unavailable' : (isOn ? ('On' + (brightness ? ' · ' + brightness : '')) : 'Off'),
        on: isOn
      });
    }
    if (sensors.power) {
      var power = sensors.power;
      var unit = power.unit || '';
      var value = power.state === 'unavailable' ? 'Unavailable' : (power.state + (unit ? ' ' + unit : ''));
      items.push({ icon: 'bolt', label: power.name || 'Power', value: value, on: power.state !== 'unavailable' });
    }

    if (!items.length) {
      strip.innerHTML = '<div class="sensor sensor-empty">' +
        '<span class="sensor-ico">' + icon('home') + '</span>' +
        '<span class="sensor-text"><b>Home Assistant</b><small>Connect a dashboard to see sensors</small></span>' +
        '</div>';
      return;
    }

    strip.innerHTML = items.slice(0, 4).map(function (item) {
      return '<div class="sensor' + (item.on ? ' on' : '') + '">' +
        '<span class="sensor-ico">' + icon(item.icon) + '</span>' +
        '<span class="sensor-text"><b>' + U.esc(item.label) + '</b><small>' + U.esc(item.value) + '</small></span>' +
        '</div>';
    }).join('');
  }

  function renderStatus(status) {
    var node = qs('#status-ha');
    if (!node) return;
    var value = (status && status.ha) || {};
    node.className = 'status' + (value.ok ? ' ok' : (value.error ? ' error' : ''));
    node.setAttribute('title', value.title || value.label || 'Home Assistant');
    node.querySelector('.status-label').textContent = value.label || 'HA';
  }

  function updateClock(now) {
    var timeEl = qs('#clock-time');
    var dateEl = qs('#clock-date');
    if (!timeEl) return;
    timeEl.textContent = U.fmtTime(now);
    dateEl.textContent = U.fmtDate(now);
  }

  function renderGuide(model) {
    var screen = qs('#screen-guide');
    if (!screen) return;
    screen.querySelector('#guide-date').textContent = U.fmtDate(model.now).toUpperCase();
    screen.querySelector('#guide-window').textContent = model.windowLabel || '';
    var badge = screen.querySelector('#guide-source');
    badge.textContent = model.sourceLabel || '';
    badge.className = 'guide-badge' + (model.source === 'demo' ? ' demo' : '');

    var err = screen.querySelector('#guide-error');
    if (model.error) {
      err.hidden = false;
      err.textContent = model.error;
    } else {
      err.hidden = true;
    }

    var start = model.start;
    var end = model.end;
    var span = end - start;

    var ruler = screen.querySelector('#guide-ruler-track');
    var ticks = [];
    var tick = new Date(start);
    tick.setMinutes(Math.ceil(tick.getMinutes() / 30) * 30, 0, 0);
    while (tick.getTime() < end) {
      var left = ((tick.getTime() - start) / span) * 100;
      ticks.push('<span class="ruler-tick" style="left:' + left.toFixed(3) + '%">' + U.fmtTime(tick) + '</span>');
      tick = new Date(tick.getTime() + 30 * 60000);
    }
    ruler.innerHTML = ticks.join('');

    var nowLeft = ((model.now.getTime() - start) / span) * 100;
    var nowHtml = nowLeft >= 0 && nowLeft <= 100
      ? '<span class="row-now" style="left:' + nowLeft.toFixed(3) + '%"></span>' : '';

    var rows = screen.querySelector('#guide-rows');
    rows.innerHTML = model.channels.map(function (channel, channelIndex) {
      var blocks = model.programs[channel.id] || [];
      var blocksHtml = '';
      blocks.forEach(function (program) {
        var visibleStart = Math.max(program.start, start);
        var visibleStop = Math.min(program.stop, end);
        var left = ((visibleStart - start) / span) * 100;
        var width = ((visibleStop - visibleStart) / span) * 100;
        if (width <= 0.2) return;
        var isNow = program.start <= model.now.getTime() && program.stop > model.now.getTime();
        blocksHtml += '<button class="program' + (isNow ? ' now' : '') + '" ' +
          'data-channel="' + U.esc(channel.id) + '" data-start="' + program.start + '" ' +
          'data-index="' + channelIndex + '" ' +
          'style="left:' + left.toFixed(3) + '%;width:' + width.toFixed(3) + '%" ' +
          'title="' + U.esc(program.title) + '">' +
          '<span class="program-title">' + U.esc(program.title) + '</span>' +
          '<span class="program-time">' + U.fmtTime(program.start) + ' – ' + U.fmtTime(program.stop) + '</span>' +
          '</button>';
      });
      return '<div class="guide-row" data-channel="' + U.esc(channel.id) + '">' +
        '<div class="guide-channel">' +
        '<span class="channel-number">' + U.esc(channel.number) + '</span>' +
        '<span class="channel-name">' + U.esc(channel.name) + '</span>' +
        '</div>' +
        '<div class="guide-track">' + blocksHtml + nowHtml + '</div>' +
        '</div>';
    }).join('');

    if (!model.channels.length) {
      rows.innerHTML = '<div class="guide-empty">No channels in the guide. Configure an XMLTV URL or enable demo data.</div>';
    }

    U.$$('#guide-rows .program').forEach(function (node) {
      node.addEventListener('click', function () {
        if (typeof model.onSelect === 'function') {
          model.onSelect(node.getAttribute('data-channel'), Number(node.getAttribute('data-start')));
        }
      });
      node.addEventListener('mouseenter', function () {
        focusElement(node, { scroll: false });
        if (typeof model.onHover === 'function') {
          model.onHover(node.getAttribute('data-channel'), Number(node.getAttribute('data-start')));
        }
      });
    });

    var footer = screen.querySelector('#guide-detail');
    renderGuideDetail(model.detail, model.hint);
  }

  function renderGuideDetail(detail, hint) {
    var footer = document.querySelector('#guide-detail');
    if (!footer) return;
    if (detail) {
      footer.innerHTML = '<div class="detail-text">' +
        '<div class="detail-head"><span class="detail-channel">' + U.esc(detail.channelName) + '</span>' +
        '<span class="detail-time">' + U.esc(detail.time) + '</span></div>' +
        '<h3>' + U.esc(detail.title) + '</h3>' +
        '<p>' + U.esc(detail.desc || 'No description available.') + '</p>' +
        '</div>' +
        '<div class="detail-action">' + (detail.canTune ? 'OK to watch' : '') + '</div>';
    } else {
      footer.innerHTML = '<div class="detail-text"><h3>' + U.esc(hint || 'Browse the guide') + '</h3>' +
        '<p>Use the arrow keys to move between channels and programmes.</p></div>';
    }
  }

  function setGuideFocus(channelId, start) {
    var node = null;
    U.$$('#guide-rows .program').forEach(function (item) {
      if (!node && item.getAttribute('data-channel') === channelId &&
          Number(item.getAttribute('data-start')) === Number(start)) {
        node = item;
      }
    });
    if (node) {
      focusElement(node, { scroll: true });
      node.classList.add('guide-focus');
    }
    U.$$('#guide-rows .program.guide-focus').forEach(function (el2) {
      if (el2 !== node) el2.classList.remove('guide-focus');
    });
    return node;
  }

  function renderSettings(model) {
    var screen = qs('#screen-settings');
    if (!screen) return;
    var list = screen.querySelector('#settings-list');
    var focusIndex = -1;
    var html = '';
    (model.rows || []).forEach(function (row) {
      if (row.section) {
        html += '<div class="setting-section">' + U.esc(row.section) + '</div>';
        return;
      }
      focusIndex++;
      var valueHtml = '';
      if (row.kind === 'toggle') {
        valueHtml = '<span class="toggle ' + (row.value ? 'on' : '') + '"><span></span></span>';
      } else if (row.kind === 'action') {
        valueHtml = '<span class="setting-action">' + U.esc(row.actionLabel || 'Open') + '</span>';
      } else {
        valueHtml = '<span class="setting-text' + (row.muted ? ' muted' : '') + '">' + U.esc(row.value == null ? '' : row.value) + '</span>' +
          '<span class="setting-chevron">' + icon('chevron') + '</span>';
      }
      html += '<div class="setting-row' + (row.kind === 'action' ? ' action' : '') + (row.danger ? ' danger' : '') +
        (focusIndex === model.focusIndex ? ' focused' : '') + '" data-setting="' + focusIndex + '" data-id="' + U.esc(row.id) + '">' +
        '<div class="setting-label-wrap"><span class="setting-label">' + U.esc(row.label) + '</span>' +
        (row.hint ? '<span class="setting-hint">' + U.esc(row.hint) + '</span>' : '') + '</div>' +
        '<div class="setting-value">' + valueHtml + '</div>' +
        '</div>';
    });
    list.innerHTML = html;

    U.$$('#settings-list .setting-row').forEach(function (node) {
      node.addEventListener('click', function () {
        if (typeof model.onActivate === 'function') model.onActivate(Number(node.getAttribute('data-setting')));
      });
      node.addEventListener('mouseenter', function () {
        focusElement(node, { scroll: false });
        if (typeof model.onHover === 'function') model.onHover(Number(node.getAttribute('data-setting')));
      });
    });

    var active = list.querySelector('.setting-row.focused');
    var scroll = screen.querySelector('.settings-scroll');
    if (active && scroll) {
      var rowRect = active.getBoundingClientRect();
      var boxRect = scroll.getBoundingClientRect();
      var padding = 18;
      if (rowRect.bottom > boxRect.bottom - padding) {
        scroll.scrollTop += rowRect.bottom - boxRect.bottom + padding;
      } else if (rowRect.top < boxRect.top + padding) {
        scroll.scrollTop -= boxRect.top - rowRect.top + padding;
      }
    }
    screen.querySelector('#settings-saved').textContent = model.savedLabel || '';
  }

  function showHA(url, title) {
    var frame = qs('#ha-frame');
    if (frame && frame.getAttribute('src') !== url) frame.setAttribute('src', url);
    var name = qs('#ha-title');
    if (name) name.textContent = title || 'Home Assistant';
    showScreen('ha');
  }

  function setHACountdown(remainingMs, active) {
    var node = qs('#ha-countdown');
    if (!node) return;
    if (!active) {
      node.hidden = true;
      document.body.classList.remove('ha-temp');
      return;
    }
    node.hidden = false;
    document.body.classList.add('ha-temp');
    node.innerHTML = '<span class="countdown-dot"></span>Returns in ' + U.fmtDuration(remainingMs);
  }

  function setHAOverlay(visible) {
    var overlay = qs('#ha-overlay');
    if (overlay) overlay.classList.toggle('dim', !visible);
  }

  function toast(message, kind, ms) {
    var host = qs('#toast-host');
    if (!host) return;
    var node = U.el('div', { 'class': 'toast ' + (kind || '') });
    node.innerHTML = '<span class="toast-icon">' + icon(kind === 'error' ? 'info' : (kind === 'ok' ? 'check' : 'info')) + '</span>' +
      '<span>' + U.esc(message) + '</span>';
    host.appendChild(node);
    setTimeout(function () { node.classList.add('leaving'); }, ms || 3200);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, (ms || 3200) + 400);
    while (host.children.length > 3) host.removeChild(host.firstChild);
  }

  function modalOpen() {
    return !!modal;
  }

  function closeModal(result) {
    if (!modal) return;
    var current = modal;
    modal = null;
    document.body.classList.remove('modal-open');
    if (current.root && current.root.parentNode) current.root.parentNode.removeChild(current.root);
    if (current.resolve) current.resolve(result);
  }

  function setAppScreen(name) {
    if (A.App && A.App.state) A.App.state.screen = name;
  }

  function finishEditor(value) {
    if (!editor) return;
    var current = editor;
    editor = null;
    var input = qs('#editor-input');
    if (input) {
      try { input.blur(); } catch (e) { /* ignore */ }
    }
    showScreen(current.previous);
    setAppScreen(current.previous);
    current.resolve(value);
  }

  function bindEditor() {
    if (editorBound) return;
    editorBound = true;
    var input = qs('#editor-input');
    var cancel = qs('#editor-cancel');
    var save = qs('#editor-save');
    if (!input || !cancel || !save) return;
    input.addEventListener('keydown', function (event) {
      var code = event.keyCode;
      if (code === 13) {
        event.preventDefault();
        event.stopPropagation();
        finishEditor(input.value);
        return;
      }
      if (code === 40 || code === 27 || code === 10009) {
        event.preventDefault();
        event.stopPropagation();
        try { input.blur(); } catch (e) { /* ignore */ }
        try { cancel.focus(); } catch (e) { /* ignore */ }
      }
    });
    cancel.addEventListener('click', function () { finishEditor(null); });
    save.addEventListener('click', function () { finishEditor(input.value); });
  }

  function openEditor(options) {
    options = options || {};
    if (editor) finishEditor(null);
    bindEditor();
    var previous = options.returnScreen || (A.App && A.App.state ? A.App.state.screen : 'settings') || 'settings';
    var title = qs('#editor-title');
    var eyebrow = qs('#editor-eyebrow');
    var label = qs('#editor-label');
    var hint = qs('#editor-hint');
    var input = qs('#editor-input');
    if (title) title.textContent = options.title || 'Edit setting';
    if (eyebrow) eyebrow.textContent = options.eyebrow || 'EDIT';
    if (label) label.textContent = options.label || '';
    if (hint) hint.textContent = options.hint || '';
    if (input) {
      input.type = options.numeric ? 'number' : (options.secret ? 'password' : 'text');
      input.value = options.value == null ? '' : String(options.value);
      input.placeholder = options.placeholder || '';
      input.setAttribute('autocomplete', 'off');
    }
    showScreen('editor');
    setAppScreen('editor');
    return new Promise(function (resolve) {
      editor = { resolve: resolve, previous: previous };
      setTimeout(function () {
        try {
          input.focus();
          input.select();
        } catch (e) { /* ignore */ }
      }, 80);
    });
  }

  function editorKey(code) {
    if (!editor) return false;
    var input = qs('#editor-input');
    var cancel = qs('#editor-cancel');
    var save = qs('#editor-save');
    var active = document.activeElement;
    if (active === input) {
      if (code === 40 || code === 27 || code === 10009) {
        try { input.blur(); } catch (e) { /* ignore */ }
        try { cancel.focus(); } catch (e) { /* ignore */ }
        return true;
      }
      if (code === 13) {
        finishEditor(input.value);
        return true;
      }
      return false;
    }
    if (code === 37 || code === 39) {
      try { (active === cancel ? save : cancel).focus(); } catch (e) { /* ignore */ }
      return true;
    }
    if (code === 38) {
      try { input.focus(); } catch (e) { /* ignore */ }
      return true;
    }
    if (code === 13) {
      if (active === save) finishEditor(input.value);
      else if (active === cancel) finishEditor(null);
      return true;
    }
    if (code === 27 || code === 10009) {
      finishEditor(null);
      return true;
    }
    return false;
  }

  function prompt(options) {
    options = options || {};
    closeModal(null);
    return new Promise(function (resolve) {
      var root = U.el('div', { 'class': 'modal-backdrop' });
      var secret = !!options.secret;
      root.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h2>' + U.esc(options.title || 'Edit') + '</h2>' +
        '<p>' + U.esc(options.hint || 'Press Back or Down for Cancel / Save.') + '</p></div>' +
        '<label class="modal-label">' + U.esc(options.label || '') + '</label>' +
        '<input id="modal-input" class="modal-input" type="' + (secret ? 'password' : (options.numeric ? 'number' : 'text')) + '" ' +
        'autocomplete="off" autocapitalize="off" spellcheck="false" value="' + U.esc(options.value == null ? '' : options.value) + '" ' +
        'placeholder="' + U.esc(options.placeholder || '') + '">' +
        '<div class="modal-actions">' +
        '<button class="btn ghost" id="modal-cancel">Cancel</button>' +
        '<button class="btn primary" id="modal-save">Save</button>' +
        '</div></div>';
      document.body.appendChild(root);
      document.body.classList.add('modal-open');
      modal = { root: root, resolve: resolve };

      var input = root.querySelector('#modal-input');
      var cancelButton = root.querySelector('#modal-cancel');
      var saveButton = root.querySelector('#modal-save');
      setTimeout(function () {
        try { input.focus(); } catch (e) { /* ignore */ }
      }, 60);

      var finish = function (value) { closeModal(value); };
      var focusInput = function () {
        try { input.focus(); } catch (e) { /* ignore */ }
      };
      var focusAction = function (button) {
        try {
          input.blur();
          button.focus();
        } catch (e) { /* ignore */ }
      };
      saveButton.addEventListener('click', function () { finish(input.value); });
      cancelButton.addEventListener('click', function () { finish(null); });
      root.addEventListener('mousedown', function (event) {
        if (event.target === root) finish(null);
      });

      /* The TV on-screen keyboard owns the arrow keys while the input is
         focused. Back is the reliable way out: the first press closes the
         keyboard and selects Cancel; Left/Right then move between the
         buttons, Up returns to the text field, and Enter activates. */
      /* If the TV keyboard closes by itself (Back or its Done key), move the
         focus to the actions so the user is not stranded in the text field. */
      input.addEventListener('blur', function () {
        setTimeout(function () {
          if (!root.parentNode) return;
          if (document.activeElement === document.body || document.activeElement == null) {
            focusAction(cancelButton);
          }
        }, 80);
      });

      input.addEventListener('keydown', function (event) {
        var code = event.keyCode;
        if (code === 40) {
          event.preventDefault();
          event.stopPropagation();
          focusAction(cancelButton);
          return;
        }
        if (code === 13) {
          event.preventDefault();
          event.stopPropagation();
          finish(input.value);
          return;
        }
        if (code === 27 || code === 10009) {
          event.preventDefault();
          event.stopPropagation();
          focusAction(cancelButton);
        }
      });

      root.addEventListener('keydown', function (event) {
        var code = event.keyCode;
        var active = document.activeElement;
        if (active === input) return;
        if (code === 37 || code === 39) {
          event.preventDefault();
          event.stopPropagation();
          focusAction(active === cancelButton ? saveButton : cancelButton);
          return;
        }
        if (code === 38) {
          event.preventDefault();
          event.stopPropagation();
          focusInput();
          return;
        }
        if (code === 13) {
          event.preventDefault();
          event.stopPropagation();
          if (active === saveButton) finish(input.value);
          else if (active === cancelButton) finish(null);
          return;
        }
        if (code === 27 || code === 10009) {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
          return;
        }
        event.stopPropagation();
      });
    });
  }

  function confirm(options) {
    options = options || {};
    closeModal(false);
    return new Promise(function (resolve) {
      var root = U.el('div', { 'class': 'modal-backdrop' });
      root.innerHTML = '<div class="modal small" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h2>' + U.esc(options.title || 'Are you sure?') + '</h2>' +
        '<p>' + U.esc(options.message || '') + '</p></div>' +
        '<div class="modal-actions">' +
        '<button class="btn ghost" id="modal-cancel">' + U.esc(options.cancelLabel || 'Cancel') + '</button>' +
        '<button class="btn primary' + (options.danger ? ' danger' : '') + '" id="modal-save">' + U.esc(options.okLabel || 'Confirm') + '</button>' +
        '</div></div>';
      document.body.appendChild(root);
      document.body.classList.add('modal-open');
      modal = { root: root, resolve: resolve };
      root.addEventListener('keydown', function (event) { event.stopPropagation(); });
      var save = root.querySelector('#modal-save');
      setTimeout(function () {
        try { save.focus(); } catch (e) { /* ignore */ }
      }, 60);
      root.querySelector('#modal-save').addEventListener('click', function () { closeModal(true); });
      root.querySelector('#modal-cancel').addEventListener('click', function () { closeModal(false); });
      root.addEventListener('mousedown', function (event) {
        if (event.target === root) closeModal(false);
      });
      root.addEventListener('keydown', function (event) {
        if (event.keyCode === 27 || event.keyCode === 10009) {
          event.preventDefault();
          event.stopPropagation();
          closeModal(false);
        } else if (event.keyCode === 13) {
          event.preventDefault();
          closeModal(true);
        }
      });
    });
  }

  function infoPanel(title, lines) {
    closeModal(null);
    return new Promise(function (resolve) {
      var root = U.el('div', { 'class': 'modal-backdrop' });
      var body = lines.map(function (line) {
        if (typeof line === 'string') return '<div class="info-line">' + U.esc(line) + '</div>';
        return '<div class="info-line"><b>' + U.esc(line[0]) + '</b><span>' + U.esc(line[1]) + '</span></div>';
      }).join('');
      root.innerHTML = '<div class="modal wide" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h2>' + U.esc(title) + '</h2></div>' +
        '<div class="info-body">' + body + '</div>' +
        '<div class="modal-actions"><button class="btn primary" id="modal-close">Close</button></div></div>';
      document.body.appendChild(root);
      document.body.classList.add('modal-open');
      modal = { root: root, resolve: resolve };
      root.addEventListener('keydown', function (event) { event.stopPropagation(); });
      var close = root.querySelector('#modal-close');
      setTimeout(function () { try { close.focus(); } catch (e) { /* ignore */ } }, 60);
      close.addEventListener('click', function () { closeModal(true); });
      root.addEventListener('keydown', function (event) {
        if (event.keyCode === 27 || event.keyCode === 10009 || event.keyCode === 13) {
          event.preventDefault();
          closeModal(true);
        }
      });
      root.addEventListener('mousedown', function (event) {
        if (event.target === root) closeModal(true);
      });
    });
  }

  function showSetupQR(options) {
    var overlay = qs('#setup-overlay');
    if (!overlay) return;
    var qrHost = qs('#setup-qr');
    var url = options && options.url ? options.url : '';
    var token = options && options.token ? options.token : '';
    qs('#setup-url').textContent = url;
    qs('#setup-token').textContent = token || '—';
    if (typeof qrcode === 'function' && url) {
      try {
        var qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        qrHost.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 4 });
      } catch (e) {
        qrHost.textContent = url;
        qrHost.style.color = '#111';
        qrHost.style.fontSize = '12px';
      }
    } else {
      qrHost.textContent = url;
    }
    overlay.hidden = false;
    document.body.classList.add('setup-open');
  }

  function hideSetupQR() {
    var overlay = qs('#setup-overlay');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('setup-open');
  }

  function setupOpen() {
    var overlay = qs('#setup-overlay');
    return !!overlay && !overlay.hidden;
  }

  A.UI = {
    icon: icon,
    showScreen: showScreen,
    focusElement: focusElement,
    clearFocus: clearFocus,
    greeting: greeting,
    renderHome: renderHome,
    applyFocus: applyFocus,
    renderSensors: renderSensors,
    renderStatus: renderStatus,
    updateClock: updateClock,
    renderGuide: renderGuide,
    renderGuideDetail: renderGuideDetail,
    setGuideFocus: setGuideFocus,
    renderSettings: renderSettings,
    showHA: showHA,
    setHACountdown: setHACountdown,
    setHAOverlay: setHAOverlay,
    toast: toast,
    prompt: prompt,
    editor: openEditor,
    editorKey: editorKey,
    confirm: confirm,
    infoPanel: infoPanel,
    showSetupQR: showSetupQR,
    hideSetupQR: hideSetupQR,
    setupOpen: setupOpen,
    modalOpen: modalOpen,
    closeModal: closeModal,
  };
})(window.Aurora = window.Aurora || {});
