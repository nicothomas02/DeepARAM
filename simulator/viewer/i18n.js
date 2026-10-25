// The Simulator in the site's languages. The language is the embedding page's (<html data-lang>), else the
// visitor's saved pick (localStorage "deeparam-lang"), else English. Text is looked up by its English wording
// in /i18n/simulator/<code>.json and champion, item and augment names in /i18n/names/<code>.json, the
// site's own files. Anything missing stays in English. Loaded before the other scripts:
//   T("Average DPS"), T("Done in {s} s.", { s: 1.2 })   page text
//   NAME("items", 3031, "Infinity Edge")              official names (champions by id, items and augments by number)
// The page's own HTML is translated in place (text, title, aria-label and placeholder); I18N.ready resolves
// once the dictionaries are in, and the page reloads when the visitor picks another language.
(() => {
  "use strict";
  const CODES = ["en", "ar", "cs", "de", "el", "es", "es-MX", "fr", "hu", "id", "it", "ja", "ko", "pl", "pt-BR", "ro",
    "ru", "th", "tr", "vi", "zh-CN", "zh-TW"];
  const KEY = "deeparam-lang";
  function pick() {
    try { const l = window.parent !== window && window.parent.document.documentElement.dataset.lang; if (l && CODES.includes(l)) return l; } catch (e) { /* not same origin */ }
    try { const l = localStorage.getItem(KEY); if (l && CODES.includes(l)) return l; } catch (e) { /* storage blocked */ }
    return "en";
  }
  const lang = pick();
  let dict = {}, names = {};
  const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);
  window.T = (s, v) => fill(dict[s] || s, v);
  window.NAME = (kind, id, fallback) => (names[kind] && names[kind][String(id)]) || fallback;

  const html = document.documentElement;
  html.lang = lang;
  html.dataset.lang = lang;
  if (lang === "ar") html.dir = "rtl";

  // The page's HTML: each text node and attribute keeps its English original, so it can be looked up again.
  const ATTRS = ["title", "aria-label", "placeholder"];
  const orig = new WeakMap();
  function translateText(n) {
    const known = orig.get(n);
    const en = known && n.nodeValue === known.out ? known.en : n.nodeValue;
    const key = en.trim().replace(/\s+/g, " ");
    if (!key || !dict[key]) return;
    const out = en.match(/^\s*/)[0] + dict[key] + en.match(/\s*$/)[0];
    orig.set(n, { en, out });
    if (n.nodeValue !== out) n.nodeValue = out;
  }
  function translateEl(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      const k = v && v.trim().replace(/\s+/g, " ");
      if (k && dict[k]) el.setAttribute(a, dict[k]);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { translateText(root); return; }
    if (root.nodeType !== 1 || root.tagName === "SCRIPT" || root.tagName === "STYLE") return;
    translateEl(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === 1 && (n.tagName === "SCRIPT" || n.tagName === "STYLE") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? translateText(n) : translateEl(n);
  }

  const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const ready = lang === "en" ? Promise.resolve() : Promise.all([get(`/i18n/simulator/${lang}.json`), get(`/i18n/names/${lang}.json`)])
    .then(([d, n]) => {
      dict = d; names = n;
      const start = () => {
        const title = document.title.trim().replace(/\s+/g, " ");
        if (dict[title]) document.title = dict[title];
        walk(document.body);
        new MutationObserver((ms) => {
          for (const m of ms) {
            if (m.type === "characterData") translateText(m.target);
            else for (const n of m.addedNodes) walk(n);
          }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      };
      if (document.body) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });
    });
  window.I18N = { lang, ready };

  // A new pick on the site (same origin) reloads the Simulator in that language.
  const changed = () => { if (pick() !== lang) location.reload(); };
  window.addEventListener("storage", (e) => { if (e.key === KEY) changed(); });
  try { window.parent.addEventListener(KEY, changed); } catch (e) { /* not same origin */ }
})();
