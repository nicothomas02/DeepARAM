"use client";

import { useNames, useT } from "@/components/I18n";
import type { BuildWhy as Why } from "@/lib/why-best";
import { whatItDoesText } from "@/lib/mechanism-text";

/** Each kit trait's reason, the same words as the build engine's whyBest (lib/engine), so site and apps agree. */
export const KIT_WHY = {
  physical: "Fits {champion}'s physical damage.",
  carry: "Fits a carry, not a tank.",
  tank: "Fits a champion who takes the hits.",
  melee: "Stronger on melee champions.",
} as const;

/** "Why these items" under the card's build: one short reason per item that has one (Nico approved, 2026-11-23). */
export default function BuildWhy({ why, champion, championId, items }: { why: Why; champion: string; championId: number; items: Record<number, { name: string }> }) {
  const t = useT("champions");
  const tt = useT("tables");
  const names = useNames();
  if (!why.follow.length && !why.lines.length) return null;
  const champ = names("champions", championId, champion);
  const item = (id: number) => names("items", id, items[id]?.name ?? "");
  return (
    <details className="cp-why">
      <summary>{t("Why these items")}</summary>
      <ul>
        {why.follow.length > 0 && (
          <li>
            <b>{why.follow.map(item).join(", ")}</b>: {t("Built by most {champion} players.", { champion: champ })}
          </li>
        )}
        {/* Items with the same kit reason share a line. */}
        {(Object.keys(KIT_WHY) as (keyof typeof KIT_WHY)[]).map((k) => {
          const ids = why.lines.filter((l) => l.kit === k).map((l) => l.id);
          return ids.length ? (
            <li key={k}>
              <b>{ids.map(item).join(", ")}</b>: {t(KIT_WHY[k], { champion: champ })}
            </li>
          ) : null;
        })}
        {why.lines
          .filter((l) => !l.kit)
          .map((l) => (
            <li key={l.id}>
              <b>{item(l.id)}</b>: {whatItDoesText(tt, l.effects ?? [])}
            </li>
          ))}
      </ul>
    </details>
  );
}
