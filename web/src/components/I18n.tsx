"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_LANG, fill, LANG_EVENT, LANG_KEY, langInfo } from "@/lib/i18n";

// The browser side of lib/i18n.ts. Pages render in English on the server; after hydration these swap in
// the visitor's language once its dictionary has loaded. Usable from server components too:
//   <T>Best augments</T>                      shared site text (namespace "common")
//   <T ns="tier-list" v={{ n }}>{"All {n} →"}</T>  a tab's own namespace, with placeholders
//   <Name kind="champions" id="AurelionSol">Aurelion Sol</Name>
// and in client components: const t = useT("tier-list"); t("Win rate"); const name = useNames(); name("items", 3031, "Infinity Edge").

type Dict = Record<string, string>;
export type NameKind = "champions" | "items" | "augments";
type Names = Partial<Record<NameKind, Dict>> & { mode?: string };

const dicts = new Map<string, Dict | "loading" | "failed">();
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((f) => f());
};

function current(): string {
  if (typeof document === "undefined") return DEFAULT_LANG;
  return document.documentElement.dataset.lang || DEFAULT_LANG;
}

function load(path: string) {
  if (dicts.has(path)) return;
  dicts.set(path, "loading");
  fetch(path)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d: Dict) => dicts.set(path, d))
    .catch(() => dicts.set(path, "failed"))
    .finally(notify);
}

function dict(path: string): Dict | null {
  const d = dicts.get(path);
  if (d === undefined) load(path);
  return d && typeof d === "object" ? d : null;
}

function subscribe(f: () => void) {
  listeners.add(f);
  const onLang = () => f();
  addEventListener(LANG_EVENT, onLang);
  return () => {
    listeners.delete(f);
    removeEventListener(LANG_EVENT, onLang);
  };
}

// The snapshot changes when the language or any dictionary does, so readers re-render then.
// On the server, and during hydration, it is English, which keeps the first render identical.
const snapshot = () => `${current()}#${version}`;
const serverSnapshot = () => `${DEFAULT_LANG}#0`;

/** The language pages are shown in, "en" until hydration. */
export function useLang(): string {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot).split("#")[0];
}

/** Switches the site's language and remembers it in this browser. */
export function setLang(code: string) {
  const info = langInfo(code);
  try {
    localStorage.setItem(LANG_KEY, info.code);
  } catch {}
  const root = document.documentElement;
  root.dataset.lang = info.code;
  root.lang = info.code;
  if (info.dir) root.dir = info.dir;
  else root.removeAttribute("dir");
  dispatchEvent(new Event(LANG_EVENT));
}

/** A translator for one namespace: t("English text", { placeholder: value }). A namespace starting with "/" is a
 *  folder of its own, such as an embedded tab's "/embed/champions/i18n". */
export function useT(ns = "common") {
  const lang = useLang();
  const d = lang === DEFAULT_LANG ? null : dict(ns.startsWith("/") ? `${ns}/${lang}.json` : `/i18n/${ns}/${lang}.json`);
  return useCallback((en: string, v?: Record<string, string | number>) => fill(d?.[en] || en, v), [d]);
}

/** Official champion, item and augment names (and the mode's name) in the page's language. */
export function useNames() {
  const lang = useLang();
  const d = (lang === DEFAULT_LANG ? null : dict(`/i18n/names/${lang}.json`)) as Names | null;
  return useCallback((kind: NameKind | "mode", id: string | number, en: string) => (kind === "mode" ? d?.mode : d?.[kind]?.[String(id)]) || en, [d]);
}

/** Translated text. `children` is the English wording (a plain string), which is also the dictionary key. */
export function T({ children, ns, v }: { children: string; ns?: string; v?: Record<string, string | number> }) {
  return useT(ns)(children, v);
}

/** A champion, item or augment name in the page's language; `children` is the English name. */
export function Name({ kind, id, children }: { kind: NameKind; id: string | number; children: string }) {
  return useNames()(kind, id, children);
}

/** An augment's or item's official description in the page's language (scripts/fetch_descriptions.py): one
 *  paragraph per line, with a passive's or active's name, written §Name§, in bold. `children` is the English text. */
export function Description({ kind, id, children }: { kind: "items" | "augments"; id: string | number; children: string }) {
  const lang = useLang();
  const d = (lang === DEFAULT_LANG ? null : dict(`/i18n/descriptions/${lang}.json`)) as Partial<Record<string, Dict>> | null;
  const text = d?.[kind]?.[String(id)] || children;
  return (
    <div className="official-desc">
      {text.split("\n").map((line, i) => {
        const m = line.match(/^§([^§]+)§\s*(.*)$/);
        return <p key={i}>{m ? <><b>{m[1]}</b> {m[2]}</> : line}</p>;
      })}
    </div>
  );
}

/** The mode's official name in the page's language ("ARAM Mayhem" in English). */
export function ModeName({ children = "ARAM Mayhem" }: { children?: string }) {
  return useNames()("mode", "", children);
}

/** A date written the way the page's language writes it. `iso` is any date string Date understands. */
export function LocalDate({ iso, options = { month: "short", day: "numeric", timeZone: "UTC" } }: { iso: string; options?: Intl.DateTimeFormatOptions }) {
  const lang = useLang();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(lang === DEFAULT_LANG ? "en-US" : lang, options);
}
