#!/usr/bin/env node
/*
 * Aurora remote configuration server.
 *
 * Serves a small web UI and a JSON config API for the Aurora Tizen app.
 * No runtime dependencies; Node.js 18+.
 *
 *   PORT=8090 AURORA_CONFIG_TOKEN=secret node server.js
 *
 * The TV fetches:
 *   GET /api/config/<deviceId>
 * with an optional "Authorization: Bearer <token>" header.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 8090;
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.AURORA_CONFIG_TOKEN || '';
const PUBLIC_URL = (process.env.AURORA_PUBLIC_URL || '').replace(/\/+$/, '');
const DATA_DIR = path.resolve(process.env.AURORA_CONFIG_DATA || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 1024 * 1024;
const DEVICE_ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function log() {
  console.log(new Date().toISOString(), ...arguments);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match, X-Aurora-Token');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Aurora-Revision');
  res.setHeader('Access-Control-Max-Age', '600');
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorized(req, url) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || '';
  const bearer = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '') : '';
  return safeEqual(bearer, TOKEN) ||
    safeEqual(req.headers['x-aurora-token'], TOKEN) ||
    safeEqual(url.searchParams.get('token'), TOKEN);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

function configFile(id) {
  return path.join(DATA_DIR, id + '.json');
}

function readConfig(id) {
  const file = configFile(id);
  const raw = fs.readFileSync(file, 'utf8');
  return { raw: raw, config: JSON.parse(raw), stat: fs.statSync(file) };
}

function writeConfig(id, config) {
  const file = configFile(id);
  const tmp = file + '.tmp';
  const raw = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(tmp, raw, 'utf8');
  fs.renameSync(tmp, file);
  return raw;
}

function revisionOf(raw) {
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

function deviceSummary(id) {
  try {
    const loaded = readConfig(id);
    const cfg = loaded.config;
    return {
      id: id,
      name: cfg.deviceName || id,
      model: cfg.model || '',
      updatedAt: loaded.stat.mtime.toISOString()
    };
  } catch (e) {
    return null;
  }
}

function listDevices() {
  return fs.readdirSync(DATA_DIR)
    .filter(function (name) { return name.endsWith('.json') && !name.includes('.tmp'); })
    .map(function (name) { return name.replace(/\.json$/, ''); })
    .filter(function (id) { return DEVICE_ID.test(id); })
    .map(deviceSummary)
    .filter(Boolean)
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return proto + '://' + (req.headers.host || ('localhost:' + PORT));
}

function configPayload(id) {
  const loaded = readConfig(id);
  const revision = revisionOf(loaded.raw);
  return {
    device: id,
    revision: revision,
    updatedAt: loaded.stat.mtime.toISOString(),
    config: loaded.config
  };
}

function deviceIdFromQuery(url) {
  return String(url.searchParams.get('device') || '').trim();
}

async function testHA(body) {
  const base = String(body.baseUrl || '').replace(/\/+$/, '');
  const token = String(body.token || '');
  if (!/^https?:\/\//i.test(base)) throw new Error('HA URL must start with http:// or https://');
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 8000);
  try {
    const res = await fetch(base + '/api/states', {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      signal: controller.signal
    });
    if (!res.ok) throw new Error('Home Assistant returned HTTP ' + res.status);
    const list = await res.json();
    return { ok: true, count: Array.isArray(list) ? list.length : 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHaEntities(body) {
  const baseUrl = String(body.baseUrl || '').trim().replace(/\/+$/, '');
  const token = String(body.token || '').trim();
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Home Assistant URL must start with http:// or https://');
  if (!token) throw new Error('A Home Assistant long-lived token is required');
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 10000);
  try {
    const res = await fetch(baseUrl + '/api/states', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    if (!res.ok) throw new Error('Home Assistant returned HTTP ' + res.status);
    const list = await res.json();
    return (Array.isArray(list) ? list : []).map(function (entity) {
      const attrs = entity.attributes || {};
      return {
        entity_id: entity.entity_id,
        state: entity.state,
        attributes: {
          friendly_name: attrs.friendly_name || '',
          device_class: attrs.device_class || '',
          unit_of_measurement: attrs.unit_of_measurement || ''
        }
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

async function testXmltv(body) {
  const url = String(body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('XMLTV URL must start with http:// or https://');
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 12000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/xml,text/xml,*/*' } });
    if (!res.ok) throw new Error('XMLTV returned HTTP ' + res.status);
    const text = await res.text();
    const channels = (text.match(/<channel[\s>]/g) || []).length;
    const programmes = (text.match(/<programme[\s>]/g) || []).length;
    if (!channels || !programmes) throw new Error('Response does not look like XMLTV');
    return { ok: true, channels: channels, programmes: programmes, bytes: Buffer.byteLength(text) };
  } finally {
    clearTimeout(timer);
  }
}

