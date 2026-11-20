/* Aurora — small helpers. Classic script (no ES modules) so it also runs
   from file:// inside a Tizen widget where module CORS is unreliable. */
(function (A) {
  'use strict';

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== false && attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    if (html != null) node.innerHTML = html;
    return node;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function fmtTime(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtTimeWithSeconds(date) {
    var d = date instanceof Date ? date : new Date(date);
    return fmtTime(d) + ':' + pad(d.getSeconds());
  }

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function fmtDate(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  function fmtDateShort(date) {
    var d = date instanceof Date ? date : new Date(date);
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  }

  function fmtDuration(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var mins = Math.floor(total / 60);
    var secs = total % 60;
    if (mins >= 60) {
      var hrs = Math.floor(mins / 60);
      mins = mins % 60;
      return hrs + 'h ' + pad(mins) + 'm';
    }
    return mins + ':' + pad(secs);
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9);
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  function throttle(fn, wait) {
    var last = 0;
    var timer = null;
    var pending = null;
    return function () {
      var now = Date.now();
      var args = arguments;
      var self = this;
      var run = function () {
        last = Date.now();
        timer = null;
        fn.apply(self, pending || args);
        pending = null;
      };
      if (now - last >= wait) {
        run();
      } else {
        pending = args;
        if (!timer) timer = setTimeout(run, wait - (now - last));
      }
    };
  }

  function safeJson(text, fallback) {
    try { return JSON.parse(text); } catch (e) { return fallback; }
  }

  function toBool(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value == null || value === '') return fallback;
    return /^(1|true|yes|on|enabled)$/i.test(String(value).trim());
  }

  function slug(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'x';
  }

  function trimSlash(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error((label || 'operation') + ' timed out'));
      }, ms);
      promise.then(function (value) {
        clearTimeout(timer);
        resolve(value);
      }, function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  A.Util = {
    $: $,
    $$: $$,
    el: el,
    esc: esc,
    pad: pad,
    fmtTime: fmtTime,
    fmtTimeWithSeconds: fmtTimeWithSeconds,
    fmtDate: fmtDate,
    fmtDateShort: fmtDateShort,
    fmtDuration: fmtDuration,
    clamp: clamp,
    uid: uid,
    debounce: debounce,
    throttle: throttle,
    safeJson: safeJson,
    toBool: toBool,
    slug: slug,
    trimSlash: trimSlash,
    withTimeout: withTimeout
  };

  /* Older Tizen web engines (2019/2020 TVs) do not support flex `gap`.
     Detect it once and let the CSS fall back to margins. */
  try {
    var probe = document.createElement('div');
    probe.style.cssText = 'display:flex;flex-direction:column;position:absolute;visibility:hidden;row-gap:10px;top:-999px';
    var childA = document.createElement('div');
    var childB = document.createElement('div');
    childA.style.height = '10px';
    childB.style.height = '10px';
    probe.appendChild(childA);
    probe.appendChild(childB);
    document.documentElement.appendChild(probe);
    var flexGapSupported = probe.scrollHeight >= 29;
    document.documentElement.removeChild(probe);
    if (!flexGapSupported) document.documentElement.className += ' no-flex-gap';
  } catch (e) {
    document.documentElement.className += ' no-flex-gap';
  }
})(window.Aurora = window.Aurora || {});
