'use strict';

/*
 * Aurora EPG service.
 *
 * Fetches a UK XMLTV guide hourly, adds Freeview logical channel numbers
 * (`<lcn>`) and exposes the result at /epg.xml. The LCN list is refreshed from
 * the UK DTT channel tables, with a small built-in fallback for the main PSB
 * channels.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/dp247/Freeview-EPG/master/epg.xml';
const DEFAULT_LCN = 'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_DTT_channels_in_the_United_Kingdom&prop=wikitext&format=json&origin=*';

const BUILTIN_LCN = [
  { name: 'BBC One', lcn: 1, hd: false },
  { name: 'BBC One HD', lcn: 101, hd: true },
  { name: 'BBC Two', lcn: 2, hd: false },
  { name: 'BBC Two HD', lcn: 102, hd: true },
  { name: 'ITV1', lcn: 3, hd: false },
  { name: 'ITV1 HD', lcn: 103, hd: true },
  { name: 'Channel 4', lcn: 4, hd: false },
  { name: 'Channel 4 HD', lcn: 104, hd: true },
  { name: 'Channel 5', lcn: 5, hd: false },
  { name: 'Channel 5 HD', lcn: 105, hd: true },
  { name: 'ITV2', lcn: 6, hd: false },
  { name: 'ITV3', lcn: 10, hd: false },
  { name: 'E4', lcn: 13, hd: false },
  { name: 'Film4', lcn: 14, hd: false },
  { name: 'Channel 4 +1', lcn: 15, hd: false },
  { name: 'Dave', lcn: 19, hd: false },
  { name: 'Drama', lcn: 20, hd: false }
];

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanWiki(value) {
  return decodeEntities(String(value || '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<ref[^>]*\/>/gi, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function normalize(value) {
  return cleanWiki(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseName(value) {
  return normalize(String(value || '').replace(/\b(HD|SD|UHD)\b/gi, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const REGION_WORDS = {
  'uk-london': ['london'],
  'uk-scotland': ['scotland', 'stv', 'bbc alba'],
  'uk-wales': ['wales', 's4c'],
  'uk-northern-ireland': ['northern ireland', 'utv', 'ni']
};

const OTHER_REGION_WORDS = [
  'london', 'scotland', 'wales', 'northern ireland', 'ni', 'utv', 'stv',
  'east', 'west', 'south', 'north', 'midlands', 'yorkshire', 'yorks',
  'lincs', 'channel islands', 'ci', 'border', 'mercia', 'anglia', 'trent',
  'central', 'granada', 'meridian', 'tyne tees', 'westcountry'
];

function regionAllows(names, region) {
  if (!region || region === 'uk') return true;
  const wanted = REGION_WORDS[region] || [];
  const text = (names || []).join(' ').toLowerCase();
  function hasWord(word) {
    return new RegExp('(^|\\s)' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)').test(text);
  }
  const hasRegional = OTHER_REGION_WORDS.some(hasWord);
  if (!hasRegional) return true;
  return wanted.some(hasWord);
}

function lcnLooksHd(name, id) {
  return /\bHD\b/i.test(String(name || '')) || /(^|[.\-_])hd($|[.\-_])/i.test(String(id || ''));
}

function makeIndex(entries) {
  const exact = new Map();
  const bases = [];
  (entries || []).forEach(function (entry) {
    const lcn = Number(entry.lcn);
    if (!isFinite(lcn) || lcn <= 0) return;
    const hd = entry.hd === true || /\bHD\b/i.test(entry.name || '');
    const name = normalize(entry.name);
    const base = baseName(entry.name);
    if (!base) return;
    if (name && !exact.has(name)) exact.set(name, lcn);
    bases.push({ base: base, lcn: lcn, hd: hd });
  });
  bases.sort(function (a, b) { return b.base.length - a.base.length; });
  return { exact: exact, bases: bases };
}

function findLcn(index, names, id) {
  const list = (names || []).filter(Boolean);
  for (let i = 0; i < list.length; i++) {
    const name = list[i];
    const hd = lcnLooksHd(name, id);
    const exact = index.exact.get(normalize(name));
    if (exact) return exact;
    const base = baseName(name);
    if (!base) continue;
    for (let j = 0; j < index.bases.length; j++) {
      const item = index.bases[j];
      if (item.hd !== hd) continue;
      if (base === item.base || base.indexOf(item.base + ' ') === 0) {
        return item.lcn;
      }
    }
  }
  return 0;
}

function parseWikiTable(text, sectionTitle) {
  const section = text.indexOf(sectionTitle);
  if (section < 0) return [];
  const start = text.indexOf('{|', section);
  if (start < 0) return [];
  const end = text.indexOf('\n|}', start);
  if (end < 0) return [];
  const table = text.slice(start + 2, end);
  const rows = table.split(/\n\|-/);
  const entries = [];
  rows.forEach(function (row) {
    const cells = [];
    row.split('\n').forEach(function (line) {
      if (!line || line.charAt(0) !== '|') return;
      if (line.indexOf('|}') === 0 || line.indexOf('|-') === 0 || line.indexOf('|+') === 0) return;
      let value = line.slice(1);
      // Remove cell attributes such as style="..." |
      const attr = value.match(/^[^|]*\|/);
      if (attr && /(?:style|colspan|rowspan|class)=/i.test(attr[0])) value = value.slice(attr[0].length);
      value.split('||').forEach(function (part) { cells.push(part.trim()); });
    });
    const lcnMatch = String(cells[0] || '').match(/^(\d+)/);
    if (!lcnMatch || !cells[1]) return;
    const lcn = Number(lcnMatch[1]);
    const rawName = cells[1];
    const parts = rawName.split('/');
    parts.forEach(function (part) {
      const name = cleanWiki(part);
      if (name && !/^(local tv|local tv variations?)$/i.test(name)) {
        entries.push({ name: name, lcn: lcn, hd: /\bHD\b/i.test(name) });
      }
    });
  });
  return entries;
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs || 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/xml,text/xml,application/json,*/*' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadLcnIndex(lcnUrl) {
  const entries = BUILTIN_LCN.slice();
  if (lcnUrl) {
    try {
      const text = await fetchText(lcnUrl, 20000);
      let wikitext = '';
      try {
        const parsed = JSON.parse(text);
        wikitext = parsed && parsed.parse && parsed.parse.wikitext && parsed.parse.wikitext['*'];
      } catch (e) {
        wikitext = '';
      }
      if (wikitext) {
        const general = parseWikiTable(wikitext, '===General Entertainment===');
        const hd = parseWikiTable(wikitext, '===High-definition===');
        entries.push.apply(entries, general);
        entries.push.apply(entries, hd);
      }
    } catch (e) {
      // Keep the built-in map if the external LCN list is unavailable.
    }
  }
  return makeIndex(entries);
}