function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? '/index.html' : pathname;
  try { relative = decodeURIComponent(relative); } catch (e) { /* use raw */ }
  const target = path.resolve(PUBLIC_DIR, '.' + relative);
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  fs.stat(target, function (err, stat) {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer(async function (req, res) {
  setCors(res);
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const ingressPath = String(req.headers['x-ingress-path'] || '').replace(/\/+$/, '');
  if (ingressPath && url.pathname.indexOf(ingressPath) === 0) {
    url.pathname = url.pathname.slice(ingressPath.length) || '/';
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/config.js') {
    const publicBase = PUBLIC_URL || baseUrl(req);
    const body = 'window.AURORA_SERVER_PUBLIC_URL = ' + JSON.stringify(publicBase) + ';\n';
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store'
    });
    return res.end(body);
  }

  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method not allowed');
      return;
    }
    serveStatic(req, res, url.pathname);
    return;
  }

  if (url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'aurora-config-server', devices: listDevices().length });
  }

  if (!authorized(req, url)) {
    return json(res, 401, { error: 'Unauthorised. Set the access token in the web UI.' });
  }

  try {
    if (url.pathname === '/api/devices' && req.method === 'GET') {
      return json(res, 200, { devices: listDevices() });
    }

    if (url.pathname === '/api/devices' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (!body) return json(res, 400, { error: 'Invalid JSON' });
      const id = String(body.id || '').trim().toLowerCase();
      if (!DEVICE_ID.test(id)) return json(res, 400, { error: 'Device ID must match [a-z0-9_-], up to 41 characters' });
      if (fs.existsSync(configFile(id))) return json(res, 409, { error: 'A device with that ID already exists' });
      const existing = listDevices();
      const copyFrom = String(body.copyFrom || (existing[0] && existing[0].id) || '');
      if (!copyFrom || !fs.existsSync(configFile(copyFrom))) {
        return json(res, 400, { error: 'Choose an existing device to copy from' });
      }
      const cfg = JSON.parse(fs.readFileSync(configFile(copyFrom), 'utf8'));
      cfg.deviceId = id;
      cfg.deviceName = String(body.name || id);
      cfg.model = String(body.model || '');
      cfg.remoteConfig = { enabled: false, url: '', token: '', pollMinutes: 5 };
      writeConfig(id, cfg);
      log('created device', id, 'from', copyFrom);
      return json(res, 201, { device: deviceSummary(id), config: cfg });
    }

    const deleteMatch = url.pathname.match(/^\/api\/devices\/([a-z0-9_-]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      const id = deleteMatch[1];
      if (!fs.existsSync(configFile(id))) return json(res, 404, { error: 'Unknown device' });
      fs.unlinkSync(configFile(id));
      log('deleted device', id);
      return json(res, 200, { ok: true, deleted: id });
    }

    const bootstrapMatch = url.pathname.match(/^\/api\/bootstrap\/([a-z0-9_-]+)$/);
    if (bootstrapMatch && req.method === 'GET') {
      const id = bootstrapMatch[1];
      if (!fs.existsSync(configFile(id))) return json(res, 404, { error: 'Unknown device' });
      const cfg = readConfig(id).config;
      cfg.remoteConfig = {
        enabled: true,
        url: baseUrl(req) + '/api/config/' + id,
        token: TOKEN,
        pollMinutes: Number(cfg.remoteConfig && cfg.remoteConfig.pollMinutes) || 5
      };
      res.setHeader('Content-Disposition', 'attachment; filename="config.json"');
      return json(res, 200, cfg);
    }

    let configId = '';
    const configMatch = url.pathname.match(/^\/api\/config\/([a-z0-9_-]+)$/);
    if (configMatch) configId = configMatch[1];
    else if (url.pathname === '/api/config') configId = deviceIdFromQuery(url);

    if (configId && !DEVICE_ID.test(configId)) {
      return json(res, 400, { error: 'Invalid device ID' });
    }

    if (configId && req.method === 'GET') {
      if (!fs.existsSync(configFile(configId))) return json(res, 404, { error: 'Unknown device' });
      const payload = configPayload(configId);
      const etag = '"' + payload.revision + '"';
      res.setHeader('ETag', etag);
      res.setHeader('X-Aurora-Revision', payload.revision);
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304);
        res.end();
        return;
      }
      return json(res, 200, payload);
    }

    if (configId && (req.method === 'PUT' || req.method === 'POST')) {
      if (!fs.existsSync(configFile(configId))) return json(res, 404, { error: 'Unknown device' });
      const body = parseJson(await readBody(req));
      if (!body) return json(res, 400, { error: 'Invalid JSON' });
      const config = body.config && typeof body.config === 'object' ? body.config : body;
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return json(res, 400, { error: 'Config must be a JSON object' });
      }
      config.deviceId = configId;
      if (!config.deviceName) config.deviceName = configId;
      writeConfig(configId, config);
      log('saved device', configId);
      return json(res, 200, configPayload(configId));
    }

    if (url.pathname === '/api/ha/entities' && req.method === 'POST') {
      const body = parseJson(await readBody(req)) || {};
      try {
        const entities = await fetchHaEntities(body);
        return json(res, 200, { ok: true, entities: entities });
      } catch (err) {
        return json(res, 200, { ok: false, error: err.name === 'AbortError' ? 'Timed out' : err.message });
      }
    }

    if (url.pathname === '/api/test/ha' && req.method === 'POST') {
      const body = parseJson(await readBody(req)) || {};
      try {
        return json(res, 200, await testHA(body));
      } catch (err) {
        return json(res, 200, { ok: false, error: err.name === 'AbortError' ? 'Timed out' : err.message });
      }
    }

    if (url.pathname === '/api/test/xmltv' && req.method === 'POST') {
      const body = parseJson(await readBody(req)) || {};
      try {
        return json(res, 200, await testXmltv(body));
      } catch (err) {
        return json(res, 200, { ok: false, error: err.name === 'AbortError' ? 'Timed out' : err.message });
      }
    }

    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    log('request error', req.method, req.url, err.message);
    return json(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, HOST, function () {
  log('Aurora config server listening on', HOST + ':' + PORT);
  log('data directory:', DATA_DIR);
  if (!TOKEN) log('WARNING: AURORA_CONFIG_TOKEN is not set; anyone on the LAN can read and write configs (including HA tokens).');
  Object.keys(os.networkInterfaces()).forEach(function (name) {
    (os.networkInterfaces()[name] || []).forEach(function (netif) {
      if (netif.family === 'IPv4' && !netif.internal) {
        log('  http://' + netif.address + ':' + PORT);
      }
    });
  });
});
