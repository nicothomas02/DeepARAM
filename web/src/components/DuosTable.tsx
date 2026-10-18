"use client";

import { useEffect, useState } from "react";
import DataTable, { type Row } from "./DataTable";
import Skeleton from "@/components/Skeleton";
import { LoadError } from "@/components/EmptyState";
import { useT } from "./I18n";

// The Duos tab: 2,000 pairs, so they load from /data/duos.json when the tab is first opened, not with the page.
export default function DuosTable() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const t = useT("tier-list");
  useEffect(() => {
    fetch("/data/duos.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);
  if (!rows) return failed ? <LoadError what={t("Duos")} /> : <Skeleton rows={10} label={t("Loading duos…")} />;
  return (
    <DataTable
      columns={[
        { key: "a", label: "Champion", format: "champion" },
        { key: "b", label: "With", format: "champion" },
        { key: "win_rate", label: "Win rate", format: "pct" },
        {
          key: "delta",
          label: "Win rate delta",
          format: "pct",
          hint: "How much more the pair wins than the two champions' own win rates predict, in percentage points. Above zero means they help each other.",
        },
        { key: "pick_rate", label: "Pick rate", format: "pct" },
      ]}
      advancedColumns={[
        { key: "a", label: "Champion", format: "champion" },
        { key: "b", label: "With", format: "champion" },
        { key: "win_rate", label: "Win rate", format: "pct" },
        {
          key: "delta",
          label: "Win rate delta",
          format: "pct",
          hint: "How much more the pair wins than the two champions' own win rates predict, in percentage points. Above zero means they help each other.",
        },
        { key: "pick_rate", label: "Pick rate", format: "pct" },
        { key: "rank", label: "Rank", format: "int" },
        { key: "roles", label: "Roles", format: "text", sortable: false },
      ]}
      rows={rows}
      initialSort={{ key: "delta", desc: true }}
      searchKey="pair"
      searchLabel="Find a champion"
      urlTab="duos"
    />
  );
}
