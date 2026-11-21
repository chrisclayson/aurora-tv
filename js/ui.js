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
    pause: '<path d="M9 5v14M15 5v14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    next: '<path d="m6 5 8 7-8 7V5Z"/><path d="M18 5v14"/>',
    previous: '<path d="m18 5-8 7 8 7V5Z"/><path d="M6 5v14"/>',
    volume: '<path d="M4 9.5h4L13 5v14L8 14.5H4v-5Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18h1.4a2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="10" r="1" fill="currentColor" stroke="none"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    check: '<path d="m4.5 12.5 5 5L19.5 7"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    bulb: '<path d="M9.2 18h5.6M10.2 21h3.6M12 3a6.2 6.2 0 0 0-3.6 11.2c.6.5 1 1.2 1 2V17h5.2v-.8c0-.8.4-1.5 1-2A6.2 6.2 0 0 0 12 3Z"/>',
    motion: '<path d="M3 12h2.4l2.2-6 3.2 12 2.4-8 1.6 4H21"/>',
    bolt: '<path d="M13 2 4.5 13.5H10l-1 8.5 8.5-11.5H12l1-8.5Z"/>',
    wifi: '<path d="M2.5 8.5a14 14 0 0 1 19 0M5.5 12a9.5 9.5 0 0 1 13 0M8.6 15.4a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none"/>',
    thermometer: '<path d="M10 14.5V5.5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
    cloud: '<path d="M7.5 18h9a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.3A3.5 3.5 0 0 0 7.5 18Z"/>',
    partly: '<path d="M8 17.5h8.5a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.2 1.1A3 3 0 0 0 8 17.5Z"/><path d="M17.5 3.5v1.5M21 7h1.5M20.2 4.8l1 1M14.8 4.8l-1 1M12 7h-1.5"/>',
    rain: '<path d="M7.5 16.5h9a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.2A3.4 3.4 0 0 0 7.5 16.5Z"/><path d="M8 19v2M12 19v2M16 19v2"/>',
    snow: '<path d="M7.5 16.5h9a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.2A3.4 3.4 0 0 0 7.5 16.5Z"/><path d="M8.5 20h.01M12 21h.01M15.5 20h.01"/>',
    storm: '<path d="M7.5 16.5h9a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.2A3.4 3.4 0 0 0 7.5 16.5Z"/><path d="m12.5 16-2 4h2.5l-1 3"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    dashboard: '<rect x="3.2" y="3.2" width="7.5" height="7.5" rx="1.6"/><rect x="13.3" y="3.2" width="7.5" height="4.6" rx="1.6"/><rect x="3.2" y="13.3" width="7.5" height="7.5" rx="1.6"/><rect x="13.3" y="10.4" width="7.5" height="10.4" rx="1.6"/>',
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z"/><path d="M10.3 19a2 2 0 0 0 3.4 0"/>',
    apps: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
    flame: '<path d="M12 3.2c1.2 4.2-3.6 5.7-3.6 9.3a3.6 3.6 0 0 0 7.2 0c0-1.1-.4-2.1-1.1-3.1-.2 1.4-1.1 2.1-2 2.1-1.3 0-2-1-1.8-2.4.2-1.4 1.4-2.4 1.3-5.9Z"/><path d="M8.2 17.8a5.4 5.4 0 0 0 7.6 0"/>'
  };

  function icon(name, extraClass) {
    var body = ICONS[name] || ICONS.info;
    return '<svg class="ico ' + (extraClass || '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + body + '</svg>';
  }

  function iconUrl(path) {
    var value = String(path || '').trim();
    if (!value) return '';
    if (/^(https?:|data:|blob:|file:)/i.test(value)) return value;
    if (value.charAt(0) === '/') return 'file://' + value;
    return 'file:///' + value;
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

    var homeDate = U.fmtDate(model.now || new Date()).toUpperCase();
    if (model.festiveTag) homeDate += ' · ' + model.festiveTag;
    home.querySelector('#home-date').textContent = homeDate;
    home.querySelector('#home-title').textContent = model.greeting || greeting(model.now);
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

    var railWrap = home.querySelector('#rail-wrap');
    if (railWrap) railWrap.classList.toggle('apps-open', !!model.appsOpen);
    var appsRow = home.querySelector('#apps-row');
    var appRail = home.querySelector('#app-rail');
    if (appsRow) appsRow.hidden = !model.appsOpen;
    if (appRail) {
      appRail.innerHTML = !model.appsOpen ? '' : (model.apps || []).map(function (app) {
        var source = iconUrl(app.icon);
        return '<button type="button" class="app-tile" data-app="' + U.esc(app.id) + '" ' +
          'aria-label="Open ' + U.esc(app.name) + '">' +
          '<span class="app-tile-ico">' +
          '<span class="app-tile-glyph">' + icon(app.iconName || 'apps') + '</span>' +
          (source ? '<img class="app-tile-img" src="' + U.esc(source) + '" alt="">' : '') +
          '</span>' +
          '<span class="app-tile-name">' + U.esc(app.name) + '</span>' +
          '</button>';
      }).join('');
      U.$$('#app-rail .app-tile-img').forEach(function (img) {
        img.onerror = function () { this.style.display = 'none'; };
      });
      U.$$('#app-rail .app-tile').forEach(function (node) {
        node.addEventListener('click', function () {
          if (typeof model.onApp === 'function') model.onApp(node.getAttribute('data-app'));
        });
        node.addEventListener('mouseenter', function () {
          focusElement(node, { scroll: false });
          if (typeof model.onAppHover === 'function') model.onAppHover(node.getAttribute('data-app'));
        });
      });
    }

    renderSensors(model.sensors || {}, {
      focus: model.focusRegion === 'sensors' ? model.sensorIndex : -1,
      onSensor: model.onSensor,
      onHover: model.onSensorHover
    });
    renderStatus(model.status || {});
    renderWeather(model.weather || {});
    renderCalendar(model.calendar || {});
    updateClock(model.now || new Date());
    if (model.focusRegion === 'notifications') {
      var notify = home.querySelector('#home-notify');
      if (notify && !notify.hidden) focusElement(notify);
      else applyFocus(model.focusId);
    } else if (model.focusRegion === 'apps') {
      applyFocus(model.appFocusId, true, 'app');
    } else if (model.focusRegion === 'sensors') {
      applySensorFocus(model.sensorIndex, true);
    } else {
      applyFocus(model.focusId);
    }
  }

  function applyFocus(id, scroll, rail) {
    if (!id) return;
    var node = rail === 'app'
      ? qs('#app-rail .app-tile[data-app="' + id + '"]')
      : qs('#tile-rail .tile[data-tile="' + id + '"]');
    if (node) focusElement(node, { scroll: !!scroll });
  }

  function renderSensors(sensors, options) {
    options = options || {};
    var strip = qs('#sensor-strip');
    if (!strip) return;
    var items = [];

    if (sensors.climate && sensors.climate.current != null) {
      var climate = sensors.climate;
      var unit = climate.unit || '°C';
      var value = climate.current + unit;
      if (climate.target != null) value += ' → ' + climate.target + unit;
      var action = String(climate.action || '').toLowerCase();
      var status = '';
      var statusKind = '';
      if (climate.state === 'off') { status = 'Off'; statusKind = 'off'; }
      else if (action === 'idle') { status = 'Idle'; statusKind = 'idle'; }
      else if (action) { status = action.charAt(0).toUpperCase() + action.slice(1); statusKind = 'active'; }
      else if (climate.state === 'heat') { status = 'Heating'; statusKind = 'active'; }
      else if (climate.state === 'cool') { status = 'Cooling'; statusKind = 'active'; }
      else if (climate.state) { status = String(climate.state).charAt(0).toUpperCase() + String(climate.state).slice(1); statusKind = 'active'; }
      items.push({
        icon: 'thermometer',
        label: 'Temperature',
        value: value,
        status: status,
        statusKind: statusKind,
        on: climate.state !== 'off' && climate.state !== 'unavailable',
        kind: 'climate',
        entityId: climate.id
      });
    }

    if (sensors.light) {
      var light = sensors.light;
      var isOn = light.state === 'on';
      var brightness = light.brightness != null ? Math.round((light.brightness / 255) * 100) + '%' : '';
      items.push({
        icon: 'bulb',
        label: 'Lights',
        value: light.state === 'unavailable' ? 'Unavailable' : (isOn ? ('On' + (brightness ? ' · ' + brightness : '')) : 'Off'),
        status: '',
        statusKind: '',
        on: isOn,
        kind: 'light',
        entityId: light.id
      });
    }

    if (sensors.power) {
      var power = sensors.power;
      var powerUnit = power.unit || '';
      items.push({
        icon: 'bolt',
        label: 'Electricity Usage',
        value: power.state === 'unavailable' ? 'Unavailable' : (power.state + (powerUnit ? ' ' + powerUnit : '')),
        on: power.state !== 'unavailable',
        kind: 'power',
        entityId: power.id
      });
    }

    if (sensors.gas) {
      var gas = sensors.gas;
      var gasUnit = gas.unit || '';
      items.push({
        icon: 'flame',
        label: 'Gas Usage',
        value: gas.state === 'unavailable' ? 'Unavailable' : (gas.state + (gasUnit ? ' ' + gasUnit : '')),
        on: gas.state !== 'unavailable',
        kind: 'gas',
        entityId: gas.id
      });
    }

    if (!items.length) {
      strip.innerHTML = '<div class="sensor sensor-empty">' +
        '<span class="sensor-ico">' + icon('home') + '</span>' +
        '<span class="sensor-text"><b>Home Assistant</b><small>Connect a dashboard to see sensors</small></span>' +
        '</div>';
      return;
    }

    var focus = typeof options.focus === 'number' ? options.focus : -1;
    strip.innerHTML = items.slice(0, 4).map(function (item, index) {
      var cls = 'sensor' + (item.on ? ' on' : '') + (index === focus ? ' focused' : '');
      return '<button type="button" class="' + cls + '" data-sensor-index="' + index + '" ' +
        'aria-label="' + U.esc(item.label + ': ' + item.value + (item.status ? ', ' + item.status : '')) + '">' +
        '<span class="sensor-ico">' + icon(item.icon) + '</span>' +
        '<span class="sensor-text"><b>' + U.esc(item.label) + '</b><small>' + U.esc(item.value) + '</small></span>' +
        (item.status ? '<span class="sensor-status ' + U.esc(item.statusKind) + '">' + U.esc(item.status) + '</span>' : '') +
        '</button>';
    }).join('');

    U.$$('#sensor-strip .sensor[data-sensor-index]').forEach(function (node) {
      node.addEventListener('click', function () {
        if (typeof options.onSensor === 'function') options.onSensor(Number(node.getAttribute('data-sensor-index')));
      });
      node.addEventListener('mouseenter', function () {
        focusElement(node, { scroll: false });
        if (typeof options.onHover === 'function') options.onHover(Number(node.getAttribute('data-sensor-index')));
      });
    });
    if (focus >= 0) applySensorFocus(focus, false);
  }

  function applySensorFocus(index, scroll) {
    var node = qs('#sensor-strip .sensor[data-sensor-index="' + index + '"]');
    if (node) focusElement(node, { scroll: !!scroll });
  }

  function weatherIconName(condition) {
    var value = String(condition || '').toLowerCase();
    if (value === 'clear-night') return 'moon';
    if (value === 'sunny' || value === 'clear') return 'sun';
    if (value === 'partlycloudy') return 'partly';
    if (value === 'cloudy') return 'cloud';
    if (value === 'rainy' || value === 'pouring' || value === 'hail') return 'rain';
    if (value === 'snowy' || value === 'snowy-rainy') return 'snow';
    if (value === 'lightning' || value === 'lightning-rainy') return 'storm';
    if (value === 'fog') return 'fog';
    if (value === 'windy' || value === 'windy-variant') return 'wind';
    return 'cloud';
  }

  function renderWeather(weather) {
    var panel = qs('#home-weather');
    if (!panel) return;
    weather = weather || {};
    var forecast = weather.forecast || [];
    var slots = forecast.slice(0, 3);
    if (!slots.length && (weather.temperature != null || weather.condition)) {
      slots = [{ time: null, temperature: weather.temperature, condition: weather.condition, precipitation: null }];
    }
    if (!weather.available || !slots.length) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    panel.hidden = false;
    panel.innerHTML = slots.map(function (item) {
      var temperature = item.temperature != null && isFinite(Number(item.temperature))
        ? Math.round(Number(item.temperature)) + '°'
        : '—';
      var precipitation = item.precipitation != null && isFinite(Number(item.precipitation))
        ? Math.round(Number(item.precipitation)) + '%'
        : '—';
      var time = item.time ? U.fmtTime(item.time) : 'Now';
      return '<div class="weather-slot">' +
        '<span class="weather-time">' + U.esc(time) + '</span>' +
        '<span class="weather-symbol">' + icon(weatherIconName(item.condition || weather.condition)) + '</span>' +
        '<span class="weather-temp">' + U.esc(temperature) + '</span>' +
        '<span class="weather-rain">' + U.esc(precipitation) + '</span>' +
        '</div>';
    }).join('');
  }

  var CAL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function renderCalendar(calendar) {
    var panel = qs('#home-calendar');
    if (!panel) return;
    if (!calendar.available) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    panel.hidden = false;

    var now = new Date();
    var days = [];
    var i;
    for (i = 0; i < 3; i++) {
      var date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      days.push({
        date: date,
        label: i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : CAL_DAYS[date.getDay()] + ' ' + U.fmtDateShort(date)),
        events: []
      });
    }

    function dayIndex(date) {
      if (!(date instanceof Date) || isNaN(date.getTime())) return -1;
      for (var d = 0; d < days.length; d++) {
        if (days[d].date.getFullYear() === date.getFullYear() &&
            days[d].date.getMonth() === date.getMonth() &&
            days[d].date.getDate() === date.getDate()) return d;
      }
      return -1;
    }

    (calendar.events || []).forEach(function (event) {
      if (!event || !(event.start instanceof Date) || isNaN(event.start.getTime())) return;
      var index = dayIndex(event.start);
      if (index === -1 && event.start < days[0].date && event.end > days[0].date) index = 0;
      if (index === -1) return;
      days[index].events.push(event);
    });

    var count = 0;
    days.forEach(function (day) {
      day.events.sort(function (a, b) { return a.start - b.start; });
      count += day.events.length;
    });

    var html = '<div class="cal-head">' +
      '<span class="cal-kicker">NEXT 3 DAYS</span>' +
      '<span class="cal-count">' + (calendar.loading && !count ? '…' : count + (count === 1 ? ' event' : ' events')) + '</span>' +
      '</div>';

    if (!count && calendar.loading) {
      html += '<div class="cal-empty">Loading calendar…</div>';
    } else if (!count && calendar.error) {
      html += '<div class="cal-empty">Calendar unavailable</div>';
    } else if (!count) {
      html += '<div class="cal-empty">No upcoming events</div>';
    } else {
      html += '<div class="cal-days">' + days.map(function (day) {
        var rows = day.events.slice(0, 3).map(function (event) {
          var time = event.allDay ? 'All day' : U.fmtTime(event.start);
          var title = event.summary + (event.location ? ' — ' + event.location : '');
          return '<div class="cal-event' + (event.allDay ? ' allday' : '') + '">' +
            '<span class="cal-time">' + U.esc(time) + '</span>' +
            '<span class="cal-title" title="' + U.esc(title) + '">' + U.esc(event.summary) + '</span>' +
            '</div>';
        }).join('');
        if (!rows) rows = '<div class="cal-none">No events</div>';
        else if (day.events.length > 3) {
          rows += '<div class="cal-more">+' + (day.events.length - 3) + ' more</div>';
        }
        return '<section class="cal-day">' +
          '<div class="cal-day-label">' + U.esc(day.label) + '</div>' + rows +
          '</section>';
      }).join('') + '</div>';
    }

    panel.innerHTML = html;
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

  function confirmSave(options) {
    options = options || {};
    closeModal(null);
    return new Promise(function (resolve) {
      var root = U.el('div', { 'class': 'modal-backdrop' });
      root.innerHTML = '<div class="modal small" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h2>' + U.esc(options.title || 'Save changes?') + '</h2>' +
        '<p>' + U.esc(options.message || 'You have unsaved settings. Save them before leaving?') + '</p></div>' +
        '<div class="modal-actions">' +
        '<button class="btn ghost" id="modal-cancel">' + U.esc(options.cancelLabel || 'Cancel') + '</button>' +
        '<button class="btn ghost" id="modal-discard">' + U.esc(options.discardLabel || 'Discard') + '</button>' +
        '<button class="btn primary" id="modal-save">' + U.esc(options.saveLabel || 'Save') + '</button>' +
        '</div></div>';
      document.body.appendChild(root);
      document.body.classList.add('modal-open');
      modal = { root: root, resolve: resolve };
      var cancel = root.querySelector('#modal-cancel');
      var discard = root.querySelector('#modal-discard');
      var save = root.querySelector('#modal-save');
      var buttons = [cancel, discard, save];
      function finish(value) { closeModal(value); }
      cancel.addEventListener('click', function () { finish(null); });
      discard.addEventListener('click', function () { finish('discard'); });
      save.addEventListener('click', function () { finish('save'); });
      root.addEventListener('mousedown', function (event) {
        if (event.target === root) finish(null);
      });
      root.addEventListener('keydown', function (event) {
        if (event.keyCode === 27 || event.keyCode === 10009) {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
          return;
        }
        if (event.keyCode === 13) {
          event.preventDefault();
          event.stopPropagation();
          var active = document.activeElement;
          finish(active === cancel ? null : (active === discard ? 'discard' : 'save'));
          return;
        }
        if (event.keyCode === 37 || event.keyCode === 39) {
          event.preventDefault();
          event.stopPropagation();
          var index = buttons.indexOf(document.activeElement);
          if (index < 0) index = 2;
          var next = (index + (event.keyCode === 39 ? 1 : -1) + buttons.length) % buttons.length;
          try { buttons[next].focus(); } catch (e) { /* ignore */ }
        }
      });
      setTimeout(function () {
        try { save.focus(); } catch (e) { /* ignore */ }
      }, 60);
    });
  }

  function energyGraph(options) {
    options = options || {};
    var points = (options.points || []).filter(function (point) {
      return point && isFinite(point.v) && point.t && !isNaN(new Date(point.t).getTime());
    });
    if (points.length === 1) points.push({ t: points[0].t, v: points[0].v });
    closeModal(null);
    return new Promise(function (resolve) {
      var W = 1000;
      var H = 320;
      var left = 42;
      var right = 18;
      var top = 22;
      var bottom = 46;
      var values = points.map(function (point) { return Number(point.v); });
      var min = Math.min.apply(null, values);
      var max = Math.max.apply(null, values);
      if (min === max) { min -= 1; max += 1; }
      var pad = (max - min) * 0.08;
      min -= pad;
      max += pad;
      var plotW = W - left - right;
      var plotH = H - top - bottom;
      function xAt(i) { return left + (points.length <= 1 ? plotW : (i / (points.length - 1)) * plotW); }
      function yAt(v) { return top + (1 - ((v - min) / (max - min))) * plotH; }
      var line = points.map(function (point, i) {
        return (i ? 'L' : 'M') + xAt(i).toFixed(2) + ' ' + yAt(point.v).toFixed(2);
      }).join(' ');
      var area = line + ' L' + xAt(points.length - 1).toFixed(2) + ' ' + (top + plotH) +
        ' L' + xAt(0).toFixed(2) + ' ' + (top + plotH) + ' Z';
      var color = options.color || '#60a5fa';
      var grid = '';
      [0, 0.25, 0.5, 0.75, 1].forEach(function (fraction) {
        var y = top + fraction * plotH;
        var value = max - fraction * (max - min);
        grid += '<line x1="' + left + '" y1="' + y.toFixed(1) + '" x2="' + (W - right) +
          '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,.08)" stroke-width="1"/>';
        if (fraction === 0 || fraction === 0.5 || fraction === 1) {
          grid += '<text x="6" y="' + (y + 5).toFixed(1) + '" fill="rgba(255,255,255,.35)" ' +
            'font-size="18" font-family="inherit">' +
            (Math.round(value * 10) / 10) + '</text>';
        }
      });
      var now = points[points.length - 1].t;
      var mid = points[Math.floor(points.length / 2)].t;
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<defs><linearGradient id="energyArea" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="' + color + '" stop-opacity=".38"/>' +
        '<stop offset="1" stop-color="' + color + '" stop-opacity=".015"/>' +
        '</linearGradient></defs>' +
        grid +
        '<path d="' + area + '" fill="url(#energyArea)"/>' +
        '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="4" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>' +
        '<circle cx="' + xAt(points.length - 1).toFixed(2) + '" cy="' + yAt(points[points.length - 1].v).toFixed(2) +
        '" r="7" fill="' + color + '" stroke="#fff" stroke-width="2"/>' +
        '</svg>';
      var title = options.title || 'Energy usage';
      var subtitle = options.subtitle || 'Last 24 hours';
      var summaryValue = options.summaryValue || '';
      var summaryLabel = options.summaryLabel || '';
      var root = U.el('div', { 'class': 'modal-backdrop' });
      root.innerHTML = '<div class="modal wide energy-modal" role="dialog" aria-modal="true">' +
        '<div class="energy-head"><div><p class="energy-eyebrow">ENERGY</p><h2>' + U.esc(title) + '</h2>' +
        '<p>' + U.esc(subtitle) + '</p></div>' +
        '<div class="energy-summary"><b>' + U.esc(summaryValue) + '</b><small>' + U.esc(summaryLabel) + '</small></div></div>' +
        '<div class="energy-chart">' + svg + '</div>' +
        '<div class="energy-axis"><span>' + U.esc(U.fmtTime(points[0].t)) + '</span>' +
        '<span>' + U.esc(U.fmtTime(mid)) + '</span><span>' + U.esc(U.fmtTime(now)) + '</span></div>' +
        '<div class="modal-actions"><button class="btn primary" id="energy-close">Close</button></div></div>';
      document.body.appendChild(root);
      document.body.classList.add('modal-open');
      modal = { root: root, resolve: resolve };
      var close = root.querySelector('#energy-close');
      setTimeout(function () { try { close.focus(); } catch (e) { /* ignore */ } }, 60);
      close.addEventListener('click', function () { closeModal(true); });
      root.addEventListener('mousedown', function (event) {
        if (event.target === root) closeModal(true);
      });
      root.addEventListener('keydown', function (event) {
        if (event.keyCode === 27 || event.keyCode === 10009 || event.keyCode === 13) {
          event.preventDefault();
          event.stopPropagation();
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
    iconUrl: iconUrl,
    showScreen: showScreen,
    focusElement: focusElement,
    clearFocus: clearFocus,
    greeting: greeting,
    renderHome: renderHome,
    applyFocus: applyFocus,
    renderSensors: renderSensors,
    applySensorFocus: applySensorFocus,
    renderWeather: renderWeather,
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
    confirmSave: confirmSave,
    energyGraph: energyGraph,
    infoPanel: infoPanel,
    showSetupQR: showSetupQR,
    hideSetupQR: hideSetupQR,
    setupOpen: setupOpen,
    modalOpen: modalOpen,
    closeModal: closeModal,
  };
})(window.Aurora = window.Aurora || {});
