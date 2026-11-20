/* Aurora — EPG (XMLTV) loader and demo guide data. */
(function (A) {
  'use strict';

  var U = A.Util;

  var state = {
    channels: [],
    programs: {},
    source: 'none',
    updated: 0,
    error: '',
    windowHours: 3
  };

  var DAY = 24 * 3600 * 1000;

  function parseXmltvDate(value) {
    if (!value) return NaN;
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(value).trim());
    if (!m) return NaN;
    var year = Number(m[1]);
    var month = Number(m[2]) - 1;
    var day = Number(m[3]);
    var hour = Number(m[4]);
    var minute = Number(m[5]);
    var second = Number(m[6] || 0);
    var offset = 0;
    if (m[7]) {
      var sign = m[7][0] === '-' ? -1 : 1;
      offset = sign * ((Number(m[7].slice(1, 3)) * 60) + Number(m[7].slice(3, 5)));
    }
    return Date.UTC(year, month, day, hour, minute, second) - offset * 60000;
  }

  function parseXmltv(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (!doc || doc.getElementsByTagName('parsererror').length) {
      throw new Error('XMLTV is not valid XML');
    }
    var channelNodes = Array.prototype.slice.call(doc.getElementsByTagName('channel'));
    if (!channelNodes.length) throw new Error('XMLTV contains no channels');

    var channels = [];
    var lookup = {};
    channelNodes.forEach(function (node, index) {
      var id = node.getAttribute('id');
      if (!id) return;
      var names = node.getElementsByTagName('display-name');
      var name = names.length ? String(names[0].textContent || '').trim() : id;
      var lcn = node.getElementsByTagName('lcn')[0];
      var iconNode = node.getElementsByTagName('icon')[0];
      var channel = {
        id: id,
        name: name || id,
        number: lcn ? String(lcn.textContent || '').trim() : String(index + 1),
        icon: iconNode ? iconNode.getAttribute('src') || '' : ''
      };
      channels.push(channel);
      lookup[id] = channel;
    });

    var now = Date.now();
    var programs = {};
    var nodes = Array.prototype.slice.call(doc.getElementsByTagName('programme'));
    var count = 0;
    nodes.forEach(function (node) {
      var channelId = node.getAttribute('channel');
      if (!lookup[channelId]) return;
      var start = parseXmltvDate(node.getAttribute('start'));
      var stop = parseXmltvDate(node.getAttribute('stop'));
      if (!isFinite(start)) return;
      if (!isFinite(stop) || stop <= start) stop = start + 30 * 60000;
      if (stop < now - 12 * 3600000 || start > now + 7 * DAY) return;

      var titleNode = node.getElementsByTagName('title')[0];
      var descNode = node.getElementsByTagName('desc')[0];
      var catNode = node.getElementsByTagName('category')[0];
      var epNode = node.getElementsByTagName('episode-num')[0];
      var item = {
        start: start,
        stop: stop,
        title: titleNode ? String(titleNode.textContent || '').trim() : 'Untitled',
        desc: descNode ? String(descNode.textContent || '').trim() : '',
        category: catNode ? String(catNode.textContent || '').trim() : '',
        episode: epNode ? String(epNode.textContent || '').trim() : ''
      };
      if (!programs[channelId]) programs[channelId] = [];
      programs[channelId].push(item);
      count++;
    });

    if (!count) throw new Error('XMLTV contains no programmes');

    var withPrograms = channels.filter(function (channel) {
      var list = programs[channel.id];
      if (!list) return false;
      list.sort(function (a, b) { return a.start - b.start; });
      return true;
    });

    return { channels: withPrograms, programs: programs };
  }

  var DEMO_CHANNELS = [
    { id: 'demo.one', name: 'Aurora One', number: '1', category: 'general' },
    { id: 'demo.two', name: 'Aurora Two', number: '2', category: 'general' },
    { id: 'demo.news', name: 'City News', number: '3', category: 'news' },
    { id: 'demo.sport', name: 'North Sport', number: '4', category: 'sport' },
    { id: 'demo.cinema', name: 'Cinema', number: '5', category: 'film' },
    { id: 'demo.kids', name: 'Aurora Kids', number: '6', category: 'kids' },
    { id: 'demo.docs', name: 'Discovery Docs', number: '7', category: 'documentary' }
  ];

  var TITLES = {
    general: [
      ['Morning Edition', 'News, weather and conversation to start the day.'],
      ['The Kitchen Table', 'Simple recipes and seasonal cooking with friends.'],
      ['Coastal Walks', 'A slow journey along the shoreline.'],
      ['Homes & Gardens', 'Ideas for small spaces and big weekends.'],
      ['Quiz Night', 'Three rounds, four contestants, one winner.'],
      ['Evening Report', 'The day\'s headlines and analysis.'],
      ['The Repair Room', 'Restoring forgotten treasures.'],
      ['Late Lounge', 'Music and conversation into the night.']
    ],
    news: [
      ['World in Focus', 'International stories and on-the-ground reporting.'],
      ['The Briefing', 'A concise round-up of the day\'s news.'],
      ['Business Daily', 'Markets, technology and the economy.'],
      ['Weather Hour', 'Forecasts and climate stories.'],
      ['News at Nine', 'The main evening bulletin.']
    ],
    sport: [
      ['Matchday Live', 'Live coverage and analysis.'],
      ['The Warm-Up', 'Previews, team news and predictions.'],
      ['Highlights', 'The best of the weekend\'s action.'],
      ['Inside the Club', 'A look behind the scenes.'],
      ['Extra Time', 'Debate and reaction.']
    ],
    film: [
      ['Feature: Northern Light', 'A drama about a family returning home. (2021)'],
      ['Feature: The Long Way Round', 'A road movie with a detour or two. (2019)'],
      ['Feature: Quiet Harbour', 'A mystery on the coast. (2022)'],
      ['Short Cuts', 'Award-winning short films from the region.'],
      ['Cinema Classics', 'A restored favourite from the archive.']
    ],
    kids: [
      ['Pip & Pickle', 'Two friends build a very wobbly boat.'],
      ['Little Explorers', 'Discovering the forest floor.'],
      ['Story Time', 'A bedtime story read aloud.'],
      ['Art Club', 'Draw along at home.'],
      ['Number Squad', 'Puzzles and counting games.']
    ],
    documentary: [
      ['The Deep', 'Life in the midnight zone.'],
      ['Built to Last', 'Engineering the impossible.'],
      ['Hidden Cities', 'Stories from the streets below.'],
      ['Wild Seasons', 'A year in the mountains.'],
      ['The Observatory', 'Questions about the night sky.']
    ]
  };

  function demoProgramsFor(channel, from, to) {
    var pool = TITLES[channel.category] || TITLES.general;
    var out = [];
    var cursor = from;
    var seed = 0;
    for (var i = 0; i < channel.id.length; i++) seed += channel.id.charCodeAt(i);
    var index = seed % pool.length;
    while (cursor < to) {
      var slotMinutes = [30, 60, 60, 90, 30, 60][(seed + out.length) % 6];
      var stop = Math.min(cursor + slotMinutes * 60000, to);
      var entry = pool[index % pool.length];
      out.push({
        start: cursor,
        stop: stop,
        title: entry[0],
        desc: entry[1],
        category: channel.category,
        episode: ''
      });
      cursor = stop;
      index++;
    }
    return out;
  }

  function useDemo() {
    var now = new Date();
    var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var from = midnight - 6 * 3600000;
    var to = midnight + 42 * 3600000;
    var channels = [];
    var programs = {};
    DEMO_CHANNELS.forEach(function (channel) {
      channels.push({
        id: channel.id,
        name: channel.name,
        number: channel.number,
        icon: '',
        category: channel.category
      });
      programs[channel.id] = demoProgramsFor(channel, from, to);
    });
    state.channels = channels;
    state.programs = programs;
    state.source = 'demo';
    state.error = '';
    state.updated = Date.now();
    return state;
  }

  function load(cfg) {
    var source = (cfg && cfg.epg) || {};
    state.windowHours = U.clamp(Number(source.horizonHours) || 3, 1, 12);
    var url = String(source.xmltvUrl || '').trim();
    if (!url) {
      useDemo();
      return Promise.resolve(state);
    }
    var bust = url.indexOf('?') === -1 ? '?t=' + Date.now() : '&t=' + Date.now();
    return fetch(url + bust, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('Guide request returned HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var parsed = parseXmltv(text);
        state.channels = parsed.channels;
        state.programs = parsed.programs;
        state.source = 'xmltv';
        state.error = '';
        state.updated = Date.now();
        return state;
      })
      .catch(function (err) {
        state.error = 'Guide: ' + (err.message || 'could not load XMLTV');
        if (source.demo !== false) {
          useDemo();
          state.error = 'Guide: ' + (err.message || 'XMLTV failed') + ' — showing demo data';
        }
        return state;
      });
  }

  function nowNext(channelId, at) {
    var time = at || Date.now();
    var list = state.programs[channelId] || [];
    var now = null;
    var next = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].start <= time && list[i].stop > time) now = list[i];
      if (list[i].start > time && (!next || list[i].start < next.start)) next = list[i];
    }
    return { now: now, next: next };
  }

  function programAt(channelId, time) {
    var list = state.programs[channelId] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].start <= time && list[i].stop > time) return list[i];
    }
    return null;
  }

  function range(channelId, from, to) {
    var list = state.programs[channelId] || [];
    return list.filter(function (program) {
      return program.stop > from && program.start < to;
    });
  }

  function channel(id) {
    var found = null;
    state.channels.forEach(function (ch) { if (ch.id === id) found = ch; });
    return found;
  }

  function findChannel(numberOrName) {
    var wanted = String(numberOrName || '').trim().toLowerCase();
    var found = null;
    state.channels.forEach(function (ch) {
      if (found) return;
      if (String(ch.number).toLowerCase() === wanted ||
          String(ch.name).toLowerCase() === wanted ||
          String(ch.id).toLowerCase() === wanted) {
        found = ch;
      }
    });
    return found;
  }

  function summary() {
    var first = state.channels[0];
    var now = first ? nowNext(first.id).now : null;
    return {
      source: state.source,
      channels: state.channels.length,
      updated: state.updated,
      error: state.error,
      now: now ? now.title : ''
    };
  }

  A.EPG = {
    load: load,
    useDemo: useDemo,
    nowNext: nowNext,
    programAt: programAt,
    range: range,
    channel: channel,
    findChannel: findChannel,
    channels: function () { return state.channels; },
    programsFor: function (id) { return state.programs[id] || []; },
    windowHours: function () { return state.windowHours; },
    summary: summary,
    data: function () { return state; }
  };
})(window.Aurora = window.Aurora || {});
