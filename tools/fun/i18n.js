// The Kitchen (and the pages that moved out of The Lab) in the site's languages. The site sets <html data-lang> on the page around this one (and keeps the
// visitor's pick in localStorage "deeparam-lang"); every Lab page reads it, loads i18n/<code>.json (English
// text → translation, same convention as web/public/i18n) and the official champion, item and augment names
// from /i18n/names/<code>.json, then translates its static text and starts its script. Missing text stays English.
(function () {
  "use strict";
  var KEY = "deeparam-lang";
  var RTL = ["ar"];
  var base = (document.currentScript && document.currentScript.src.replace(/[^/]*$/, "")) || "";

  function pick() {
    try { var p = window.parent !== window && window.parent.document.documentElement.dataset.lang; if (p) return p; } catch (e) { /* not same origin */ }
    try { var s = localStorage.getItem(KEY); if (s) return s; } catch (e) { /* storage blocked */ }
    return document.documentElement.dataset.lang || "en";
  }

  var lang = pick();
  var dict = {}, names = {}, waiting = [], loaded = lang === "en";

  function fill(s, v) { return v ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return k in v ? String(v[k]) : m; }) : String(s); }
  function t(s, v) { return fill(Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s, v); }
  // kind: "champions" (by key, e.g. "KogMaw"), "items" or "augments" (by id).
  function name(kind, id, fallback) { var m = names[kind]; return (m && id != null && m[String(id)]) || fallback; }
  function date(iso, opts) { return new Date(iso + "T12:00:00").toLocaleDateString(lang === "en" ? "en-US" : lang, opts); }
  function num(n, opts) { return Number(n).toLocaleString(lang === "en" ? "en-US" : lang, opts); }

  // Static page text: whole text nodes and a few attributes whose English wording is a key.
  function translatePage() {
    if (lang === "en") return;
    var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return /^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    for (var n; (n = walk.nextNode());) {
      var k = n.nodeValue.replace(/\s+/g, " ").trim();
      if (k && Object.prototype.hasOwnProperty.call(dict, k)) n.nodeValue = n.nodeValue.replace(/\S[\s\S]*\S|\S/, dict[k]);
    }
    var els = document.querySelectorAll("[aria-label],[title],[placeholder],meta[name=description]");
    for (var i = 0; i < els.length; i++) {
      ["aria-label", "title", "placeholder", "content"].forEach(function (a) {
        var v = els[i].getAttribute(a);
        if (v && Object.prototype.hasOwnProperty.call(dict, v.trim())) els[i].setAttribute(a, dict[v.trim()]);
      });
    }
    document.title = document.title.split(" · ").map(function (p) { return t(p); }).join(" · ");
  }

  function done() {
    loaded = true;
    var d = document.documentElement;
    d.lang = lang;
    d.dataset.lang = lang;
    if (RTL.indexOf(lang) >= 0) d.dir = "rtl";
    translatePage();
    waiting.splice(0).forEach(function (f) { f(); });
  }

  function get(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
  }

  window.LabI18n = {
    lang: lang, t: t, name: name, date: date, num: num,
    // Runs fn once the dictionaries are in (straight away in English).
    ready: function (fn) { if (loaded) fn(); else waiting.push(fn); },
  };

  if (lang !== "en") {
    Promise.all([get(base + "i18n/" + lang + ".json"), get("/i18n/names/" + lang + ".json")]).then(function (r) {
      dict = r[0] || {};
      names = r[1] || {};
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", done); else done();
    });
  }

  // A new pick on the site reloads the page in that language.
  function changed() { if (pick() !== lang) location.reload(); }
  try { window.parent.addEventListener(KEY, changed); } catch (e) { /* not same origin */ }
  window.addEventListener("storage", function (e) { if (e.key === KEY) changed(); });
})();
