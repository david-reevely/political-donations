/* search.js — pure search logic for the static contributor-donation site.
 * Loaded by index.html in the browser and by the Node test harness.
 * Normalization and the FNV-1a hash here must match build_site.py exactly,
 * or the browser will compute different shard buckets than the builder did.
 */
(function (root) {
  "use strict";

  var RESULT_LIMIT = 8000;

  var COMBINING = /[\u0300-\u036f]/g;
  var APOSTROPHE = /['\u2019\u2018\u0060\u00b4]/g;
  var NONWORD = /[^a-z0-9 ]+/g;
  var SPACES = /\s+/g;

  function normalize(s) {
    if (!s) return "";
    s = s.normalize("NFKD").replace(COMBINING, "");
    s = s.toLowerCase();
    s = s.replace(APOSTROPHE, "");
    s = s.replace(NONWORD, " ");
    return s.replace(SPACES, " ").trim();
  }

  // 32-bit FNV-1a over UTF-8 bytes. Normalized tokens are ASCII, so char codes
  // equal byte values; Math.imul keeps the multiply in 32-bit like Python's mask.
  function fnv1a32(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function tokenize(query) {
    var t = normalize(query);
    return t ? t.split(" ") : [];
  }

  function queryBuckets(query, nbuckets) {
    var tokens = tokenize(query);
    var set = {};
    for (var i = 0; i < tokens.length; i++) {
      set[fnv1a32(tokens[i]) % nbuckets] = true;
    }
    return { tokens: tokens, buckets: Object.keys(set).map(Number) };
  }

  // Expand a raw shard payload into row objects with resolved dictionary values
  // and dollar amounts. Row array layout is defined in build_site.py.
  function expandShard(shard) {
    var d = shard.d, out = [];
    for (var i = 0; i < shard.rows.length; i++) {
      var r = shard.rows[i];
      out.push({
        id: r[0],
        date: r[1],
        recipient: d.r[r[2]] || "",
        party: d.p[r[3]] || "",
        district: d.t[r[4]] || "",
        entity: d.e[r[5]] || "",
        ctype: d.c[r[6]] || "",
        name: r[7],
        city: r[8],
        prov: r[9],
        postal: r[10],
        mon: r[11] / 100,
        nonmon: r[12] / 100,
        event: d.v[r[13]] || "",
        given: r[14],
        leader: r[15],
        report: (d.f && d.f[r[16]]) || "",
        part: (d.g && d.g[r[17]]) || ""
      });
    }
    return out;
  }

  function rowTokens(r) {
    var blob = normalize(r.name + " " + r.city + " " + r.prov + " " + r.postal);
    return blob ? blob.split(" ") : [];
  }

  function matchRow(r, tokens) {
    var set = {}, t = rowTokens(r);
    for (var i = 0; i < t.length; i++) set[t[i]] = true;
    for (var j = 0; j < tokens.length; j++) {
      if (!set[tokens[j]]) return false;
    }
    return true;
  }

  // loadBucket(bucketNumber) -> Promise<Array<rowObject>> (caller caches).
  async function runQuery(query, nbuckets, loadBucket) {
    var qb = queryBuckets(query, nbuckets);
    if (!qb.tokens.length) return { rows: [], truncated: false };
    var seen = {}, out = [], truncated = false;
    for (var i = 0; i < qb.buckets.length && !truncated; i++) {
      var rows = await loadBucket(qb.buckets[i]);
      for (var k = 0; k < rows.length; k++) {
        var r = rows[k];
        if (seen[r.id]) continue;
        if (matchRow(r, qb.tokens)) {
          seen[r.id] = true;
          out.push(r);
          if (out.length > RESULT_LIMIT) { truncated = true; break; }
        }
      }
    }
    return { rows: out.slice(0, RESULT_LIMIT), truncated: truncated };
  }

  // ---- party colours (mirror of app.py) ----------------------------------
  var PARTY_RULES = [
    ["liberal", "#b03030"], ["conservative", "#1a3a63"], ["bloc", "#1f93c9"],
    ["green", "#2e7d32"], ["new democratic", "#c0560a"], ["ndp", "#c0560a"]
  ];
  function partyColor(party) {
    var p = (party || "").toLowerCase();
    for (var i = 0; i < PARTY_RULES.length; i++) {
      if (p.indexOf(PARTY_RULES[i][0]) !== -1) return PARTY_RULES[i][1];
    }
    return "#000000";
  }

  function summarize(rows) {
    var m = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], key = r.name + "\u0000" + r.city + "\u0000" + r.prov;
      var b = m[key] || (m[key] = { name: r.name, city: r.city, province: r.prov, n: 0, mon: 0, nonmon: 0 });
      b.n++; b.mon += r.mon; b.nonmon += r.nonmon;
    }
    var out = Object.keys(m).map(function (k) { return m[k]; });
    out.sort(function (a, b) { return (b.mon - a.mon) || (b.n - a.n); });
    return out;
  }

  function groupByRecipient(rows) {
    var m = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var key = [r.recipient, r.party, r.district, r.entity].join("\u0000");
      (m[key] || (m[key] = [])).push(r);
    }
    var out = Object.keys(m).map(function (k) {
      var items = m[k];
      items.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
      var mon = 0, nonmon = 0;
      for (var i = 0; i < items.length; i++) { mon += items[i].mon; nonmon += items[i].nonmon; }
      return {
        recipient: items[0].recipient, party: items[0].party,
        district: items[0].district, entity: items[0].entity,
        rows: items, mon: mon, nonmon: nonmon, latest: items[0].date || ""
      };
    });
    out.sort(function (a, b) { return (b.latest || "").localeCompare(a.latest || ""); });
    return out;
  }

  function sortChrono(rows) {
    return rows.slice().sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    });
  }

  // ---- deduplication -----------------------------------------------------
  // The "as filed" file stacks the same contribution from overlapping returns:
  // interim weekly vs final leadership returns, quarterly vs comprehensive party
  // returns, and directed contributions reported by both the party and the
  // leadership campaign. We collapse those to one row per real gift, attributing
  // directed contributions to the leadership campaign, and keep the raw filings
  // on each survivor (.merged) so the UI can expand them.

  function cents(x) { return Math.round((x || 0) * 100); }

  function reportPriority(r) {
    var t = (r.report || "").toLowerCase();
    if (t.indexOf("weekly") !== -1) return 1;     // interim, superseded
    if (t.indexOf("quarterly") !== -1) return 2;  // periodic
    return 3;                                      // final / comprehensive
  }
  function isDirected(r) { return (r.part || "").toLowerCase().indexOf("directed") !== -1; }
  function entitySide(r) {
    var e = (r.entity || "").toLowerCase();
    if (e.indexOf("parties") !== -1) return "party";
    if (e.indexOf("leadership") !== -1) return "leadership";
    return "other";
  }

  function dedupe(rows) {
    // Stage 1: collapse identical gifts (same recipient, date, amount) that
    // recur across different returns; keep the most authoritative as canonical.
    var groups = {};
    rows.forEach(function (r) {
      var k = [r.recipient, r.date, cents(r.mon), cents(r.nonmon)].join("\u0000");
      (groups[k] || (groups[k] = [])).push(r);
    });
    var stage1 = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], canon = g[0];
      for (var i = 1; i < g.length; i++) {
        if (reportPriority(g[i]) > reportPriority(canon)) canon = g[i];
      }
      var c = {};
      for (var key in canon) if (canon.hasOwnProperty(key)) c[key] = canon[key];
      c.merged = g.slice();
      stage1.push(c);
    });

    // Stage 2: a directed contribution shows up on both the party's books and
    // the leadership campaign's; merge the party-side row into the matching
    // leadership-side row (same date + amount), attributing it to the campaign.
    var leadIndex = {};
    stage1.forEach(function (r) {
      if (isDirected(r) && entitySide(r) === "leadership") {
        var k = [r.date, cents(r.mon), cents(r.nonmon)].join("\u0000");
        (leadIndex[k] || (leadIndex[k] = [])).push(r);
      }
    });
    var dropped = [];
    var keep = stage1.filter(function (r) {
      if (isDirected(r) && entitySide(r) === "party") {
        var k = [r.date, cents(r.mon), cents(r.nonmon)].join("\u0000");
        var ls = leadIndex[k];
        if (ls && ls.length) {
          ls[0].merged = ls[0].merged.concat(r.merged);
          dropped.push(r);
          return false;
        }
      }
      return true;
    });
    return keep;
  }

  var api = {
    RESULT_LIMIT: RESULT_LIMIT,
    normalize: normalize, fnv1a32: fnv1a32, tokenize: tokenize,
    queryBuckets: queryBuckets, expandShard: expandShard, matchRow: matchRow,
    runQuery: runQuery, partyColor: partyColor, summarize: summarize,
    groupByRecipient: groupByRecipient, sortChrono: sortChrono, dedupe: dedupe
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Search = api;
})(typeof self !== "undefined" ? self : this);
