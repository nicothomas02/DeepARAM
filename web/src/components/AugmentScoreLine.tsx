"use client";

import { T } from "./I18n";
import { useOwnerPoints } from "@/lib/owner-view";

// The Patches scorecard's augment line. How many points the picks still led by is augment win-rate points, so only
// the signed-in owner sees it (lib/owner-view.ts); everyone else gets the hit rates.
const pts = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}`;

export default function AugmentScoreLine({ from, hit, phit }: { from: string; hit: string; phit: string }) {
  const owner = useOwnerPoints("patches")?.[from];
  return owner ? (
    <T ns="patches" v={{ hit, lead: pts(owner[0]), phit, plead: pts(owner[1]) }}>
      {"Augments: {hit} still ahead ({lead} pts), most picked {phit} ({plead})"}
    </T>
  ) : (
    <T ns="patches" v={{ hit, phit }}>
      {"Augments: {hit} still ahead, most picked {phit}"}
    </T>
  );
}
