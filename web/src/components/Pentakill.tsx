"use client";

import DataTable, { type Column, type Row } from "@/components/DataTable";
import type { PentakillRow } from "@/lib/pentakill";
import { useNames, useT } from "./I18n";

// The Tier List's Pentakill tab (?tab=pentakill): the ability each champion should Empower at the start of a
// Pentakill game and the one to add at level 18, from real games with each Empower (AramHex, lib/pentakill.ts),
// sorted by the start pick's DeepScore.

export default function Pentakill({ rows }: { rows: PentakillRow[] }) {
  const t = useT("pentakill");
  const names = useNames();
  const ability = (champion: string, slot: string, name: string) =>
    name ? `${slot} · ${names("abilities", `${champion}.${slot}`, name)}` : slot;

  const columns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    {
      key: "start",
      label: t("Start"),
      format: "ability",
      iconKey: "startIcon",
      sortable: false,
      hint: t("The basic ability to Empower at the start of the game: the one that wins most above the champion's usual, among those players often pick."),
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
      key: "startScore",
      label: "DeepScore",
      format: "deepscore",
      hint: t("How the start pick does on this champion, 0 to 100 against every champion's start pick: its win rate above the champion's usual in Pentakill games, trusted more the more games it has."),
    },
    {
      key: "level18Score",
      label: t("Level 18 DeepScore"),
      format: "deepscore",
      phone: "hide",
      hint: t("The same for the level 18 pick. The ultimate's Empower is only taken at level 18, in long games, so it's judged against how it does on every champion."),
    },
    {
      key: "games",
      label: t("Games"),
      format: "int",
      phone: "hide",
      hint: t("Pentakill games on this champion."),
    },
    {
      key: "next",
      label: t("Close call"),
      format: "text",
      sortable: false,
      phone: "hide",
      hint: t("The next best start pick when it's within the noise of the first. Either one works."),
    },
  ];
  const data: Row[] = rows.map((r) => ({
    champion: r.champion,
    start: ability(r.champion, r.start, r.startName),
    level18: ability(r.champion, r.level18, r.level18Name),
    startIcon: r.startIcon,
    level18Icon: r.level18Icon,
    startScore: r.startScore,
    level18Score: r.level18Score,
    games: r.games,
    next: r.closeCall,
  }));

  return (
    <>
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
      <DataTable columns={columns} rows={data} initialSort={{ key: "startScore", desc: true }} searchKey="champion" searchLabel={t("Find a champion")} urlTab="pentakill" />
      <p className="patch-note">
        {t(
          "From real Pentakill games. Each pick is the Empower that wins most above the champion's usual, among the ones players often pick. A high score can also come from the games and players who pick it: correlated, not proof it causes the wins.",
        )}
      </p>
    </>
  );
}
