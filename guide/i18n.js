// The page in the site's languages (the same file is in guide/ and champions/). The language is the site's: the
// parent page's <html data-lang>, else the visitor's saved pick, else English. Page text is looked up by its English
// wording in i18n/<code>.json; game text (names, abilities, tooltips) comes in each language from i18n/data/<code>.json
// and is merged into the page's data before it renders. Anything without a translation stays in English.
(() => {
  const CODES = ["en", "ar", "cs", "de", "el", "es", "es-MX", "fr", "hu", "id", "it", "ja", "ko", "pl", "pt-BR", "ro", "ru", "th", "tr", "vi", "zh-CN", "zh-TW"];
  const site = () => { try { return parent.document.documentElement.dataset.lang || ""; } catch { return ""; } };
  let lang = site();
  if (!lang) try { lang = localStorage.getItem("deeparam-lang") || ""; } catch { /* storage blocked */ }
  if (!CODES.includes(lang)) lang = "en";
  const root = document.documentElement;
  root.lang = lang;
  root.dataset.lang = lang;
  if (lang === "ar") root.dir = "rtl";

  const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);
  const I = (window.I18N = {
    lang,
    ui: {},
    data: {},
    /** The page's wording for an English string; {name} placeholders are filled from v. */
    t: (s, v) => fill((s != null && I.ui[s]) || String(s ?? ""), v),
    num: (n, d = 2) => Number(n).toLocaleString(lang === "en" ? "en-US" : lang, { maximumFractionDigits: d }),
    date: (iso, opts) => new Date(iso).toLocaleDateString(lang === "en" ? "en-US" : lang, opts),
    /** Copies a translation tree into the page's data: objects by key, arrays by index. */
    merge(target, ov) {
      if (!target || !ov || typeof ov !== "object") return target;
      for (const [k, v] of Object.entries(ov)) {
        if (v && typeof v === "object" && target[k] && typeof target[k] === "object") I.merge(target[k], v);
        else if (typeof v === "string" && (target[k] == null || typeof target[k] === "string")) target[k] = v;
      }
      return target;
    },
    /** Another translation file in this folder, i18n/<dir>/<code>.json ({} in English). */
    load: (dir) => (lang === "en" ? Promise.resolve({}) : get(`i18n/${dir}/${lang}.json`)),
    /** Static text: an element with data-t uses its own English text as the key; data-t-attr names attributes. */
    dom(el = document) {
      for (const n of el.querySelectorAll("[data-t]")) {
        const key = n.textContent.replace(/\s+/g, " ").trim();
        if (I.ui[key]) n.textContent = I.ui[key];
      }
      for (const n of el.querySelectorAll("[data-t-attr]")) {
        for (const a of n.dataset.tAttr.split(",")) if (n.hasAttribute(a)) n.setAttribute(a, I.t(n.getAttribute(a)));
      }
      if (document.title) document.title = I.t(document.title);
    },
  });

  // In another language the page stays hidden until its text is in, so English doesn't flash first
  if (lang !== "en") root.style.visibility = "hidden";
  I.ready = (lang === "en" ? Promise.resolve([{}, {}]) : Promise.all([get(`i18n/${lang}.json`), get(`i18n/data/${lang}.json`)]))
    .then(([ui, data]) => {
      I.ui = ui;
      I.data = data;
      const show = () => { I.dom(); root.style.visibility = ""; };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
      else show();
    });
  setTimeout(() => { root.style.visibility = ""; }, 4000);

  // A new pick on the site reloads the page in that language
  try {
    if (parent !== window) {
      new MutationObserver(() => { if (site() && site() !== lang) location.reload(); })
        .observe(parent.document.documentElement, { attributes: true, attributeFilter: ["data-lang"] });
    }
  } catch { /* not the site's own page */ }
  addEventListener("storage", (e) => { if (e.key === "deeparam-lang" && parent === window && (e.newValue || "en") !== lang) location.reload(); });
})();
