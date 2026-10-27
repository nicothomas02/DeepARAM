"use client";

import DataTable, { type Column, type Row } from "@/components/DataTable";
import type { PentakillRow } from "@/lib/pentakill";
import { useNames, useT } from "./I18n";

// The Tier List's Pentakill tab (?tab=pentakill): the ability each champion should Empower at the start of a
// Pentakill game and the one to add at level 18, sorted by the estimated win rate boost (lib/pentakill.ts).

// A pick within this much of the next best start pick is a close call: either one works.
const CLOSE = 0.01;

export default function Pentakill({ rows }: { rows: PentakillRow[] }) {
  const t = useT("pentakill");
  const names = useNames();
  const ability = (slot: string, name: string) => (name ? `${slot} · ${name}` : slot);

  const columns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    {
      key: "start",
      label: t("Start"),
      format: "ability",
      iconKey: "startIcon",
      sortable: false,
      hint: t("The basic ability to Empower at the start of the game: the one that makes the champion strongest at levels 8, 13 and 18."),
    },
    {
      key: "level18",
      label: t("Level 18"),
      format: "ability",
      iconKey: "level18Icon",
      sortable: false,
      hint: t("The second ability to Empower at level 18, the ultimate included, on top of the first one."),
    },
    {
      key: "boost",
      label: t("Win rate boost"),
      format: "pts",
      hint: t("Estimated. How much both Empowers together raise the champion's win rate: the start pick counts for the whole game, the level 18 pick for the part played at level 18."),
    },
    {
      key: "startGain",
      label: t("Start power"),
      format: "pct",
      phone: "hide",
      hint: t("Simulated. How much stronger the start pick makes the champion in fights, averaged over levels 8, 13 and 18."),
    },
    {
      key: "level18Gain",
      label: t("Level 18 power"),
      format: "pct",
      phone: "hide",
      hint: t("Simulated. How much stronger the level 18 pick makes the champion in fights, on top of the start pick."),
    },
    {
      key: "next",
      label: t("Close call"),
      format: "text",
      sortable: false,
      phone: "hide",
      hint: t("The next best start pick when it's almost as strong. Either one works."),
    },
  ];
  const data: Row[] = rows.map((r) => ({
    champion: r.champion,
    start: ability(r.start, r.startName),
    level18: ability(r.level18, r.level18Name),
    startIcon: r.startIcon,
    level18Icon: r.level18Icon,
    boost: r.boost,
    startGain: r.startGain,
    level18Gain: r.level18Gain,
    next: r.margin < CLOSE && r.runnerUp ? r.runnerUp : null,
  }));

  return (
    <>
      <p className="subtab-note">
        <span className="tag tag-mixed" title={t("Simulated: picked from simulated fights with each champion's most popular build.")}>
          {t("Simulated")}
        </span>
      </p>
      <p className="patch-note subtab-note">
        {t(
          "In a Pentakill game you Empower one basic ability at the start and a second one at level 18, where the ultimate counts too: {heavy} for Q, {power} for W, {thrash} for E and {doom} for R. Each gives the ability 20 Ability Haste and 10% more damage, healing and shielding.",
          {
            heavy: names("augments", 3170, "HEAVY"),
            power: names("augments", 3171, "POWER"),
            thrash: names("augments", 3172, "THRASH"),
            doom: names("augments", 3173, "DOOM"),
          },
        )}
      </p>
      <DataTable columns={columns} rows={data} initialSort={{ key: "boost", desc: true }} searchKey="champion" searchLabel={t("Find a champion")} urlTab="pentakill" />
      <p className="patch-note">
        {t(
          "Simulated. Each pick is the ability that makes the champion strongest in simulated fights with its most popular build. Win rate boost turns that into estimated win rate points, so champions near the top gain the most from a Pentakill game.",
        )}
      </p>
    </>
  );
}
