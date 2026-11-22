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
    tokenUpdate: null,
    stopping: false,
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
      var token = Object.prototype.hasOwnProperty.call(options || {}, 'token')
        ? options.token
        : state.token;
      if (token) headers['X-Aurora-Token'] = token;
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

  function setToken(token, callback) {
    token = token || '';
    if (token === state.token) {
      if (typeof callback === 'function') callback();
      return;
    }
    if (!state.enabled || !state.ready) {
      state.token = token;
      if (typeof callback === 'function') callback();
      return;
    }
    var previous = state.token;
    state.token = token;
    state.tokenUpdate = fetchJson('/api/auth/local', {
      method: 'POST',
      headers: { 'X-Aurora-New-Token': token },
      token: previous,
      cache: 'no-store'
    }, 4000).then(function () {
      state.error = '';
      state.tokenUpdate = null;
      if (typeof callback === 'function') callback();
      emitStatus();
    }).catch(function (err) {
      state.token = previous;
      state.error = err.message || 'token update failed';
      state.tokenUpdate = null;
      emitStatus();
    });
  }

  function configure(enabled, handlers, token) {
    if (handlers && typeof handlers.onConfig === 'function') state.onConfig = handlers.onConfig;
    if (handlers && typeof handlers.onStatus === 'function') state.onStatus = handlers.onStatus;
    token = token || '';
    if (!enabled) {
      if (state.enabled) stop();
      state.token = token;
      return;
    }
    if (state.enabled && (state.ready || state.starting)) {
      if (token !== state.token) setToken(token);
      return;
    }
    state.token = token;
    state.enabled = true;
    ensureFrame();
    startHealthCheck();
  }

  function teardown() {
    state.enabled = false;
    state.ready = false;
    state.starting = false;
    state.stopping = false;
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

  /* Ask the worker to close its listening socket before removing the iframe.
     Tizen keeps that native socket bound after the worker dies, so a plain
     iframe removal would leave port 8099 unable to bind again. */
  function stop() {
    if (state.stopping) return;
    if (!state.enabled) {
      teardown();
      return;
    }
    state.stopping = true;
    var pending = state.tokenUpdate || Promise.resolve();
    pending.then(function () {
      return fetchJson('/api/auth/shutdown', {
        method: 'POST',
        token: state.token,
        cache: 'no-store'
      }, 1500);
    }).then(function () {
      setTimeout(teardown, 250);
    }).catch(function () {
      teardown();
    });
  }

  A.LocalServer = {
    configure: configure,
    setToken: setToken,
    stop: stop,
    push: push,
    status: status,
    localIP: function () { return state.localIp || ''; },
    isReady: function () { return state.ready; }
  };
})(window.Aurora = window.Aurora || {});
