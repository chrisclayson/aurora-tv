/* Aurora — on-TV configuration service.
   Runs the bundled WebAssembly HTTP server in a hidden iframe and synchronises
   its JSON config with this app. The server listens on TV port 8099. */
(function (A) {
  'use strict';

  var BASE = 'http://127.0.0.1:8099';
  var state = {
    frame: null,
    enabled: false,
    ready: false,
    starting: false,
    error: '',
    lastRevision: '',
    token: '',
    localIp: '',
    healthTimer: null,
    pollTimer: null,
    pendingPush: null,
    inFlight: false,
    onConfig: null,
    onStatus: null
  };

  function emitStatus() {
    if (typeof state.onStatus === 'function') {
      try { state.onStatus(status()); } catch (e) { /* ignore */ }
    }
  }

  function status() {
    return {
      enabled: state.enabled,
      ready: state.ready,
      error: state.error,
      url: state.enabled ? BASE + '/' : '',
      revision: state.lastRevision || '',
      hasToken: !!state.token,
      ip: state.localIp || ''
    };
  }

  function fetchJson(path, options, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('Local config server timed out'));
      }, timeoutMs || 4000);
      var headers = Object.assign({}, (options && options.headers) || {});
      if (state.token) headers['X-Aurora-Token'] = state.token;
      fetch(BASE + path, Object.assign({}, options || {}, { headers: headers })).then(function (res) {
        if (done) return;
        if (!res.ok) {
          done = true;
          clearTimeout(timer);
          reject(new Error('HTTP ' + res.status));
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

  function ensureFrame() {
    if (state.frame) return;
    var frame = document.createElement('iframe');
    frame.id = 'aurora-local-server';
    frame.title = 'Aurora local configuration service';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.src = 'localsrv/server.html';
    document.body.appendChild(frame);
    state.frame = frame;
  }

  function removeFrame() {
    if (!state.frame) return;
    try { state.frame.parentNode.removeChild(state.frame); } catch (e) { /* ignore */ }
    state.frame = null;
  }

  function startHealthCheck() {
    clearInterval(state.healthTimer);
    var attempts = 0;
    state.starting = true;
    state.ready = false;
    state.error = '';
    emitStatus();
    state.healthTimer = setInterval(function () {
      attempts++;
      fetchJson('/api/health', { cache: 'no-store' }, 1500).then(function (health) {
        if (!health || !health.ok) return;
        if (health.ip) state.localIp = health.ip;
        clearInterval(state.healthTimer);
        state.healthTimer = null;
        state.starting = false;
        state.ready = true;
        state.error = '';
        emitStatus();
        initialSync();
        state.pollTimer = setInterval(poll, 2000);
      }).catch(function (err) {
        state.error = err.message || 'not ready';
        if (attempts > 40) {
          clearInterval(state.healthTimer);
          state.healthTimer = null;
          state.starting = false;
          emitStatus();
        }
        emitStatus();
      });
    }, 500);
  }

  function initialSync() {
    fetchJson('/api/config/local', { cache: 'no-store' }).then(function (payload) {
      var remote = payload && payload.config;
      state.lastRevision = payload && payload.revision || '';
      if (!remote || !Object.keys(remote).length) {
        push(A.Config.get());
        return;
      }
      var preview = A.Config.previewRemote(remote);
      if (preview && JSON.stringify(preview) !== JSON.stringify(A.Config.get())) {
        deliver(remote);
      }
    }).catch(function (err) {
      state.error = err.message || 'initial sync failed';
      emitStatus();
    });
  }

  function poll() {
    if (!state.ready || state.inFlight) return;
    state.inFlight = true;
    fetchJson('/api/config/local', { cache: 'no-store' }).then(function (payload) {
      state.inFlight = false;
      if (!payload) return;
      var revision = payload.revision || '';
      if (revision === state.lastRevision) return;
      state.lastRevision = revision;
      var remote = payload.config;
      if (!remote || !Object.keys(remote).length) {
        push(A.Config.get());
        return;
      }
      var preview = A.Config.previewRemote(remote);
      if (preview && JSON.stringify(preview) !== JSON.stringify(A.Config.get())) {
        deliver(remote);
      }
    }).catch(function (err) {
      state.inFlight = false;
      state.error = err.message || 'poll failed';
      emitStatus();
    });
  }

  function deliver(remote) {
    if (typeof state.onConfig === 'function') {
      try { state.onConfig(remote); } catch (e) { /* ignore */ }
    }
  }

  function push(config) {
    if (!state.ready) {
      state.pendingPush = config;
      return;
    }
    try {
      var body = JSON.stringify(config);
      fetchJson('/api/config/local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body
      }).then(function (payload) {
        if (payload && payload.revision) state.lastRevision = payload.revision;
        state.error = '';
        state.pendingPush = null;
        emitStatus();
      }).catch(function (err) {
        state.error = err.message || 'push failed';
        emitStatus();
      });
    } catch (e) {
      state.error = e.message;
      emitStatus();
    }
  }

  function configure(enabled, handlers, token) {
    if (handlers && typeof handlers.onConfig === 'function') state.onConfig = handlers.onConfig;
    if (handlers && typeof handlers.onStatus === 'function') state.onStatus = handlers.onStatus;
    token = token || '';
    if (token !== state.token) {
      state.token = token;
      if (state.enabled) stop();
    }

    if (!enabled) {
      stop();
      return;
    }
    if (state.enabled && (state.ready || state.starting)) return;
    state.enabled = true;
    ensureFrame();
    startHealthCheck();
  }

  function stop() {
    state.enabled = false;
    state.ready = false;
    state.starting = false;
    state.lastRevision = '';
    state.localIp = '';
    state.error = '';
    clearInterval(state.healthTimer);
    clearInterval(state.pollTimer);
    state.healthTimer = null;
    state.pollTimer = null;
    removeFrame();
    emitStatus();
  }

  A.LocalServer = {
    configure: configure,
    stop: stop,
    push: push,
    status: status,
    localIP: function () { return state.localIp || ''; },
    isReady: function () { return state.ready; }
  };
})(window.Aurora = window.Aurora || {});
