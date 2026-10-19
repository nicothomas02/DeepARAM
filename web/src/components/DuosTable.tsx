"use client";

import { useEffect, useState } from "react";
import DataTable, { type Column, type Row } from "./DataTable";
import Skeleton from "@/components/Skeleton";
import { LoadError } from "@/components/EmptyState";
import { useT } from "./I18n";
import { getParam, setParams } from "@/lib/url-state";
import type { TagInfo } from "@/lib/tag-info";

// The Duos tab: about 7,000 pairs (lib/duos.ts), so they load from /data/duos.json when the tab is first opened, not with the page.
// Both lists start in DeepScore order (lib/duos.ts: the delta, trusting rarely played pairs less) without
// showing the score; the Win rate boost column sorts by the raw delta.
// "Archetypes" pools the same pairs by subclass (Enchanter + Enchanter); those few rows ship with the page (?dview=arch).

const DELTA: Column = {
  key: "delta",
  label: "Win rate boost",
  format: "pts",
  hint: "How much more the pair wins than the two champions' own win rates predict, in percentage points. Above zero means they help each other.",
};
const PICK: Column = { key: "pick_rate", label: "Pick rate", format: "pct", hint: "How often the first champion has the second as a teammate." };
const PAIRS: Column = { key: "duos", label: "Duos", format: "int", hint: "How many champion pairs the average covers. Fewer pairs make it less certain." };

export default function DuosTable({ archetypes, tagInfo, version }: { archetypes: Row[]; tagInfo: TagInfo; version: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [arch, setArch] = useState(false);
  const t = useT("tier-list");
  useEffect(() => setArch(getParam("dview") === "arch"), []);
  useEffect(() => {
    fetch(`/data/duos.json?v=${version}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setRows)
      .catch(() => setFailed(true));
  }, [version]);
  const view = (
    <div className="duos-bar">
      <div className="seg" role="group" aria-label={t("Duos")}>
        {(["Champions", "Archetypes"] as const).map((l, i) => (
          <button
            key={l}
            type="button"
            aria-pressed={arch === (i === 1)}
            onClick={() => {
              setArch(i === 1);
              setParams({ dview: i === 1 ? "arch" : null, sort: null });
            }}
          >
            {t(l)}
          </button>
        ))}
      </div>
    </div>
  );
  if (arch) {
    const archetype = (key: string, label: string): Column => ({ key, label, format: "tags", tags: tagInfo, sortable: false });
    return (
      <>
        {view}
        <DataTable
          key="arch"
          columns={[archetype("a", "Archetype"), archetype("b", "With"), DELTA, PAIRS]}
          rows={archetypes}
          initialSort={{ key: "deepScore", desc: true }}
          urlTab="duos"
        />
      </>
    );
  }
  if (!rows) return failed ? <LoadError what={t("Duos")} /> : <Skeleton rows={10} label={t("Loading duos…")} />;
  const champion = (key: string, label: string): Column => ({ key, label, format: "champion" });
  return (
    <>
      {view}
      <DataTable
        key="champions"
        columns={[champion("a", "Champion"), champion("b", "With"), DELTA, PICK]}
        advancedColumns={[champion("a", "Champion"), champion("b", "With"), DELTA, PICK, { key: "roles", label: "Roles", format: "text", sortable: false }]}
        rows={rows}
        initialSort={{ key: "deepScore", desc: true }}
        searchKey="pair"
        searchLabel="Find a champion"
        urlTab="duos"
      />
    </>
  );
}
