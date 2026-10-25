"use client";

import DataTable, { type Row } from "@/components/DataTable";
import { useNames } from "@/components/I18n";

type Named = [id: number, en: string];
export type SimBuild = { row: Row; items: Named[]; augments: Named[] };

/** The Simulator's best build for each champion, with item and augment names in the page's language. */
export default function SimBuildsTable({ builds }: { builds: SimBuild[] }) {
  const name = useNames();
  const rows: Row[] = builds.map((b) => ({
    ...b.row,
    items: b.items.map(([id, en]) => name("items", id, en)).join(", "),
    augments: b.augments.map(([id, en]) => name("augments", id, en)).join(", "),
  }));
  return (
    <DataTable
      columns={[
        { key: "name", label: "Champion", format: "champion" },
        { key: "role", label: "Role", format: "text" },
        { key: "dps", label: "Mean DPS", format: "int" },
        { key: "survival", label: "Survives", format: "pct" },
        { key: "items", label: "Items", format: "text", sortable: false },
        { key: "augments", label: "Augments", format: "text", sortable: false },
      ]}
      rows={rows}
      initialSort={{ key: "dps", desc: true }}
      searchKey="name"
      searchLabel="Find a champion"
    />
  );
}
