"use client";

import { useEffect, useState } from "react";
import { getParam, setParams } from "@/lib/url-state";
import { EmptyState } from "@/components/EmptyState";
import DataTable, { type Column, type Row } from "./DataTable";
import { useT } from "./I18n";

// Augment tier list (/tier-list?tab=augments&rarity=gold&style=ap), laid out like the Champions tab: filter chips
// for rarity and build style (under a "Filter by tags" fold) above one sortable table of every augment (rows and columns from the page).
// Each row carries its rarity (`tier`) and its build styles (`styles`, comma-separated) for the filters.

const RARITIES: [string, string][] = [
  ["", "All rarities"],
  ["prismatic", "Prismatic"],
  ["gold", "Gold"],
  ["silver", "Silver"],
];

export default function AugmentTiers({
  rows,
  columns,
  advancedColumns,
  styles,
  note,
}: {
  rows: Row[];
  columns: Column[];
  advancedColumns?: Column[];
  styles: Record<string, string>;
  /** Shown under the table. */
  note?: React.ReactNode;
}) {
  const t = useT("tier-list");
  const [rarity, setRarity] = useState("");
  const [style, setStyle] = useState("");
  // Rarity and style sit under a closed "Filter by tags" fold, open when a shared link already picks one.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const picked = (rarity ? 1 : 0) + (style ? 1 : 0);

  useEffect(() => {
    const r = getParam("rarity") ?? "";
    const s = getParam("style") ?? "";
    const okR = RARITIES.some(([k]) => k === r);
    if (okR) setRarity(r);
    if (s in styles) setStyle(s);
    if ((okR && r) || (s && s in styles)) setFiltersOpen(true);
  }, [styles]);

  const pick = (key: "rarity" | "style", v: string) => {
    if (key === "rarity") setRarity(v);
    else setStyle(v);
    setParams({ [key]: v || null });
  };

  const shown = rows.filter(
    (a) =>
      (!rarity || String(a.tier).toLowerCase() === rarity) &&
      (!style ||
        String(a.styles ?? "")
          .split(",")
          .includes(style)),
  );

  return (
    <div className="atiers">
      <details className="items-filter-menu" open={filtersOpen} onToggle={(e) => setFiltersOpen(e.currentTarget.open)}>
        <summary>
          {t("Filter by tags")}
          {picked > 0 && <span className="items-filter-n">{picked}</span>}
        </summary>
        <div className="atiers-filters">
          <div className="helper-threats" role="group" aria-label={t("Rarity")}>
            {RARITIES.map(([k, l]) => (
              <button key={k || "all"} type="button" className="chip-toggle" aria-pressed={rarity === k} onClick={() => pick("rarity", k)}>
                {t(l)}
              </button>
            ))}
          </div>
          <div className="helper-threats" role="group" aria-label={t("Build style")}>
            <button type="button" className="chip-toggle" aria-pressed={style === ""} onClick={() => pick("style", "")}>
              {t("Any style")}
            </button>
            {Object.entries(styles).map(([k, l]) => (
              <button key={k} type="button" className="chip-toggle" aria-pressed={style === k} onClick={() => pick("style", k)}>
                {t(l)}
              </button>
            ))}
          </div>
        </div>
      </details>
      {shown.length === 0 ? (
        <EmptyState
          title={t("No augments match")}
          action={
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRarity("");
                setStyle("");
                setParams({ rarity: null, style: null });
              }}
            >
              {t("Show every augment")}
            </button>
          }
        >
          {t("Try another rarity or style.")}
        </EmptyState>
      ) : (
        <DataTable
          columns={columns}
          advancedColumns={advancedColumns}
          rows={shown}
          initialSort={{ key: "deepScore", desc: true }}
          searchKey="name"
          searchLabel="Find an augment"
          urlTab="augments"
        />
      )}
      {note}
    </div>
  );
}
