/* Aurora — Home Assistant client.
   REST for state + service calls, WebSocket for live updates. If the socket
   cannot be established (common behind reverse proxies) REST polling keeps
   the sensor strip and status fresh. */
(function (A) {
  'use strict';

  var U = A.Util;

  function HA() {
    this.handlers = {};
    this.cfg = null;
    this.configured = false;
    this.ws = null;
    this.wsBlocked = false;
    this.connected = false;
    this.restOk = false;
    this.stopped = true;
    this.states = {};
    this.error = '';
    this.msgId = 1;
    this.pollTimer = null;
    this.retryTimer = null;
    this.lastUpdate = 0;
    this.requests = 0;
    this.failures = 0;
    this.calls = {};
    this.callId = 100000;
    this.generation = 0;
  }

  HA.prototype.on = function (event, fn) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
    return this;
  };

  HA.prototype.emit = function (event) {
    var args = Array.prototype.slice.call(arguments, 1);
    (this.handlers[event] || []).forEach(function (fn) {
      try { fn.apply(null, args); } catch (e) {
        if (window.console) console.error('[ha] handler', e);
      }
    });
  };

  HA.prototype.base = function () {
    return U.trimSlash(this.cfg && this.cfg.baseUrl);
  };

  HA.prototype.configure = function (cfg) {
    this.stop();
    this.generation++;
    this.cfg = cfg || {};
    this.configured = !!(this.cfg.enabled && this.cfg.baseUrl && this.cfg.token);
    this.error = '';
    this.wsBlocked = false;
    if (!this.configured) {
      this.connected = false;
      this.restOk = false;
      this.states = {};
      this.emit('change');
      return;
    }
    this.stopped = false;
    var self = this;
    this._pollNow();
    this.pollTimer = setInterval(function () { self._pollNow(); }, 20000);
    this._connect();
  };

  HA.prototype.stop = function () {
    this.stopped = true;
    this.generation++;
    var calls = this.calls;
    this.calls = {};
    Object.keys(calls).forEach(function (id) {
      clearTimeout(calls[id].timer);
      calls[id].reject(new Error('Home Assistant connection was reconfigured'));
    });
    clearInterval(this.pollTimer);
    clearTimeout(this.retryTimer);
    this.pollTimer = null;
    this.retryTimer = null;
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
    this.restOk = false;
  };

  HA.prototype._connect = function () {
    var self = this;
    if (this.stopped || !this.configured || this.wsBlocked) return;
    var base = this.base();
    if (!/^https?:\/\//i.test(base)) {
      this.error = 'Home Assistant URL must start with http:// or https://';
      this.emit('change');
      return;
    }
    var gen = this.generation;
    var url = base.replace(/^http/i, 'ws') + '/api/websocket';
    var ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.error = 'WebSocket unavailable: ' + e.message;
      this.wsBlocked = true;
      this.emit('change');
      return;
    }
    this.ws = ws;
    this.requests = 0;

    ws.onopen = function () {
      // HA sends auth_required first; nothing to do yet.
    };

    ws.onmessage = function (event) {
      if (self.generation !== gen) return;
      var msg = U.safeJson(event.data, null);
      if (!msg || !msg.type) return;
      if (msg.type === 'auth_required') {
        self._send({ type: 'auth', access_token: self.cfg.token });
        return;
      }
      if (msg.type === 'auth_invalid') {
        self.error = 'Home Assistant rejected the access token';
        self.connected = false;
        self.wsBlocked = true;
        self.emit('change');
        try { ws.close(); } catch (e) { /* ignore */ }
        return;
      }
      if (msg.type === 'auth_ok') {
        self.connected = true;
        self.error = '';
        self.failures = 0;
        self.lastUpdate = Date.now();
        self._send({ id: self.msgId++, type: 'get_states' });
        self._send({ id: self.msgId++, type: 'subscribe_events', event_type: 'state_changed' });
        self.emit('change');
        return;
      }
      if (msg.type === 'result') {
        var pendingCall = self.calls[msg.id];
        if (pendingCall) {
          delete self.calls[msg.id];
          clearTimeout(pendingCall.timer);
          if (msg.success) pendingCall.resolve(msg.result);
          else pendingCall.reject(new Error((msg.error && msg.error.message) || 'Home Assistant service call failed'));
          return;
        }
        if (Array.isArray(msg.result)) {
          self._applyStates(msg.result);
        }
        return;
      }
      if (msg.type === 'event' && msg.event && msg.event.event_type === 'state_changed') {
        var data = msg.event.data || {};
        if (data.entity_id && data.new_state) {
          self.states[data.entity_id] = data.new_state;
          self.lastUpdate = Date.now();
          self.emit('state', data.entity_id, data.new_state);
          self.emit('change');
        }
      }
    };

    ws.onclose = function () {
      if (self.generation !== gen) return;
      var was = self.connected;
      self.connected = false;
      Object.keys(self.calls).forEach(function (id) {
        var call = self.calls[id];
        delete self.calls[id];
        clearTimeout(call.timer);
        call.reject(new Error('Home Assistant WebSocket closed'));
      });
      if (was) self.emit('change');
      if (self.stopped) return;
      self._pollNow();
      clearTimeout(self.retryTimer);
      self.retryTimer = setTimeout(function () { self._connect(); }, 8000);
    };

    ws.onerror = function () {
      // The close handler schedules the retry. Avoid console noise on TV.
    };
  };

  HA.prototype._send = function (payload) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      return false;
    }
  };

  HA.prototype._applyStates = function (list) {
    var map = {};
    (list || []).forEach(function (entity) {
      if (entity && entity.entity_id) map[entity.entity_id] = entity;
    });
    this.states = map;
    this.lastUpdate = Date.now();
    this.emit('change');
    this.emit('states');
  };

  /* Pull the full state list now. Used after media service calls so the
     Music screen updates even when the WebSocket event is delayed. */
  HA.prototype.refresh = function () {
    var self = this;
    if (!this.configured) return Promise.resolve(false);
    if (this.connected) {
      return this.command('get_states').then(function (list) {
        self._applyStates(list || []);
        return true;
      }).catch(function () { return false; });
    }
    this._pollNow();
    return Promise.resolve(true);
  };

  HA.prototype._headers = function () {
    return {
      'Authorization': 'Bearer ' + this.cfg.token,
      'Content-Type': 'application/json'
    };
  };

  HA.prototype._pollNow = function () {
    var self = this;
    if (this.stopped || !this.configured || this.connected) return;
    var gen = this.generation;
    this.requests++;
    fetch(this.base() + '/api/states', { headers: this._headers(), cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) {
          if (res.status === 401) throw new Error('Home Assistant rejected the access token (401)');
          throw new Error('Home Assistant returned HTTP ' + res.status);
        }
        return res.json();
      })
      .then(function (list) {
        if (self.generation !== gen) return;
        self.failures = 0;
        self.restOk = true;
        self.error = '';
        self._applyStates(list);
      })
      .catch(function (err) {
        if (self.generation !== gen) return;
        self.failures++;
        if (self.failures >= 2) {
          self.restOk = false;
          self.error = err.message || 'Cannot reach Home Assistant';
        }
        if (self.requests <= 2 || self.failures === 2) self.emit('change');
        if (window.console) console.warn('[ha] poll failed:', err.message);
      });
  };

  HA.prototype._restCall = function (domain, service, data) {
    var self = this;
    return fetch(this.base() + '/api/services/' + domain + '/' + service, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(data || {})
    }).then(function (res) {
      if (!res.ok) throw new Error('Service call failed (HTTP ' + res.status + ')');
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; });
    }).then(function (result) {
      setTimeout(function () { self._pollNow(); }, 600);
      return result;
    });
  };

  HA.prototype.callService = function (domain, service, data) {
    var self = this;
    if (!this.configured) return Promise.reject(new Error('Home Assistant is not configured'));

    // WebSocket service calls avoid browser CORS entirely.
    if (this.connected && this.ws && this.ws.readyState === 1) {
      var id = this.callId++;
      return new Promise(function (resolve, reject) {
        var call = {
          resolve: resolve,
          reject: reject,
          timer: setTimeout(function () {
            if (!self.calls[id]) return;
            delete self.calls[id];
            reject(new Error('Home Assistant service call timed out'));
          }, 8000)
        };
        self.calls[id] = call;
        var sent = self._send({
          id: id,
          type: 'call_service',
          domain: domain,
          service: service,
          service_data: data || {}
        });
        if (!sent) {
          clearTimeout(call.timer);
          delete self.calls[id];
          self._restCall(domain, service, data).then(resolve, reject);
        }
      });
    }
    return this._restCall(domain, service, data);
  };

  /* Generic Home Assistant WebSocket command (registries, camera/stream, ...). */
  HA.prototype.command = function (type, payload) {
    var self = this;
    if (!this.configured) return Promise.reject(new Error('Home Assistant is not configured'));
    if (!this.connected || !this.ws || this.ws.readyState !== 1) {
      return Promise.reject(new Error('Home Assistant WebSocket is not connected'));
    }
    var id = this.callId++;
    return new Promise(function (resolve, reject) {
      var call = {
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function () {
          if (!self.calls[id]) return;
          delete self.calls[id];
          reject(new Error('Home Assistant command timed out'));
        }, 10000)
      };
      self.calls[id] = call;
      var message = { id: id, type: type };
      Object.keys(payload || {}).forEach(function (key) {
        if (key !== 'id' && key !== 'type') message[key] = payload[key];
      });
      if (!self._send(message)) {
        clearTimeout(call.timer);
        delete self.calls[id];
        reject(new Error('Home Assistant WebSocket is not connected'));
      }
    });
  };

  /* Only cameras that can provide a live stream. Direct RTSP/HLS attributes
     are usable even if the integration omits supported_features; otherwise the
     camera must advertise CameraEntityFeature.STREAM (bit 2). */
  HA.prototype.cameras = function () {
    var self = this;
    return Object.keys(this.states).filter(function (id) {
      return id.indexOf('camera.') === 0;
    }).map(function (id) {
      var entity = self.states[id];
      var attrs = entity.attributes || {};
      return {
        id: id,
        name: attrs.friendly_name || id,
        state: entity.state,
        attributes: attrs
      };
    }).filter(function (camera) {
      if (!camera || camera.state === 'unavailable' || camera.state === 'unknown') return false;
      var attrs = camera.attributes || {};
      var direct = attrs.rtsp_url || attrs.stream_url || attrs.stream_source ||
        attrs.rtsp || attrs.hls_url || '';
      var features = Number(attrs.supported_features);
      var canStream = isFinite(features) && (features & 2);
      return !!(direct || canStream);
    }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  };

  HA.prototype.cameraStream = function (entityId) {
    var self = this;
    return this.command('camera/stream', { entity_id: entityId }).then(function (result) {
      var url = result && (result.url || result.stream_url);
      if (!url) throw new Error('Home Assistant did not return a camera stream URL');
      if (url.charAt(0) === '/') url = self.base() + url;
      return url;
    });
  };

  HA.prototype.musicEntity = function () {
    return (this.cfg && this.cfg.musicEntity) || '';
  };

  HA.prototype.browseMedia = function (entityId, contentType, contentId) {
    var payload = { entity_id: entityId };
    if (contentType) payload.media_content_type = contentType;
    if (contentId) payload.media_content_id = contentId;
    return this.command('media_player/browse_media', payload);
  };

  HA.prototype.playMedia = function (entityId, contentId, contentType) {
    return this.callService('media_player', 'play_media', {
      entity_id: entityId,
      media_content_id: contentId,
      media_content_type: contentType || 'music'
    });
  };

  HA.prototype.canControlTv = function () {
    return !!(this.configured && this.cfg.tvEntity);
  };

  HA.prototype.selectSource = function (source) {
    if (!this.canControlTv()) return Promise.reject(new Error('No HA tvEntity configured'));
    return this.callService('media_player', 'select_source', {
      entity_id: this.cfg.tvEntity,
      source: source
    });
  };

  HA.prototype.turnOffTv = function () {
    if (!this.canControlTv()) return Promise.reject(new Error('No HA tvEntity configured'));
    return this.callService('media_player', 'turn_off', { entity_id: this.cfg.tvEntity });
  };

  HA.prototype.toggleLight = function () {
    if (!this.cfg.lightEntity) return Promise.reject(new Error('No light entity configured'));
    return this.callService('light', 'toggle', { entity_id: this.cfg.lightEntity });
  };

  HA.prototype.entity = function (id) {
    return id ? this.states[id] : null;
  };

  HA.prototype._pack = function (id) {
    if (!id) return null;
    var entity = this.states[id];
    if (!entity) return { id: id, state: 'unavailable', name: id, unit: '' };
    var attrs = entity.attributes || {};
    return {
      id: id,
      state: entity.state,
      name: attrs.friendly_name || id,
      unit: attrs.unit_of_measurement || '',
      device_class: attrs.device_class || '',
      brightness: attrs.brightness != null ? attrs.brightness : null,
      last_changed: entity.last_changed || ''
    };
  };

  HA.prototype.sensors = function () {
    if (!this.configured) return { light: null, power: null };
    return {
      light: this._pack(this.cfg.lightEntity),
      power: this._pack(this.cfg.powerEntity)
    };
  };

  HA.prototype.dashboard = function (id) {
    var dashboards = (this.cfg && this.cfg.dashboards) || [];
    var wanted = id || (this.cfg && this.cfg.defaultDashboard);
    var found = null;
    dashboards.forEach(function (d) { if (d.id === wanted) found = d; });
    return found || dashboards[0] || null;
  };

  HA.prototype.dashboardUrl = function (id) {
    var dashboard = this.dashboard(id);
    if (!dashboard) return '';
    var path = dashboard.path || '/lovelace/0';
    if (!/^\//.test(path)) path = '/' + path;
    return this.base() + path;
  };

  HA.prototype.stateSummary = function () {
    return {
      enrolled: this.configured,
      connected: this.connected,
      polling: this.restOk,
      error: this.error,
      updated: this.lastUpdate ? new Date(this.lastUpdate).toISOString() : null
    };
  };

  A.HA = new HA();
})(window.Aurora = window.Aurora || {});
