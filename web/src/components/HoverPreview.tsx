"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Preview } from "@/lib/previews";
import { useDescription, useNames } from "@/components/I18n";

// Hovering a link to a champion, augment or item page for a moment shows a small card with its
// live-patch numbers. Mouse and trackpad only; the data loads on the first hover.
// Hovering any item or augment icon, link or not, shows its card with the official description (Nico 2026-11-25),
// matched by the icon's address (lib/previews.ts "icon:<src>"); the icon's own title tooltip is held back meanwhile.

const SELECTOR = 'a[href^="/champions/"], a[href^="/augments/"], a[href^="/items/"]';
const DELAY = 350;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

let data: Promise<Record<string, Preview>> | null = null;
const load = (): Promise<Record<string, Preview>> =>
  (data ??= fetch("/data/previews.json")
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, Preview>>) : {}))
    .catch(() => {
      data = null;
      return {};
    }));

type Shown = { p: Preview; x: number; y: number; above: boolean };

export default function HoverPreview() {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef(0);
  const current = useRef<Element | null>(null);
  const titled = useRef<Element | null>(null);
  const names = useNames();
  const describe = useDescription();
  const pathname = usePathname();

  useEffect(() => setShown(null), [pathname]);

  useEffect(() => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    // Put back an icon's title tooltip held back while its card showed.
    const untitle = () => {
      const el = titled.current as HTMLElement | null;
      if (el?.dataset.hpTitle !== undefined) {
        el.setAttribute("title", el.dataset.hpTitle);
        delete el.dataset.hpTitle;
      }
      titled.current = null;
    };
    const hide = () => {
      clearTimeout(timer.current);
      current.current = null;
      untitle();
      setShown(null);
    };
    const over = (e: PointerEvent) => {
      const t = e.target as Element;
      const img = t.tagName === "IMG" ? t : null;
      const a = t.closest?.<HTMLAnchorElement>(SELECTOR) ?? null;
      const el = img ?? a;
      if (el === current.current) return;
      hide();
      if (!el || el.closest(".palette, .site-header, [data-no-preview], .hover-card")) return;
      const path = a ? new URL(a.href, location.href).pathname : null;
      const keys = [img ? `icon:${img.getAttribute("src")}` : null, path && path !== location.pathname ? path : null];
      if (!keys.some(Boolean)) return;
      current.current = el;
      load();
      timer.current = window.setTimeout(async () => {
        const all = await load();
        const k = keys.find((x) => x && (all[x] ?? all[decodeURI(x)]));
        const p = k ? (all[k] ?? all[decodeURI(k)]) : undefined;
        // An icon inside a link to its own page (same card) or to another page with no card for the icon: the link's.
        if (!p || current.current !== el || !el.isConnected) return;
        if (el.hasAttribute("title")) {
          (el as HTMLElement).dataset.hpTitle = el.getAttribute("title") ?? "";
          el.removeAttribute("title");
          titled.current = el;
        }
        const r = el.getBoundingClientRect();
        const above = r.bottom + 180 > innerHeight && r.top > 200;
        setShown({ p, x: Math.min(Math.max(12, r.left), innerWidth - 292), y: above ? r.top - 8 : r.bottom + 8, above });
      }, DELAY);
    };
    addEventListener("pointerover", over, { passive: true });
    addEventListener("scroll", hide, { passive: true, capture: true });
    addEventListener("pointerdown", hide, { passive: true });
    return () => {
      clearTimeout(timer.current);
      removeEventListener("pointerover", over);
      removeEventListener("scroll", hide, { capture: true });
      removeEventListener("pointerdown", hide);
    };
  }, []);

  if (!shown) return null;
  const { p } = shown;
  const kind = p.kind === "item" ? "items" : "augments";
  const name = p.id && p.kind !== "champion" ? names(kind, p.id, p.name) : p.name;
  const desc = p.id && p.desc && p.kind !== "champion" ? describe(kind, p.id, p.desc) : null;
  return (
    <div
      className="hover-card"
      data-above={shown.above || undefined}
      style={{ left: shown.x, top: shown.y }}
      role="tooltip"
    >
      <div className="hover-card-head">
        {p.icon && <img src={p.icon} alt="" width={40} height={40} data-tier={p.kind === "augment" ? p.tier : undefined} />}
        <div>
          <b>{name}</b>
          <span>
            {p.kind === "champion" ? "Champion" : p.kind === "augment" ? `${p.tier ? p.tier[0].toUpperCase() + p.tier.slice(1) : ""} augment` : "Item"}
          </span>
        </div>
        {p.kind === "champion" && p.tier && <span className={`chip tier-${p.tier.toLowerCase()}`}>{p.tier}</span>}
      </div>
      {p.winRate !== undefined && (
        <dl className="hover-card-stats">
          <div>
            <dt>Win rate</dt>
            <dd className={p.winRate >= 0.52 ? "wr-high" : p.winRate <= 0.48 ? "wr-low" : ""}>{pct(p.winRate)}</dd>
          </div>
          {p.pickRate !== undefined && (
            <div>
              <dt>Pick rate</dt>
              <dd>{pct(p.pickRate)}</dd>
            </div>
          )}
        </dl>
      )}
      {desc && <p className="hover-card-desc">{desc}</p>}
      {p.lines?.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
