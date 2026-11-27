"use client";

import { useEffect, useState } from "react";
import { adminFlag } from "./admin-flag";
import type { SynergyPair } from "./synergy-picks";

// The owner view (Nico 2026-11-27): augment win-rate points stay off the public site (lib/augment-policy.ts), and the
// signed-in owner gets them back from /api/owner/points (lib/owner-points.ts builds them). Pages render the public
// version; for the owner, these hooks fetch the numbers after load and the components put them back in.

type N = number | null;

export type OwnerPoints = {
  /** Tier List augments tab: augment id -> win rate boost, lead over its rarity's average (for the DeepScore hover),
   *  how much the boost varies by champion, and the champion with the biggest boost. Fractions. */
  tierList: Record<string, { lift: N; edge: N; spread: N; best: string | null }>;
  /** Augment pages: id -> DeepScore lead, best champions by boost [alias, boost], and each champion's synergy score. */
  augments: Record<string, { edge: N; best: [string, N][]; champions: Record<string, number> }>;
  /** Champion pages: alias -> each augment's [boost, DeepScore lead (pooled), DeepScore lead (live patch only)], and the
   *  synergy pairs' points [a, b, points, then the two pick-order points when order matters]. */
  champions: Record<string, { rows: Record<string, [N, N, N]>; pairs: [number, number, number, ...number[]][] }>;
  /** Patches page scorecard: from-patch -> augment [DeepScore picks' lead, most picked's lead] (fractions). */
  patches: Record<string, [number, number]>;
};

export type OwnerView = keyof OwnerPoints;
type Slice<V extends OwnerView> = V extends "tierList" | "patches" ? OwnerPoints[V] : OwnerPoints[V][string];

const cache = new Map<string, Promise<unknown>>();

/** The owner's numbers for one view (and one champion or augment), or null for everyone else and until they load. */
export function useOwnerPoints<V extends OwnerView>(view: V, id?: string | number): Slice<V> | null {
  const [data, setData] = useState<Slice<V> | null>(null);
  useEffect(() => {
    if (!adminFlag() || ((view === "augments" || view === "champions") && id === undefined)) return;
    const q = `view=${view}${id === undefined ? "" : `&id=${encodeURIComponent(String(id))}`}`;
    let p = cache.get(q);
    if (!p) {
      p = fetch(`/api/owner/points?${q}`, { credentials: "same-origin", cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      cache.set(q, p);
    }
    let live = true;
    p.then((d) => live && d && setData(d as Slice<V>));
    return () => {
      live = false;
    };
  }, [view, id]);
  return data;
}

/** The public pairs (direction only) with the owner's points put back. */
export function ownerPairs(pairs: SynergyPair[], points: OwnerPoints["champions"][string]["pairs"]): SynergyPair[] {
  const by = new Map(points.map((p) => [`${p[0]}-${p[1]}`, p]));
  return pairs.map((p) => {
    const o = by.get(`${p.a}-${p.b}`);
    return o ? { ...p, points: o[2], ...(o.length > 3 ? { order: [o[3], o[4]] as [number, number] } : {}) } : p;
  });
}
