/* render.js — pure HTML-string builders for the results area.
 * Pure functions (no DOM) so the Node test harness can assert on the markup.
 * renderResults takes opts = { view, deduped, selected } where `selected` is a
 * map of comboKey -> true for ticked disambiguation rows.
 */
(function (root) {
  "use strict";
  var S = (typeof module !== "undefined" && module.exports)
    ? require("./search.js") : root.Search;

  var SEP = "\u0000";
  function comboKey(name, city, prov) { return name + SEP + city + SEP + prov; }
  function rowCombo(r) { return comboKey(r.name, r.city, r.prov); }

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

  // Dedupe within each name/city combo separately, so identical gifts from
  // *different people* who happen to share nothing but an amount never merge.
  function dedupePerCombo(rows) {
    var by = {};
    rows.forEach(function (r) { (by[rowCombo(r)] || (by[rowCombo(r)] = [])).push(r); });
    var out = [];
    Object.keys(by).forEach(function (k) { out = out.concat(S.dedupe(by[k])); });
    return out;
  }

  function viewbar(view) {
    var rec = view !== "chrono" ? "active" : "";
    var chr = view === "chrono" ? "active" : "";
    return "<div class='viewbar'>" +
      "<a class='" + rec + "' data-view='recipient' href='#'>By recipient</a>" +
      "<a class='" + chr + "' data-view='chrono' href='#'>Chronological</a></div>";
  }

  function dedupeControl(deduped) {
    return "<label class='ctrl'><input type='checkbox' id='dedupe'" +
      (deduped ? " checked" : "") + "> Collapse duplicate filings " +
      "<span class='hint'>(interim/quarterly/directed reports of the same gift)</span></label>";
  }

  function legendHtml() {
    return "<div class='legend'>" + LEGEND.map(function (p) {
      return "<span><i style='background:" + p[1] + "'></i>" + esc(p[0]) + "</span>";
    }).join("") + "</div>";
  }

  function filingsCell(r) {
    var canon = esc(r.report || "");
    if (!r.merged || r.merged.length <= 1) return "<td class='filing'>" + canon + "</td>";
    var items = r.merged.map(function (m) {
      return "<li>" + esc(m.report || "(report)") + " &mdash; " + esc(m.recipient) +
        " <span class='ent'>(" + esc(m.entity) + ")</span> " + money(m.mon) + "</li>";
    }).join("");
    return "<td class='filing'><details><summary>" + r.merged.length +
      " filings</summary><ul>" + items + "</ul></details></td>";
  }

  function chronoTable(rows) {
    var out = ["<table class='chrono'><tr><th>Date</th>" +
      "<th class='num'>Monetary</th><th class='num'>Non-monetary</th>" +
      "<th>Recipient</th><th>Party</th><th>District</th>" +
      "<th>Contributor (as recorded)</th><th>Type</th>" +
      "<th>City</th><th>Prov</th><th>Postal</th>" +
      "<th>Event / period</th><th>Via</th><th>Filing(s)</th></tr>"];
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
        "<td>" + esc(via) + "</td>" +
        filingsCell(r) + "</tr>");
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
        "<th>Event / period</th><th>Via</th><th>Filing(s)</th></tr>");
      g.rows.forEach(function (r) {
        var via = r.given || "";
        if (r.leader) via = (via ? via + " " : "") + "[lead: " + r.leader + "]";
        out.push("<tr><td>" + esc(r.date) + "</td>" +
          "<td class='num'>" + (r.mon ? money(r.mon) : "") + "</td>" +
          "<td class='num'>" + (r.nonmon ? money(r.nonmon) : "") + "</td>" +
          "<td>" + esc(r.name) + "</td><td>" + esc(r.ctype) + "</td>" +
          "<td>" + esc(r.city) + "</td><td>" + esc(r.prov) + "</td>" +
          "<td>" + esc(r.postal) + "</td><td>" + esc(r.event) + "</td>" +
          "<td>" + esc(via) + "</td>" + filingsCell(r) + "</tr>");
      });
      out.push("</table></div>");
    });
    return out.join("");
  }

  function pickerTable(summary, selected) {
    var out = ["<table class='summary' id='picker'><tr><th></th>" +
      "<th>Contributor (as recorded)</th><th>City</th><th>Prov</th>" +
      "<th class='num'>Records</th><th class='num'>Monetary</th>" +
      "<th class='num'>Non-monetary</th></tr>"];
    summary.forEach(function (s) {
      var checked = selected[comboKey(s.name, s.city, s.province)] ? " checked" : "";
      var selCls = checked ? " class='sel'" : "";
      out.push("<tr" + selCls + " data-name=\"" + esc(s.name) + "\" data-city=\"" +
        esc(s.city) + "\" data-prov=\"" + esc(s.province) + "\">" +
        "<td><input type='checkbox' class='pick'" + checked + "></td>" +
        "<td>" + esc(s.name) + "</td><td>" + esc(s.city) + "</td>" +
        "<td>" + esc(s.province) + "</td>" +
        "<td class='num'>" + s.n.toLocaleString() + "</td>" +
        "<td class='num'>" + money(s.mon) + "</td>" +
        "<td class='num'>" + (s.nonmon ? money(s.nonmon) : "") + "</td></tr>");
    });
    out.push("</table>");
    return out.join("");
  }

  function renderLists(rows, view) {
    if (!rows.length) return "<p class='note'>No donations selected.</p>";
    var summary = S.summarize(rows);
    var multi = summary.length > 1;
    var totalMon = rows.reduce(function (a, r) { return a + r.mon; }, 0);
    var totalNon = rows.reduce(function (a, r) { return a + r.nonmon; }, 0);
    var parts = ["<p><strong>" + rows.length.toLocaleString() + "</strong> contributions &mdash; " +
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

  function renderResults(query, rows, truncated, opts) {
    if (!query) return "";
    if (!rows.length) return "<p>No donations found for <strong>" + esc(query) + "</strong>.</p>";
    opts = opts || {};
    var view = opts.view === "chrono" ? "chrono" : "recipient";
    var deduped = opts.deduped !== false;
    var selected = opts.selected || {};
    var hasSel = Object.keys(selected).length > 0;

    // Picker totals: dedupe within each combo so each candidate person's total
    // is shown net of duplicate filings, without merging across people.
    var summaryRows = deduped ? dedupePerCombo(rows) : rows;
    var summary = S.summarize(summaryRows);

    // Lists: filter to the ticked people, then dedupe (across the union, since
    // the user has declared them the same person).
    var listRows = hasSel ? rows.filter(function (r) { return selected[rowCombo(r)]; }) : rows;
    if (deduped) listRows = hasSel ? S.dedupe(listRows) : dedupePerCombo(listRows);

    var parts = [viewbar(view), dedupeControl(deduped)];
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
      parts.push(pickerTable(summary, selected));
    }
    parts.push("<div id='lists'>" + renderLists(listRows, view) + "</div>");
    return parts.join("");
  }

  var api = { renderResults: renderResults, renderLists: renderLists, esc: esc, money: money };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Render = api;
})(typeof self !== "undefined" ? self : this);
