import languages from "@/i18n/languages.json";

// The site in Riot's languages. Pages are built once, in English; the visitor's language is applied in
// the browser. A page's text is looked up by its English wording in a dictionary per namespace and
// language, web/public/i18n/<namespace>/<code>.json, and champion, item and augment names come from
// web/public/i18n/names/<code>.json (scripts/fetch_names.py). Anything missing stays in English.
// How a tab translates its own page: web/README.md, "Languages".

export type Lang = { code: string; name: string; riot: string; dir?: "rtl" };

export const LANGS = languages as Lang[];
export const DEFAULT_LANG = "en";
/** The visitor's pick, in localStorage. With nothing saved the browser's language is used, when the site has it. */
export const LANG_KEY = "deeparam-lang";
/** Fired on window when the language changes. */
export const LANG_EVENT = "deeparam-lang";

const CODES = new Set(LANGS.map((l) => l.code));

/** The site language closest to a browser language tag: exact, then same language (es-AR → es-MX for Latin America). */
export function matchLang(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const t = tag.trim().replace("_", "-");
  const exact = LANGS.find((l) => l.code.toLowerCase() === t.toLowerCase());
  if (exact) return exact.code;
  const [base, region = ""] = t.toLowerCase().split("-");
  if (base === "zh") return /^(tw|hk|mo|hant)$/.test(region) || /hant/i.test(t) ? "zh-TW" : "zh-CN";
  if (base === "pt") return "pt-BR";
  if (base === "es") return region && region !== "es" ? "es-MX" : "es";
  return CODES.has(base) ? base : null;
}

export const langInfo = (code: string) => LANGS.find((l) => l.code === code) ?? LANGS[0];

/** Fills {name} placeholders. */
export const fill = (s: string, v?: Record<string, string | number>) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);

// Before paint: picks the language, sets <html lang dir data-lang>, and starts loading the shared
// dictionary so it is usually there by the time the page hydrates.
const RTL = LANGS.filter((l) => l.dir === "rtl").map((l) => l.code);
export const LANG_SCRIPT = `try{var L=${JSON.stringify([...CODES])},l=null;try{l=localStorage.getItem(${JSON.stringify(LANG_KEY)})}catch(e){}
if(!l||L.indexOf(l)<0){l="en";var n=(navigator.languages||[navigator.language]);for(var i=0;i<n.length;i++){var t=(n[i]||"").replace("_","-"),b=t.split("-")[0].toLowerCase(),r=(t.split("-")[1]||"").toLowerCase(),m=null;
for(var j=0;j<L.length;j++)if(L[j].toLowerCase()===t.toLowerCase())m=L[j];
if(!m){if(b==="zh")m=/^(tw|hk|mo|hant)$/.test(r)?"zh-TW":"zh-CN";else if(b==="pt")m="pt-BR";else if(b==="es")m=r&&r!=="es"?"es-MX":"es";else if(L.indexOf(b)>=0)m=b}
if(m){l=m;break}if(b==="en")break}}
var d=document.documentElement;d.dataset.lang=l;d.lang=l;if(${JSON.stringify(RTL)}.indexOf(l)>=0)d.dir="rtl";
if(l!=="en"){var k=document.createElement("link");k.rel="preload";k.as="fetch";k.crossOrigin="anonymous";k.href="/i18n/common/"+l+".json";document.head.appendChild(k)}}catch(e){}`;
