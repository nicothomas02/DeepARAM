"use client";

import { useEffect, useState } from "react";
import DataTable, { type Row } from "@/components/DataTable";
import { useNames, useT } from "@/components/I18n";

type Named = { name: string; id: number };
type Stat = "taken" | "mitigated" | "healing" | "shielding" | "cc";
type Board = { builds: ({ champion: string; items: string[]; augments: string[]; dps: number; survival: number; patch: string } & Partial<Record<Stat, number>>)[] };
// The simulator's other numbers for each build's fight, as columns (shielding shows once the simulator reports it).
const STATS: { key: Stat; label: string; format: "int" | "num" }[] = [
  { key: "taken", label: "Damage taken", format: "int" },
  { key: "mitigated", label: "Damage mitigated", format: "int" },
  { key: "healing", label: "Healing done", format: "int" },
  { key: "shielding", label: "Shielding", format: "int" },
  { key: "cc", label: "Crowd control", format: "num" },
];

// Each champion's best build visitors have simulated, from /api/sim-scores, highest damage first. Every
// live-patch build simulated in the 1v1 tab is entered on its own; only builds the simulator re-ran on our
// side are listed, with the numbers from that run, and they are re-run every few hours (a build that no
// longer works is removed). Each row links to its fight replay.
export default function SimLeaderboard({
  board,
  items,
  augments,
}: {
  /** The board's name, shown in its text (the Simulator page's "Leaderboard" tab). */
  board: string;
  /** Simulator key → English name and game id (the id gives the name in the page's language). */
  items: Record<string, Named>;
  augments: Record<string, Named>;
}) {
  const name = useNames();
  const t = useT("simulator");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<typeof STATS>([]);
  useEffect(() => {
    fetch("/api/sim-scores")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b: Board) => {
        setShown(STATS.filter((c) => b.builds.some((x) => typeof x[c.key] === "number")));
        setRows(
          b.builds.map((x) => ({
            name: x.champion,
            dps: x.dps,
            survival: x.survival,
            ...Object.fromEntries(STATS.map((c) => [c.key, x[c.key] ?? ""])),
            items: x.items.map((k) => (items[k] ? name("items", items[k].id, items[k].name) : k)).join(", "),
            augments: x.augments.map((k) => (augments[k] ? name("augments", augments[k].id, augments[k].name) : k)).join(", ") || "–",
            replay: t("Watch"),
            href: `/simulator?tab=replays#${x.champion}&items=${x.items.join(",")}&augs=${x.augments.join(",")}`,
          })),
        );
      })
      .catch(() => setFailed(true));
  }, [items, augments, name, t]);

  return (
    <>
      <p className="table-note">
        {t(
          "{board}: each champion's best build out of every build visitors simulate, ranked by simulated damage per second, with the fight's other numbers alongside. Every champion faces the same enemy: Ashe with her most popular build (Ashe herself faces Teemo), with the default settings, until the champion falls.",
          { board },
        )}{" "}
        {t(
          "Every build you simulate in the 1v1 tab on the live patch is entered on its own and simulated again on our side; the damage shown is from that run. Listed builds are checked again every few hours, and a build that no longer works is removed.",
        )}
      </p>
      {failed ? (
        <p className="table-note">{t("The Leaderboard couldn't be reached. Try again in a moment.")}</p>
      ) : rows === null ? (
        <p className="table-note">{t("Loading the leaderboard…")}</p>
      ) : rows.length === 0 ? (
        <p className="table-note">{t("No builds yet. Simulate a build in the 1v1 tab and it's entered on its own.")}</p>
      ) : (
        <DataTable
          columns={[
            { key: "name", label: "Champion", format: "champion" },
            { key: "dps", label: "Mean DPS", format: "int" },
            { key: "survival", label: "Survives", format: "pct" },
            ...shown.map((c) => ({ key: c.key, label: c.label, format: c.format })),
            { key: "items", label: "Items", format: "text", sortable: false },
            { key: "augments", label: "Augments", format: "text", sortable: false },
            { key: "replay", label: "Replay", format: "text", sortable: false, hrefKey: "href" },
          ]}
          rows={rows}
          initialSort={{ key: "dps", desc: true }}
          searchKey="name"
          searchLabel="Find a champion"
        />
      )}
    </>
  );
}
