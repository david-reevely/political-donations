/* render.js — pure HTML-string builders for the results area.
 * Mirrors the layout of the Flask app.py so both views look identical.
 * Pure functions (no DOM) so the Node test harness can assert on the markup.
 */
(function (root) {
  "use strict";
  var S = (typeof module !== "undefined" && module.exports)
    ? require("./search.js") : root.Search;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function money(x) {
    return "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var LEGEND = [
    ["Liberal", "#b03030"], ["Conservative", "#1a3a63"], ["Bloc Québécois", "#1f93c9"],
    ["Green", "#2e7d32"], ["NDP", "#c0560a"], ["Other", "#000000"]
  ];

  function viewbar(query, view) {
    var q = encodeURIComponent(query);
    var rec = view !== "chrono" ? "active" : "";
    var chr = view === "chrono" ? "active" : "";
    return "<div class='viewbar'>" +
      "<a class='" + rec + "' data-view='recipient' href='?q=" + q + "&view=recipient'>By recipient</a>" +
      "<a class='" + chr + "' data-view='chrono' href='?q=" + q + "&view=chrono'>Chronological</a></div>";
  }

  function legendHtml() {
    return "<div class='legend'>" + LEGEND.map(function (p) {
      return "<span><i style='background:" + p[1] + "'></i>" + esc(p[0]) + "</span>";
    }).join("") + "</div>";
  }

  function chronoTable(rows) {
    var out = ["<table class='chrono'><tr><th>Date</th>" +
      "<th class='num'>Monetary</th><th class='num'>Non-monetary</th>" +
      "<th>Recipient</th><th>Party</th><th>District</th>" +
      "<th>Contributor (as recorded)</th><th>Type</th>" +
      "<th>City</th><th>Prov</th><th>Postal</th>" +
      "<th>Event / period</th><th>Via</th></tr>"];
    S.sortChrono(rows).forEach(function (r) {
      var color = S.partyColor(r.party);
      var via = r.given || "";
      if (r.leader) via = (via ? via + " " : "") + "[lead: " + r.leader + "]";
      out.push("<tr class='party' style='color:" + color + "'>" +
        "<td>" + esc(r.date) + "</td>" +
        "<td class='num'>" + (r.mon ? money(r.mon) : "") + "</td>" +
        "<td class='num'>" + (r.nonmon ? money(r.nonmon) : "") + "</td>" +
        "<td>" + esc(r.recipient) + "</td>" +
        "<td>" + esc(r.party) + "</td>" +
        "<td>" + esc(r.district) + "</td>" +
        "<td>" + esc(r.name) + "</td>" +
        "<td>" + esc(r.ctype) + "</td>" +
        "<td>" + esc(r.city) + "</td>" +
        "<td>" + esc(r.prov) + "</td>" +
        "<td>" + esc(r.postal) + "</td>" +
        "<td>" + esc(r.event) + "</td>" +
        "<td>" + esc(via) + "</td></tr>");
    });
    out.push("</table>");
    return out.join("");
  }

  function recipientGroups(rows) {
    var out = ["<h2 style='font-size:1rem;margin-top:1.6rem'>Donations by recipient (newest first)</h2>"];
    S.groupByRecipient(rows).forEach(function (g) {
      var meta = [g.party, g.district, g.entity].filter(Boolean).map(esc).join(" &middot; ");
      var subtotal = money(g.mon) + (g.nonmon ? " + " + money(g.nonmon) + " non-monetary" : "");
      out.push("<div class='grp'>");
      out.push("<h2>" + (esc(g.recipient) || "(unnamed recipient)") + "</h2>");
      out.push("<p class='meta'>" + meta + " &mdash; <span class='tot'>" + subtotal +
        "</span> over " + g.rows.length + " donation" + (g.rows.length !== 1 ? "s" : "") + "</p>");
      out.push("<table><tr><th>Date</th><th class='num'>Monetary</th>" +
        "<th class='num'>Non-monetary</th><th>Contributor (as recorded)</th>" +
        "<th>Type</th><th>City</th><th>Prov</th><th>Postal</th>" +
        "<th>Event / period</th><th>Via</th></tr>");
      g.rows.forEach(function (r) {
        var via = r.given || "";
        if (r.leader) via = (via ? via + " " : "") + "[lead: " + r.leader + "]";
        out.push("<tr><td>" + esc(r.date) + "</td>" +
          "<td class='num'>" + (r.mon ? money(r.mon) : "") + "</td>" +
          "<td class='num'>" + (r.nonmon ? money(r.nonmon) : "") + "</td>" +
          "<td>" + esc(r.name) + "</td><td>" + esc(r.ctype) + "</td>" +
          "<td>" + esc(r.city) + "</td><td>" + esc(r.prov) + "</td>" +
          "<td>" + esc(r.postal) + "</td><td>" + esc(r.event) + "</td>" +
          "<td>" + esc(via) + "</td></tr>");
      });
      out.push("</table></div>");
    });
    return out.join("");
  }

  // The pickable disambiguation table. Each row carries data-i = its index in
  // S.summarize(rows); the page maps ticked indices back to name/city/prov keys.
  function pickerTable(summary) {
    var out = ["<table class='summary' id='picker'><tr><th></th>" +
      "<th>Contributor (as recorded)</th><th>City</th><th>Prov</th>" +
      "<th class='num'>Records</th><th class='num'>Monetary</th>" +
      "<th class='num'>Non-monetary</th></tr>"];
    summary.forEach(function (s, i) {
      out.push("<tr data-i='" + i + "'>" +
        "<td><input type='checkbox' class='pick' data-i='" + i + "'></td>" +
        "<td>" + esc(s.name) + "</td><td>" + esc(s.city) + "</td>" +
        "<td>" + esc(s.province) + "</td>" +
        "<td class='num'>" + s.n.toLocaleString() + "</td>" +
        "<td class='num'>" + money(s.mon) + "</td>" +
        "<td class='num'>" + (s.nonmon ? money(s.nonmon) : "") + "</td></tr>");
    });
    out.push("</table>");
    return out.join("");
  }

  // Totals line + the breakdown (grouped or chronological) for whatever set of
  // rows it is handed. Re-rendered on its own when a selection changes.
  function renderLists(rows, view) {
    if (!rows.length) return "<p class='note'>No donations selected.</p>";
    var summary = S.summarize(rows);
    var multi = summary.length > 1;
    var totalMon = rows.reduce(function (a, r) { return a + r.mon; }, 0);
    var totalNon = rows.reduce(function (a, r) { return a + r.nonmon; }, 0);
    var parts = ["<p><strong>" + rows.length.toLocaleString() + "</strong> donation records &mdash; " +
      money(totalMon) + " monetary" + (totalNon ? ", " + money(totalNon) + " non-monetary" : "") +
      " &mdash; across " + summary.length + " distinct name/city combination" + (multi ? "s" : "") + ".</p>"];
    if (view === "chrono") {
      parts.push("<h2 style='font-size:1rem;margin-top:1.2rem'>All donations, chronological (newest first)</h2>");
      parts.push(legendHtml());
      parts.push(chronoTable(rows));
    } else {
      parts.push(recipientGroups(rows));
    }
    return parts.join("");
  }

  // Full results area: view toggle, the picker (when ambiguous), and the lists.
  function renderResults(query, rows, truncated, view) {
    if (!query) return "";
    if (!rows.length) return "<p>No donations found for <strong>" + esc(query) + "</strong>.</p>";

    var parts = [viewbar(query, view)];
    var summary = S.summarize(rows);

    if (truncated) {
      parts.push("<div class='warn'>Showing the first " + S.RESULT_LIMIT.toLocaleString() +
        " matching records (capped). Narrow your search to see the rest.</div>");
    }
    if (summary.length > 1) {
      parts.push("<div class='warn'>More than one name/city combination matched. " +
        "Names are <em>not</em> unique IDs in this data &mdash; tick the row(s) you believe are " +
        "the <strong>same person</strong> to filter the lists below to just those. " +
        "Leave all unticked to see everyone. " +
        "<a href='#' class='clearsel' style='display:none'>Clear selection</a></div>");
      parts.push(pickerTable(summary));
    }
    parts.push("<div id='lists'>" + renderLists(rows, view) + "</div>");
    return parts.join("");
  }

  var api = {
    renderResults: renderResults, renderLists: renderLists, esc: esc, money: money
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Render = api;
})(typeof self !== "undefined" ? self : this);