function augmentXml(xml, index, region) {
  let channels = 0;
  let augmented = 0;
  const output = String(xml || '').replace(/<channel\b[\s\S]*?<\/channel>/g, function (block) {
    const idMatch = block.match(/\bid="([^"]+)"/);
    const id = idMatch ? idMatch[1] : '';
    const names = [];
    const re = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
    let match;
    while ((match = re.exec(block))) names.push(decodeEntities(match[1]));
    if (!regionAllows(names, region)) return '';
    channels++;
    if (/<lcn>\s*\d+\s*<\/lcn>/.test(block)) {
      augmented++;
      return block;
    }
    const lcn = findLcn(index, names, id);
    if (!lcn) return block;
    augmented++;
    return block.replace('</channel>', '  <lcn>' + lcn + '</lcn>\n</channel>');
  });
  return { xml: output, channels: channels, augmented: augmented };
}

function create(options) {
  options = options || {};
  const sourceUrl = String(options.sourceUrl || DEFAULT_SOURCE);
  const lcnUrl = String(options.lcnUrl || DEFAULT_LCN);
  const region = String(options.region || 'uk');
  const refreshMinutes = Math.max(1, Math.min(24 * 60, Number(options.refreshMinutes) || 60));
  const service = {
    region: region,
    sourceUrl: sourceUrl,
    lcnUrl: lcnUrl,
    refreshMinutes: refreshMinutes,
    xml: '',
    updated: 0,
    error: '',
    channels: 0,
    augmented: 0,
    lcnEntries: 0,
    cachePath: String(options.cachePath || ''),
    refreshing: null,
    timer: null
  };

  service.refresh = function () {
    if (service.refreshing) return service.refreshing;
    service.refreshing = Promise.all([
      fetchText(sourceUrl, 30000),
      loadLcnIndex(lcnUrl)
    ]).then(function (results) {
      const raw = results[0];
      const index = results[1];
      const result = augmentXml(raw, index, region);
      if (!result.channels) throw new Error('The EPG source did not contain any channels');
      service.xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + result.xml.replace(/^<\?xml[^>]*>\s*/i, '');
      service.channels = result.channels;
      service.augmented = result.augmented;
      service.lcnEntries = index.bases.length;
      service.updated = Date.now();
      service.error = '';
      if (service.cachePath) {
        fs.mkdir(path.dirname(service.cachePath), { recursive: true }, function () {
          fs.writeFile(service.cachePath, service.xml, function () { /* cache is best-effort */ });
        });
      }
      return service.status();
    }).catch(function (err) {
      service.error = err.name === 'AbortError' ? 'Timed out fetching the EPG source' : err.message;
      throw err;
    }).finally(function () {
      service.refreshing = null;
    });
    return service.refreshing;
  };

  service.status = function () {
    return {
      ok: !!service.xml,
      region: service.region,
      sourceUrl: service.sourceUrl,
      lcnUrl: service.lcnUrl,
      refreshMinutes: service.refreshMinutes,
      channels: service.channels,
      augmented: service.augmented,
      lcnEntries: service.lcnEntries,
      updated: service.updated,
      updatedAt: service.updated ? new Date(service.updated).toISOString() : '',
      error: service.error
    };
  };

  service.loadCache = function () {
    if (!service.cachePath) return;
    try {
      const cached = fs.readFileSync(service.cachePath, 'utf8');
      if (cached && /<tv[\s>]/.test(cached)) {
        service.xml = cached;
        service.channels = (cached.match(/<channel[\s>]/g) || []).length;
        service.augmented = (cached.match(/<lcn>/g) || []).length;
        service.updated = fs.statSync(service.cachePath).mtimeMs;
        service.error = '';
      }
    } catch (e) { /* no cache yet */ }
  };

  service.start = function () {
    service.loadCache();
    service.refresh().catch(function () { /* status records the error */ });
    service.timer = setInterval(function () {
      service.refresh().catch(function () { /* status records the error */ });
    }, refreshMinutes * 60000);
    if (service.timer.unref) service.timer.unref();
  };

  return service;
}

module.exports = {
  create: create,
  normalize: normalize,
  augmentXml: augmentXml,
  DEFAULT_SOURCE: DEFAULT_SOURCE,
  DEFAULT_LCN: DEFAULT_LCN
};
