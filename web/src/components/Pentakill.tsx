"use client";

import DataTable, { type Column, type Row } from "@/components/DataTable";
import type { PredictedPentakill } from "@/lib/predicted-tabs";
import { useNames, useT } from "./I18n";

// The Tier List's Pentakill tab (?tab=pentakill), labelled Predicted: game stats don't record which ability a
// player Empowers, so lib/predicted-tabs.ts estimates each champion's pick (Nico 2026-11-20). Champions without
// enough picks to go on are left out rather than guessed.

const CONFIDENCE = { high: 3, medium: 2, low: 1 } as const;

export default function Pentakill({ rows }: { rows: PredictedPentakill[] }) {
  const t = useT("pentakill");
  const names = useNames();
  const label = { high: t("High"), medium: t("Medium"), low: t("Low") };

  const columns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    {
      key: "start",
      label: t("Empower"),
      format: "ability",
      iconKey: "icon",
      sortable: false,
      hint: t("The basic ability this champion most likely Empowers at level 1."),
    },
    {
      key: "confidence",
      label: t("Confidence"),
      format: "text",
      sortKey: "rank",
      hint: t("How sure the prediction is: High when many picks agree, Low when they're split."),
    },
  ];
  const data: Row[] = rows.map((r) => ({
    champion: r.champion,
    start: r.name ? `${r.start} · ${names("abilities", `${r.champion}.${r.start}`, r.name)}` : r.start,
    icon: r.icon,
    confidence: label[r.confidence],
    rank: CONFIDENCE[r.confidence],
  }));
  const why = t(
    "Predicted, not measured: game stats don't record which ability players Empower, so these are estimates from the picks players make, not win rates.",
  );

  return (
    <>
      <p className="subtab-note">
        <span className="tag tag-mixed" title={why}>
          {t("Predicted")}
        </span>
      </p>
      <p className="patch-note subtab-note">
        {t(
          "Pentakill lets you Empower one basic ability at level 1 and a second one at level 18, where the ultimate counts too: {heavy} for Q, {power} for W, {thrash} for E and {doom} for R. Each gives the ability 20 Ability Haste and 10% more damage, healing and shielding. Few games reach level 18, so this shows the level 1 pick.",
          {
            heavy: names("augments", 3170, "HEAVY"),
            power: names("augments", 3171, "POWER"),
            thrash: names("augments", 3172, "THRASH"),
            doom: names("augments", 3173, "DOOM"),
          },
        )}
      </p>
      <DataTable
        columns={columns}
        rows={data}
        initialSort={{ key: "rank", desc: true }}
        searchKey="champion"
        searchLabel={t("Find a champion")}
        urlTab="pentakill"
      />
      <p className="patch-note">{why}</p>
    </>
  );
}
