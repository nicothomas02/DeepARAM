"use client";

import { useT } from "@/components/I18n";
import type { Ratings } from "@/lib/champion-tags";

// Riot's five playstyle ratings (1–3), named and explained as the client's champion details screen does.
const BARS: [keyof Ratings, string, string][] = [
  ["damage", "Damage", "The champion's ability to deal damage to enemy champions"],
  ["toughness", "Toughness", "The champion's ability to absorb damage from enemy champions"],
  ["control", "Crowd Control", "The champion's ability to apply harmful effects like slows and stuns to enemy champions"],
  ["mobility", "Mobility", "The champion's ability to move quickly around the map using blinks or dashes"],
  ["utility", "Utility", "The champion's ability to grant beneficial effects like shields, healing, or movement speed to allied champions"],
];

export default function PlaystyleBars({ ratings }: { ratings: Ratings }) {
  const t = useT("champions");
  return (
    <dl className="cp-playstyle">
      {BARS.map(([key, label, hint]) => (
        <div key={key} title={t(hint)}>
          <dt>{t(label)}</dt>
          <dd aria-label={`${ratings[key]} / 3`}>
            {[1, 2, 3].map((n) => (
              <span key={n} data-on={n <= ratings[key] || undefined} />
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
