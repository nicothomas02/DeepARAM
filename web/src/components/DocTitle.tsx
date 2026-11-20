"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { DEFAULT_LANG, fill, LANG_EVENT } from "@/lib/i18n";
import { useLang, useNames, useT } from "./I18n";

// The browser-tab title, in the visitor's language and for the open tab (?tab=) of the Tier List, Simulator and
// Kitchen (Nico, 2026-11-20). Pages are built in English, so their titles are too; this rewrites document.title in
// the browser from public/i18n/titles/<code>.json, whose keys are the English titles with {mode} for the mode's
// name, {patch}, and {name} for a champion, augment or item. Search engines keep reading the English title.

const MODE = "ARAM Mayhem";
const SUFFIX = " · DeepARAM";

// English titles for tabs that are not the page's first one; {patch} is taken from the page's own title.
const TAB_TITLES: Record<string, Record<string, string>> = {
  "/tier-list": { augments: "{mode} Augment Tier List, Patch {patch}", items: "{mode} Item Tier List, Patch {patch}" },
  "/kitchen": { "infinite-ryze": "Infinite Ryze" },
};

// Every title with a translation; the order matters only where two could match.
const TEMPLATES = [
  "{mode} Tier List, Augments & Builds",
  "{mode} Augment Tier List, Patch {patch}",
  "{mode} Item Tier List, Patch {patch}",
  "{mode} Tier List, Patch {patch}",
  "{mode} Teamfight Simulator",
  "The Kitchen: Off-Meta {mode} Builds",
  "Infinite Ryze",
  "{mode} PBE Changes",
  "{mode} Patches",
  "How {mode} Works: Rules, Quests & Augments",
  "{mode} Champions A to Z",
  "{mode} Patch {patch} Recap",
  "Region Teams",
  "Privacy",
  "Terms",
  "Methodology",
  "Research",
  "Answers",
  "Your account",
  "Page not found",
  "{name} {mode} Build & Augments",
  "{name} {mode} Augment",
  "{name} in {mode}",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = TEMPLATES.map((t) => {
  const keys: string[] = [];
  const rx = escape(t).replace(/\\\{(\w+)\\\}/g, (_, k: string) => {
    if (k === "mode") return escape(MODE);
    keys.push(k);
    return k === "patch" ? "([\\d.]+)" : "(.+)";
  });
  return { template: t, keys, rx: new RegExp(`^${rx}$`) };
});

/** The template an English title comes from, and its values. */
export function matchTitle(en: string): { template: string; v: Record<string, string> } | null {
  for (const p of PATTERNS) {
    const m = p.rx.exec(en);
    if (m) return { template: p.template, v: Object.fromEntries(p.keys.map((k, i) => [k, m[i + 1]])) };
  }
  return null;
}

/** Splits a page title into its core and its framing ("DeepARAM: …" on Home, "… · DeepARAM" elsewhere). */
function split(title: string): [string, string, string] {
  if (title.startsWith("DeepARAM: ")) return ["DeepARAM: ", title.slice(10), ""];
  if (title.endsWith(SUFFIX)) return ["", title.slice(0, -SUFFIX.length), SUFFIX];
  return ["", title, ""];
}

export default function DocTitle() {
  const path = usePathname();
  const lang = useLang();
  const t = useT("titles");
  const names = useNames();
  // The page's own (English) title, read once per page; what we last wrote, to tell the two apart.
  const original = useRef<{ path: string; title: string } | null>(null);
  const written = useRef("");

  useEffect(() => {
    const apply = () => {
      if (!original.current || original.current.path !== path || (document.title !== written.current && document.title !== original.current.title)) {
        original.current = { path, title: document.title };
      }
      const [pre, core, post] = split(original.current.title);
      const tab = new URLSearchParams(location.search).get("tab");
      const found = matchTitle(core);
      const tabTemplate = tab ? TAB_TITLES[path]?.[tab] : undefined;
      const template = tabTemplate ?? found?.template;
      if (!template) return;
      const v: Record<string, string> = { ...(found?.v ?? {}) };
      const mode = lang === DEFAULT_LANG ? MODE : names("mode", "", MODE);
      if (v.name) {
        const champ = /^\/champions\/([^/]+)$/.exec(path)?.[1];
        const tag = document.querySelector<HTMLMetaElement>('meta[name="deeparam-name"]')?.content.split(":");
        if (champ) v.name = names("champions", champ, v.name);
        else if (tag?.length === 2 && (tag[0] === "augments" || tag[0] === "items")) v.name = names(tag[0], tag[1], v.name);
      }
      let core2 = fill(t(template), { ...v, mode });
      // A mode name with its own colon ("ARAM: Chaos") reads better with a dash before the rest than a second colon.
      if (/[:：]/.test(mode)) core2 = core2.replace(`${mode}: `, `${mode} – `).replace(`${mode}：`, `${mode} – `);
      // Home is "DeepARAM: …" in English; translated, the site's name goes at the end like every other page.
      const next = lang !== DEFAULT_LANG && pre ? core2 + SUFFIX : pre + core2 + post;
      written.current = next;
      if (document.title !== next) document.title = next;
    };
    // Next sets the new page's title as it commits the page (sometimes after this runs), so read it a moment
    // after and again whenever the <title> changes to something this didn't write.
    const id = setTimeout(apply, 0);
    const watch = new MutationObserver(() => {
      if (document.title !== written.current) apply();
    });
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    addEventListener("deeparam-url", apply);
    addEventListener("popstate", apply);
    addEventListener(LANG_EVENT, apply);
    return () => {
      clearTimeout(id);
      watch.disconnect();
      removeEventListener("deeparam-url", apply);
      removeEventListener("popstate", apply);
      removeEventListener(LANG_EVENT, apply);
    };
  }, [path, lang, t, names]);
  return null;
}
