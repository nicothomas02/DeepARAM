"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Name, T, useT } from "@/components/I18n";
import type { AugmentBuilds, BuildItem } from "@/lib/augment-builds";

// "Build for your augments" on a champion page: the build above assumes no particular augment; pick one augment (or
// two that are often taken together) to see the Simulator's best items with it. Augments whose build differs by two
// or more items are marked as changing the build.

const NS = "champions";

function Items({ items, base }: { items: BuildItem[]; base?: Set<number> }) {
  return (
    <div className="cp-ab-items">
      {items.map((it) => (
        <Link key={it.id} href={`/items/${it.slug}`} className={`cp-named${base && !base.has(it.id) ? " cp-ab-new" : ""}`} title={it.name}>
          <img className="cp-icon" src={it.icon} alt={it.name} width={36} height={36} loading="lazy" />
          <small aria-hidden="true">
            <Name kind="items" id={it.id}>
              {it.name}
            </Name>
          </small>
        </Link>
      ))}
    </div>
  );
}

/** Window event that picks an augment in the picker: detail is the augment id. */
export const PICK_EVENT = "deeparam:pick-augment";

export default function AugmentBuildPicker({
  data,
  names,
  changes,
}: {
  data: AugmentBuilds;
  /** English augment names by id. */
  names: Record<string, string>;
  /** Fewest different items that count as changing the build. */
  changes: number;
}) {
  const singles = data.builds.filter((b) => b.augments.length === 1);
  const pairs = data.builds.filter((b) => b.augments.length === 2);
  const t = useT(NS);
  const [picked, setPicked] = useState<number[]>([]);
  const key = (ids: number[]) => [...ids].sort((a, b) => a - b).join("-");
  const shown = picked.length ? data.builds.find((b) => key(b.augments) === key(picked)) : undefined;
  const pairsWith = (id: number) => new Set(pairs.filter((p) => p.augments.includes(id)).flatMap((p) => p.augments));
  const allowed = picked.length === 1 ? pairsWith(picked[0]) : null;
  const base = new Set(data.base);
  const full = (ids: number[]): BuildItem[] => ids.flatMap((id) => (data.items[id] ? [{ id, ...data.items[id] }] : []));
  // The augment list's "Changes your build" tag (AugmentTable) asks for its augment here.
  useEffect(() => {
    const onPick = (e: Event) => {
      const id = (e as CustomEvent<number>).detail;
      if (data.builds.some((b) => b.augments.length === 1 && b.augments[0] === id)) setPicked([id]);
    };
    window.addEventListener(PICK_EVENT, onPick);
    return () => window.removeEventListener(PICK_EVENT, onPick);
  }, [data.builds]);
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length === 1 && allowed?.has(id) ? [...p, id] : [id]));

  return (
    <div className="cp-ab">
      <div className="cp-ab-chips" role="group" aria-label={t("Augments")}>
        {singles.map((b) => {
          const id = b.augments[0];
          const on = picked.includes(id);
          const pairable = picked.length === 1 && !on && allowed?.has(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              className={`cp-ab-chip${pairable ? " pairable" : ""}`}
              onClick={() => toggle(id)}
            >
              <img className="cp-icon round" src={`/icons/augments/${id}.webp`} alt="" width={24} height={24} loading="lazy" />
              <Name kind="augments" id={id}>
                {names[id] ?? ""}
              </Name>
              {b.changed >= changes && <span className="cp-ab-flag" title={t("Changes your build")} aria-label={t("Changes your build")}>⇄</span>}
            </button>
          );
        })}
      </div>
      <p className="cp-filter-note">
        {picked.length === 0 ? (
          <T ns={NS}>{"Pick an augment to see the best items with it. ⇄ marks augments that change your build."}</T>
        ) : picked.length === 1 && allowed?.size ? (
          <T ns={NS}>{"Highlighted augments can be added as a second pick."}</T>
        ) : null}
      </p>
      {shown && (
        <div className="cp-ab-result">
          <small className="cp-upg-label">
            {shown.changed >= changes ? (
              <T ns={NS} v={{ n: shown.changed }}>{"Changes your build: {n} different items"}</T>
            ) : (
              <T ns={NS}>{"Your usual items still work"}</T>
            )}
          </small>
          <Items items={full(shown.items)} base={base} />
        </div>
      )}
    </div>
  );
}
