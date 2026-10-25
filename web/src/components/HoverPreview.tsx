"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Preview } from "@/lib/previews";

// Hovering a link to a champion, augment or item page for a moment shows a small card with its
// live-patch numbers. Mouse and trackpad only; the data loads on the first hover.

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
  const current = useRef<HTMLAnchorElement | null>(null);
  const pathname = usePathname();

  useEffect(() => setShown(null), [pathname]);

  useEffect(() => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const hide = () => {
      clearTimeout(timer.current);
      current.current = null;
      setShown(null);
    };
    const over = (e: PointerEvent) => {
      const a = (e.target as Element).closest?.<HTMLAnchorElement>(SELECTOR);
      if (a === current.current) return;
      hide();
      if (!a || a.closest(".palette, .site-header, [data-no-preview]")) return;
      const path = new URL(a.href, location.href).pathname;
      if (path === location.pathname) return;
      current.current = a;
      load();
      timer.current = window.setTimeout(async () => {
        const all = await load();
        const p = all[decodeURI(path)] ?? all[path];
        if (!p || current.current !== a || !a.isConnected) return;
        const r = a.getBoundingClientRect();
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
          <b>{p.name}</b>
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
      {p.lines?.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
