/* Aurora — Tizen platform abstraction.
   Everything here is defensive: the same bundle runs in a desktop browser
   (preview mode), on a retail TV where partner privileges are missing, and
   on a partner-signed TV where tvchannel/app-launch are available. */
(function (A) {
  'use strict';

  var U = A.Util;
  var tizen = window.tizen || null;

  var caps = {
    tizen: !!tizen,
    appLaunch: !!(tizen && tizen.application && tizen.application.launch),
    tvchannel: !!(tizen && tizen.tvchannel),
    tvinputdevice: !!(tizen && tizen.tvinputdevice),
    audiocontrol: !!(tizen && tizen.tvaudiocontrol),
    systeminfo: !!(tizen && tizen.systeminfo),
    window: !!(tizen && tizen.tvwindow),
    b2b: !!(window.webapis && window.webapis.b2bapis && window.webapis.b2bapis.b2bcontrol),
    appInfo: !!(tizen && tizen.application && tizen.application.getAppsInfo)
  };

  var info = {
    model: '',
    firmware: '',
    version: '',
    resolution: '',
    ip: '',
    ipSource: ''
  };

  var videoSources = {
    connected: [],
    disconnected: [],
    available: false,
    updated: 0
  };

  var livePreview = {
    visible: false,
    key: '',
    sourceId: ''
  };

  var errors = [];
  var ipDiscovery = null;

  var KEYS = [
    'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaRewind',
    'MediaFastForward', 'MediaTrackPrevious', 'MediaTrackNext',
    'Info', 'Guide', 'Menu', 'Tools', 'Captions', 'PictureSize', 'Soccer',
    'Teletext', 'Exit', 'ChannelUp', 'ChannelDown', 'VolumeUp', 'VolumeDown',
    'Mute', 'Source', 'HDMI', 'PreviousChannel',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Minus', 'Plus'
  ];

  function noteError(where, err) {
    var message = (err && (err.message || err.name)) || String(err);
    errors.push(where + ': ' + message);
    if (errors.length > 20) errors.shift();
    if (window.console && console.warn) console.warn('[platform] ' + where, err);
  }

  function registerKeys() {
    if (!caps.tvinputdevice) return;
    var api = tizen.tvinputdevice;
    try {
      if (typeof api.registerKeyBatch === 'function') {
        api.registerKeyBatch(KEYS);
        return;
      }
    } catch (e) {
      noteError('registerKeyBatch', e);
    }
    KEYS.forEach(function (key) {
      try { api.registerKey(key); } catch (e) { /* unsupported key on this model */ }
    });
  }

  function init() {
    registerKeys();
    if (caps.systeminfo) {
      try {
        tizen.systeminfo.getPropertyValue('BUILD', function (build) {
          info.model = build.model || '';
          info.firmware = build.firmware || build.buildVersion || '';
          info.version = build.version || '';
          if (A.App && A.App.onModelReady) {
            setTimeout(function () { A.App.onModelReady(); }, 0);
          }
        }, function (err) { noteError('systeminfo BUILD', err); });

        tizen.systeminfo.getPropertyValue('DISPLAY', function (display) {
          info.resolution = (display.width || '?') + 'x' + (display.height || '?');
        }, function (err) { noteError('systeminfo DISPLAY', err); });

      } catch (e) {
        noteError('systeminfo', e);
      }
    }
    setTimeout(function () { discoverIP(6000); }, 400);
    setTimeout(function () { refreshVideoSources(); }, 300);
    if (window.screen) {
      info.screen = window.screen.width + 'x' + window.screen.height;
    }
  }

  function plainVideoSource(source) {
    return {
      type: source && source.type,
      number: source && Number(source.number),
      signal: source && source.signal,
      editName: source && source.editName
    };
  }

  function refreshVideoSources() {
    return new Promise(function (resolve) {
      if (!caps.systeminfo || !tizen) return resolve(videoSources);
      try {
        tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (sources) {
          if (sources && (sources.connected || sources.disconnected)) {
            videoSources = {
              connected: (sources.connected || []).map(plainVideoSource),
              disconnected: (sources.disconnected || []).map(plainVideoSource),
              available: true,
              updated: Date.now()
            };
          }
          resolve(videoSources);
        }, function (err) {
          noteError('VIDEOSOURCE', err);
          resolve(videoSources);
        });
      } catch (e) {
        noteError('VIDEOSOURCE', e);
        resolve(videoSources);
      }
    });
  }

  /* Returns the connected HDMI port numbers, or null when detection has not
     succeeded yet. Null means "unknown" and callers keep all configured tiles. */
  function hdmiPorts() {
    if (!videoSources.available) return null;
    var ports = [];
    videoSources.connected.forEach(function (source) {
      if (source.type === 'HDMI') ports.push(Number(source.number));
    });
    return ports;
  }

  function launchApp(appId) {
    return new Promise(function (resolve, reject) {
      if (!appId) return reject(new Error('No app id configured'));
      if (!caps.appLaunch) return reject(new Error('App launch is not available here'));
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('Launch of ' + appId + ' timed out'));
      }, 3000);
      try {
        tizen.application.launch(appId, function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(true);
        }, function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error((err && err.message) || 'Could not launch ' + appId));
        });
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  function supportsArtMode() {
    return /LS03/i.test(String(info.model || ''));
  }

  function launchArtMode() {
    if (!caps.appLaunch) return Promise.reject(new Error('App launch is not available here'));
    var ids = ['org.tizen.art-app', 'com.samsung.tv.home.art', 'com.samsung.tv.coba.art'];
    function attempt(index) {
      if (index >= ids.length) {
        return Promise.reject(new Error('The Art Mode app is not available'));
      }
      return launchApp(ids[index]).catch(function () {
        return attempt(index + 1);
      });
    }
    return attempt(0);
  }

  function tvCall(method, args, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!caps.tvchannel || !tizen.tvchannel || typeof tizen.tvchannel[method] !== 'function') {
        return reject(new Error('tvchannel.' + method + ' unavailable'));
      }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('tvchannel.' + method + ' timed out'));
      }, timeoutMs || 4000);
      var ok = function (value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      var fail = function (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err || new Error('tvchannel.' + method + ' failed'));
      };
      try {
        tizen.tvchannel[method].apply(tizen.tvchannel, (args || []).concat([ok, fail]));
      } catch (e) {
        fail(e);
      }
    });
  }

  function getCurrentChannel() {
    if (!caps.tvchannel) return Promise.resolve(null);
    return tvCall('getCurrentChannel', []).then(function (ch) {
      if (!ch) return null;
      return {
        major: ch.major,
        minor: ch.minor,
        number: ch.major != null ? String(ch.major) + (ch.minor ? '.' + ch.minor : '') : '',
        name: ch.channelName || ch.name || '',
        program: ch.programName || ch.programTitle || '',
        start: ch.startTime || null,
        stop: ch.endTime || null
      };
    }).catch(function (err) {
      noteError('getCurrentChannel', err);
      return null;
    });
  }

  function getChannelList() {
    if (!caps.tvchannel) return Promise.resolve([]);
    var attempts = [['ALL'], ['DTV'], []];
    var chain = Promise.reject(new Error('no attempt'));
    attempts.forEach(function (args) {
      chain = chain.catch(function () {
        return tvCall('getChannelList', args, 5000);
      });
    });
    return chain.then(function (list) {
      return Array.isArray(list) ? list : [];
    }).catch(function (err) {
      noteError('getChannelList', err);
      return [];
    });
  }

  function tuneChannelObject(channel) {
    if (!channel) return Promise.reject(new Error('No channel'));
    return tvCall('tune', [channel], 6000);
  }

  function tuneChannelNumber(number) {
    var wanted = String(number == null ? '' : number).trim();
    if (!wanted) return Promise.reject(new Error('No channel number'));
    return getChannelList().then(function (list) {
      var found = null;
      list.forEach(function (ch) {
        if (found) return;
        var major = ch.major != null ? String(ch.major) : '';
        var minor = ch.minor != null ? String(ch.minor) : '';
        var full = major && minor ? major + '.' + minor : major || minor;
        if (full === wanted || major === wanted ||
            String(ch.channelNumber || '') === wanted ||
            String(ch.channelName || '').toLowerCase() === wanted.toLowerCase()) {
          found = ch;
        }
      });
      if (!found) throw new Error('Channel ' + wanted + ' not found');
      return tuneChannelObject(found);
    }).catch(function (err) {
      noteError('tuneChannelNumber', err);
      throw err;
    });
  }

  function channelStep(direction) {
    var method = direction > 0 ? 'channelUp' : 'channelDown';
    return tvCall(method, [], 5000).catch(function (err) {
      noteError(method, err);
      throw err;
    });
  }

  var appsCache = { at: 0, items: null };
  var APPS_CACHE_MS = 5 * 60 * 1000;

  function listApps(force) {
    if (!force && appsCache.items && Date.now() - appsCache.at < APPS_CACHE_MS) {
      return Promise.resolve(appsCache.items.slice());
    }
    return new Promise(function (resolve) {
      if (!caps.appInfo) return resolve([]);
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve([]);
      }, 4000);
      try {
        tizen.application.getAppsInfo(function (apps) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          var list = (apps || []).map(function (app) {
            return {
              id: app.id,
              name: app.name || app.id,
              icon: app.iconPath || '',
              show: app.show !== false
            };
          });
          appsCache = { at: Date.now(), items: list };
          resolve(list.slice());
        }, function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          noteError('getAppsInfo', err);
          resolve([]);
        });
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        noteError('getAppsInfo', e);
        resolve([]);
      }
    });
  }

  function setB2BSource(sourceId) {
    return new Promise(function (resolve, reject) {
      if (!caps.b2b) return reject(new Error('B2B input control not available'));
      var control = window.webapis.b2bapis.b2bcontrol;
      var mode = sourceId === 'livetv' ? 'digitalTv' : sourceId.toUpperCase();
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('B2B setInputSource timed out'));
      }, 4000);
      var ok = function (result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (result && result.result === false) reject(new Error('B2B rejected the input'));
        else resolve(true);
      };
      var fail = function (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error((err && err.message) || 'B2B input switch failed'));
      };
      try {
        control.setInputSource(mode, ok, fail);
      } catch (e) {
        fail(e);
      }
    });
  }

  function hideCurrentApp() {
    try {
      if (tizen && tizen.application && typeof tizen.application.getCurrentApplication === 'function') {
        tizen.application.getCurrentApplication().hide();
      }
    } catch (e) {
      noteError('application.hide', e);
    }
  }

  function stopCamera() {
    var av = window.webapis && window.webapis.avplay;
    if (!av) return;
    try { av.stop(); } catch (e) { /* not playing */ }
    try { av.close(); } catch (e) { /* not open */ }
  }

  function playCamera(url) {
    return new Promise(function (resolve, reject) {
      var av = window.webapis && window.webapis.avplay;
      if (!av) return reject(new Error('AVPlay is not available on this TV'));
      if (!url) return reject(new Error('No camera stream URL'));
      var settled = false;
      function fail(err) {
        if (settled) return;
        settled = true;
        stopCamera();
        reject(new Error((err && (err.message || err.name)) || 'Camera playback failed'));
      }
      try {
        stopCamera();
        av.open(url);
        try { av.setDisplayRect(0, 0, 1920, 1080); } catch (e) { /* ignore */ }
        try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) { /* ignore */ }
        av.setListener({
          onerror: function (type) { fail(new Error('Camera playback error' + (type ? ': ' + type : ''))); },
          onstreamcompleted: function () { /* keep the last frame until the user leaves */ }
        });
        av.prepareAsync(function () {
          if (settled) return;
          try {
            av.play();
            settled = true;
            resolve(true);
          } catch (e) {
            fail(e);
          }
        }, function (err) {
          fail(err);
        });
      } catch (e) {
        fail(e);
      }
    });
  }

  function launchAppControl(control, appId) {
    return new Promise(function (resolve, reject) {
      if (!tizen || !tizen.application || typeof tizen.application.launchAppControl !== 'function') {
        return reject(new Error('Application controls are not available'));
      }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('App control timed out'));
      }, 4000);
      var ok = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(true);
      };
      var fail = function (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error((err && err.message) || 'App control failed'));
      };
      try {
        tizen.application.launchAppControl(control, appId || null, ok, fail, null);
      } catch (e) {
        fail(e);
      }
    });
  }

  function settingsControl(uri) {
    var data = [];
    if (tizen.ApplicationControlData) {
      data.push(new tizen.ApplicationControlData('__K_EX_FORCE_BOOST', ['enable']));
    }
    return new tizen.ApplicationControl(
      'http://tizen.org/appcontrol/operation/default',
      uri,
      null,
      null,
      data
    );
  }

  /* Opens the TV's own settings. Prefer the standard Tizen setting operation;
     fall back to Samsung's org.tizen.menu with the regional menu JSON. */
  function launchTvSettings() {
    var attempts = [];
    if (tizen && tizen.ApplicationControl) {
      attempts.push({
        via: 'appcontrol-setting',
        run: function () {
          return launchAppControl(new tizen.ApplicationControl(
            'http://tizen.org/appcontrol/operation/setting',
            null, null, null, null
          ), null);
        }
      });
      if (tizen.ApplicationControlData) {
        ['/opt/apps/org.tizen.menu/res/json/ATSC/menu.json',
          '/opt/apps/org.tizen.menu/res/json/DVB/menu.json',
          '/opt/apps/org.tizen.menu/res/json/menu.json'].forEach(function (uri) {
          attempts.push({
            via: 'menu:' + uri,
            run: function () { return launchAppControl(settingsControl(uri), 'org.tizen.menu'); }
          });
        });
      }
    }
    attempts.push({
      via: 'launch-menu',
      run: function () { return launchApp('org.tizen.menu'); }
    });
    attempts.push({
      via: 'launch-coba',
      run: function () { return launchApp('com.samsung.tv.coba.setting'); }
    });

    var errors = [];
    function next(index) {
      if (index >= attempts.length) {
        return Promise.reject(new Error(errors.join('; ') || 'No TV settings handler is available'));
      }
      var attempt = attempts[index];
      return attempt.run().then(function () {
        return { via: attempt.via };
      }).catch(function (err) {
        errors.push(attempt.via + ': ' + err.message);
        return next(index + 1);
      });
    }
    if (!caps.tizen) {
      return Promise.resolve({ via: 'preview', simulated: true });
    }
    return next(0);
  }

  function tvWindowSource(sourceId) {
    if (sourceId === 'livetv') return { type: 'TV', number: 1 };
    var number = parseInt(String(sourceId).replace(/[^0-9]/g, ''), 10);
    return { type: 'HDMI', number: isFinite(number) && number > 0 ? number : 1 };
  }

  /* TVWindow.setSource() is the public API that changes the main TV input.
     It accepts the SystemInfoVideoSourceInfo objects returned by VIDEOSOURCE. */
  function setTvWindowSource(sourceId) {
    return new Promise(function (resolve, reject) {
      if (!caps.window || !tizen.tvwindow || typeof tizen.tvwindow.setSource !== 'function') {
        return reject(new Error('TVWindow source switching unavailable'));
      }
      var wanted = tvWindowSource(sourceId);
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('TVWindow setSource timed out'));
      }, 5000);
      function finish(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(true);
      }
      function apply(source) {
        var ok = function () { finish(null); };
        var fail = function (err) { finish(err || new Error('TVWindow setSource failed')); };
        try {
          tizen.tvwindow.setSource(source, ok, fail, 'MAIN');
        } catch (e) {
          try {
            tizen.tvwindow.setSource(source, ok, fail);
          } catch (e2) {
            finish(e2);
          }
        }
      }
      if (caps.systeminfo) {
        try {
          tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (sources) {
            var all = (sources.connected || []).concat(sources.disconnected || []);
            var found = null;
            all.forEach(function (source) {
              if (!found && source.type === wanted.type &&
                  Number(source.number) === Number(wanted.number)) found = source;
            });
            apply(found || wanted);
          }, function () { apply(wanted); });
        } catch (e) {
          apply(wanted);
        }
      } else {
        apply(wanted);
      }
    });
  }

  function currentInput() {
    return new Promise(function (resolve) {
      if (!caps.systeminfo || !tizen) return resolve('');
      try {
        tizen.systeminfo.getPropertyValue('SOURCE_INFO', function (info) {
          if (!info) return resolve('');
          if (info.type === 'HDMI') return resolve('hdmi' + Number(info.number));
          if (info.type === 'TV') return resolve('livetv');
          resolve('');
        }, function () { resolve(''); });
      } catch (e) { resolve(''); }
    });
  }

  /* Shows the current input in a native TVWindow over the web app. The
     rectangle is in CSS pixels and must match the placeholder's video area. */
  function showLivePreview(rect, sourceId) {
    if (!caps.window || !tizen.tvwindow || typeof tizen.tvwindow.show !== 'function') {
      return Promise.resolve(false);
    }
    var key = sourceId + '|' + [rect.left, rect.top, rect.width, rect.height].join(',');
    if (livePreview.visible && livePreview.key === key) return Promise.resolve(true);
    var prepare = livePreview.sourceId === sourceId
      ? Promise.resolve(true)
      : setTvWindowSource(sourceId);
    if (livePreview.visible && livePreview.key === 'input-backdrop') {
      prepare = prepare.then(function () { return hideLivePreview(); });
    }
    return prepare.then(function () {
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () { finish(false); }, 4000);
        function finish(ok) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          livePreview.visible = !!ok;
          livePreview.key = ok ? key : '';
          if (ok) livePreview.sourceId = sourceId;
          resolve(!!ok);
        }
        var vw = window.innerWidth || 1920;
        var vh = window.innerHeight || 1080;
        var box = [
          (rect.left / vw * 100).toFixed(3) + '%',
          (rect.top / vh * 100).toFixed(3) + '%',
          (rect.width / vw * 100).toFixed(3) + '%',
          (rect.height / vh * 100).toFixed(3) + '%'
        ];
        try {
          tizen.tvwindow.show(function () { finish(true); }, function () { finish(false); },
            box, 'MAIN', 'FRONT');
        } catch (e) {
          try {
            tizen.tvwindow.show(function () { finish(true); }, function () { finish(false); },
              box, 'MAIN');
          } catch (e2) {
            noteError('tvwindow.show', e2);
            finish(false);
          }
        }
      });
    });
  }

  /* Shows the current input full-screen behind the web app. The app's HTML
     must keep the home screen translucent for the video to show through. */
  function showInputBackdrop(force) {
    if (!caps.window || !tizen.tvwindow || typeof tizen.tvwindow.show !== 'function') {
      return Promise.resolve(false);
    }
    var key = 'input-backdrop';
    if (!force && livePreview.visible && livePreview.key === key) return Promise.resolve(true);
    var prepare = (livePreview.visible && livePreview.key !== key)
      ? hideLivePreview()
      : Promise.resolve(true);
    return prepare.then(function () {
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () { finish(false); }, 4000);
        function finish(ok) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          livePreview.visible = !!ok;
          livePreview.key = ok ? key : '';
          livePreview.sourceId = '';
          resolve(!!ok);
        }
        var box = ['0%', '0%', '100%', '100%'];
        try {
          tizen.tvwindow.show(function () { finish(true); }, function () { finish(false); },
            box, 'MAIN', 'BEHIND');
        } catch (e) {
          noteError('tvwindow.show(backdrop)', e);
          finish(false);
        }
      });
    });
  }

  /* Leaves Aurora and returns to whatever was underneath — usually the live
     input or the app that launched the launcher. Hiding is deliberate: some
     Tizen firmware relaunch an app immediately after exit(), which made Back
     look like a reload loop. A launcher can safely stay resident in the
     background. */
  function exitApp() {
    function leave() {
      if (tizen && tizen.application && typeof tizen.application.getCurrentApplication === 'function') {
        try {
          var app = tizen.application.getCurrentApplication();
          if (app && typeof app.hide === 'function') {
            app.hide();
            return true;
          }
          if (app && typeof app.exit === 'function') {
            app.exit();
            return true;
          }
        } catch (e) {
          noteError('application.leave', e);
        }
      }
      return false;
    }
    if (livePreview.visible) {
      return hideLivePreview().then(leave);
    }
    return Promise.resolve(leave());
  }

  function hideLivePreview() {
    livePreview.visible = false;
    livePreview.key = '';
    if (!caps.window || !tizen.tvwindow || typeof tizen.tvwindow.hide !== 'function') {
      return Promise.resolve(false);
    }
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { finish(false); }, 1500);
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(!!ok);
      }
      try {
        tizen.tvwindow.hide(function () { finish(true); }, function () { finish(false); }, 'MAIN');
      } catch (e) {
        finish(false);
      }
    });
  }

  /* Switches to a configured source using the best available strategy.
     Returns { via, simulated?, errors? } — never throws for a graceful UI. */
  function switchSource(sourceId, options) {
    options = options || {};
    var cfg = A.Config.get();
    var src = cfg.sources[sourceId];
    if (!src) return Promise.resolve({ via: 'none', errors: ['Unknown source ' + sourceId] });

    var attemptErrors = [];

    var tryB2B = function () {
      return setB2BSource(sourceId);
    };

    var tryApp = function () {
      if (!src.appId) return Promise.reject(new Error('No app id configured'));
      return launchApp(src.appId);
    };

    var preparation = Promise.resolve();
    if (sourceId === 'livetv' && caps.tvchannel && cfg.livetv && cfg.livetv.defaultChannel) {
      preparation = tuneChannelNumber(cfg.livetv.defaultChannel).catch(function (err) {
        attemptErrors.push('tune: ' + err.message);
      });
    }

    var tryTvWindow = function () {
      return setTvWindowSource(sourceId);
    };

    return preparation.then(tryTvWindow).then(function () {
      if (options.background) {
        // Keep Aurora in front and refresh the translucent TV window so the
        // new input appears behind the menu.
        return showInputBackdrop(true).then(function (overlay) {
          if (!overlay) setTimeout(hideCurrentApp, 250);
          return { via: 'tvwindow', overlay: !!overlay };
        });
      }
      // TVWindow changes the main video plane; the launcher must move out of
      // the way so the selected input is actually visible.
      setTimeout(hideCurrentApp, 250);
      return { via: 'tvwindow', overlay: false };
    }).catch(function (err) {
      attemptErrors.push('tvwindow: ' + err.message);
      return tryB2B().then(function () {
        if (options.background) setTimeout(hideCurrentApp, 250);
        return { via: 'b2b', overlay: false };
      });
    }).catch(function (err) {
      attemptErrors.push('b2b: ' + err.message);
      return tryApp().then(function () {
        if (options.background) setTimeout(hideCurrentApp, 250);
        return { via: 'app', overlay: false };
      });
    }).catch(function (err) {
      attemptErrors.push('app: ' + err.message);
      if (!caps.tizen) {
        return { via: 'preview', simulated: true, errors: attemptErrors };
      }
      return { via: 'none', errors: attemptErrors };
    });
  }

  function normalizeIP(value) {
    if (value == null) return '';
    var match = String(value).match(/((?:\d{1,3}\.){3}\d{1,3})/);
    if (!match) return '';
    var ip = match[1];
    var parts = ip.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (parseInt(parts[i], 10) > 255) return '';
    }
    if (ip === '0.0.0.0' || ip.indexOf('127.') === 0 || ip.indexOf('169.254.') === 0) return '';
    return ip;
  }

  function systemInfoIP(property, timeoutMs) {
    return new Promise(function (resolve) {
      if (!caps.systeminfo || !tizen) return resolve('');
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve('');
      }, timeoutMs || 1500);
      var finish = function (ip) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(normalizeIP(ip));
      };
      try {
        tizen.systeminfo.getPropertyValue(property, function (network) {
          finish(network && (network.ipAddress || network.ipv4Address || network.ip || network.address));
        }, function (err) {
          noteError('systeminfo ' + property, err);
          finish('');
        });
      } catch (e) {
        noteError('systeminfo ' + property, e);
        finish('');
      }
    });
  }

  function samsungNetworkIP(timeoutMs) {
    return new Promise(function (resolve) {
      var api = window.webapis && window.webapis.network;
      if (!api || typeof api.getIp !== 'function') return resolve('');
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve('');
      }, timeoutMs || 1500);
      var finish = function (ip) {
        if (done) return;
        var normalized = normalizeIP(ip);
        if (!normalized) return;
        done = true;
        clearTimeout(timer);
        resolve(normalized);
      };
      try {
        var direct = api.getIp();
        if (direct) return finish(direct);
      } catch (e) { /* callback variant below */ }
      try {
        api.getIp(function (ip) { finish(ip); }, function (err) {
          noteError('network.getIp', err);
        });
      } catch (e) {
        noteError('network.getIp', e);
      }
    });
  }

  /* Host ICE candidates expose the address of the interface used for the
     connection without needing systeminfo or a native privilege. */
  function webrtcIP(timeoutMs) {
    return new Promise(function (resolve) {
      var Ctor = window.RTCPeerConnection || window.webkitRTCPeerConnection;
      if (!Ctor) return resolve('');
      var pc = null;
      var done = false;
      var found = '';
      var timer = setTimeout(function () {
        finish(found);
      }, timeoutMs || 2500);
      var finish = function (ip) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (pc) { try { pc.close(); } catch (e) { /* ignore */ } }
        resolve(normalizeIP(ip));
      };
      try {
        pc = new Ctor({ iceServers: [] });
      } catch (e) {
        clearTimeout(timer);
        return resolve('');
      }
      pc.onicecandidate = function (event) {
        var candidate = event && event.candidate && event.candidate.candidate;
        if (!candidate) return;
        var ip = normalizeIP(candidate);
        if (!ip) return;
        if (!found) found = ip;
        if (ip.indexOf('10.') === 0 || ip.indexOf('192.168.') === 0 || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
          finish(ip);
        }
      };
      try {
        pc.createDataChannel('aurora-ip');
        pc.createOffer().then(function (offer) {
          return pc.setLocalDescription(offer);
        }).catch(function () {
          finish(found);
        });
      } catch (e) {
        finish(found);
      }
    });
  }

  /* Returns the first usable IPv4 address. Tries, in parallel:
       - Samsung's webapis.network.getIp()
       - systeminfo NETWORK / WIFI / ETHERNET
       - WebRTC host candidates
     Any source that answers first wins, so a firmware that blocks systeminfo
     does not prevent the QR code from being generated. */
  function discoverIP(timeoutMs) {
    if (info.ip) return Promise.resolve(info.ip);
    if (ipDiscovery) return ipDiscovery;

    var attempts = [
      { source: 'samsung.network', promise: samsungNetworkIP(1500) },
      { source: 'systeminfo WIFI_NETWORK', promise: systemInfoIP('WIFI_NETWORK', 1800) },
      { source: 'systeminfo ETHERNET_NETWORK', promise: systemInfoIP('ETHERNET_NETWORK', 1800) },
      { source: 'systeminfo WIFI', promise: systemInfoIP('WIFI', 1800) },
      { source: 'systeminfo ETHERNET', promise: systemInfoIP('ETHERNET', 1800) },
      { source: 'webrtc', promise: webrtcIP(2500) }
    ];

    var run = new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        finish(info.ip || '', info.ipSource);
      }, timeoutMs || 5000);

      function finish(ip, source) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (ip) {
          info.ip = ip;
          info.ipSource = source || '';
        }
        resolve(info.ip || '');
      }

      attempts.forEach(function (attempt) {
        attempt.promise.then(function (ip) {
          if (ip) finish(ip, attempt.source);
        });
      });
    });

    ipDiscovery = run;
    run.then(function () {
      if (ipDiscovery === run) ipDiscovery = null;
    });
    return run;
  }

  function localIPAsync(timeoutMs) {
    if (info.ip) return Promise.resolve(info.ip);
    return discoverIP(timeoutMs || 5000);
  }

  function diagnostics() {
    return {
      capabilities: caps,
      info: info,
      videoSources: {
        connected: videoSources.connected.slice(),
        disconnected: videoSources.disconnected.slice(),
        available: videoSources.available,
        updated: videoSources.updated
      },
      errors: errors.slice(),
      userAgent: navigator.userAgent
    };
  }

  A.Platform = {
    KEY_BACK: 10009,
    caps: caps,
    info: info,
    init: init,
    launchApp: launchApp,
    launchArtMode: launchArtMode,
    supportsArtMode: supportsArtMode,
    switchSource: switchSource,
    launchTvSettings: launchTvSettings,
    listApps: listApps,
    getCurrentChannel: getCurrentChannel,
    getChannelList: getChannelList,
    tuneChannelNumber: tuneChannelNumber,
    channelStep: channelStep,
    diagnostics: diagnostics,
    localIP: function () { return info.ip || ''; },
    localIPAsync: localIPAsync,
    refreshVideoSources: refreshVideoSources,
    hdmiPorts: hdmiPorts,
    currentInput: currentInput,
    showLivePreview: showLivePreview,
    showInputBackdrop: showInputBackdrop,
    hideLivePreview: hideLivePreview,
    exitApp: exitApp,
    playCamera: playCamera,
    stopCamera: stopCamera
  };
})(window.Aurora = window.Aurora || {});
