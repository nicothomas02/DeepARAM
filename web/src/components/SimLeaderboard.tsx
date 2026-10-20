"use client";

import { useEffect, useState } from "react";
import DataTable, { type Row } from "@/components/DataTable";
import { useNames, useT } from "@/components/I18n";

type Named = { name: string; id: number };
type Board = { builds: { champion: string; items: string[]; augments: string[]; dps: number; survival: number; patch: string }[] };

// The top 10 builds visitors have simulated, from /api/sim-scores. Every live-patch build simulated in the 1v1
// tab is entered on its own; only builds the simulator re-ran on our side are listed, with the damage from
// that run, and the top 10 are re-run every few hours (a build that no longer works is removed). Each row
// links to its fight replay.
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
  useEffect(() => {
    fetch("/api/sim-scores")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b: Board) =>
        setRows(
          b.builds.map((x) => ({
            name: x.champion,
            dps: x.dps,
            survival: x.survival,
            items: x.items.map((k) => (items[k] ? name("items", items[k].id, items[k].name) : k)).join(", "),
            augments: x.augments.map((k) => (augments[k] ? name("augments", augments[k].id, augments[k].name) : k)).join(", ") || "–",
            replay: t("Watch"),
            href: `/simulator?tab=replays#${x.champion}&items=${x.items.join(",")}&augs=${x.augments.join(",")}`,
          })),
        ),
      )
      .catch(() => setFailed(true));
  }, [items, augments, name, t]);

  return (
    <>
      <p className="table-note">
        {t(
          "{board}: the 10 builds with the highest simulated damage per second, from every build visitors simulate. Every champion faces the same enemy: Ashe with her most popular build (Ashe herself faces Teemo), with the default settings, until the champion falls.",
          { board },
        )}{" "}
        {t(
          "Every build you simulate in the 1v1 tab on the live patch is entered on its own and simulated again on our side; the damage shown is from that run. The top 10 are checked again every few hours, and a build that no longer works is removed.",
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
