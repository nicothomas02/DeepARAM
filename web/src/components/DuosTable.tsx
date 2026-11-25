"use client";

import { useEffect, useState } from "react";
import DataTable, { type Column, type Row } from "./DataTable";
import Skeleton from "@/components/Skeleton";
import { LoadError } from "@/components/EmptyState";
import RowLink from "@/components/RowLink";
import { useNames, useT } from "./I18n";
import { getParam, setParams } from "@/lib/url-state";
import { bestPairs } from "@/lib/duo-pick";
import type { TagInfo } from "@/lib/tag-info";

// Duos, under the Tier List's Champions tab (ChampionsPanel, ?cview=duos): about 7,000 pairs (lib/duos.ts), so they load from /data/duos.json when first opened, not with the page.
// The default view, "Best pairs", shows each champion once, in its best pair still free (lib/duo-pick.ts, Nico
// 2026-11-25); "All pairs" (?dview=all) lists every pair.
// Both lists start sorted by Win rate boost, the synergy adjusted for how often a pair is played (lib/duos.ts).
// "Archetypes" pools the same pairs by subclass (Enchanter + Enchanter); those few rows ship with the page (?dview=arch).

const BOOST_HINT =
  "How much more the pair wins than the two champions' own win rates predict, in percentage points. Above zero means they help each other. Rarely played pairs count for less, so a lucky streak can't top the list.";
const DELTA: Column = {
  key: "delta",
  label: "Win rate boost",
  format: "pts",
  hint: BOOST_HINT,
};
// Pairs carry their estimated games together, for the boost's 95% range and a low-sample tag.
const PAIR_DELTA: Column = { ...DELTA, gamesKey: "games" };
const PICK: Column = {
  key: "pick_rate",
  label: "Pick rate",
  format: "pct",
  hint: "How often the first champion has the second as a teammate.",
  phone: "wide",
};
const CC: Column = {
  key: "noCC",
  label: "Crowd control",
  format: "text",
  sortable: false,
  hint: "Marked when neither champion has a stun, root, knock-up, taunt, fear, charm, sleep or suppression, so the pair struggles to lock anyone down.",
  phone: "hide",
};
// One line on how the two kits work together, from the champion tags (lib/duos.ts duoWhy). Our own reading, so estimated.
const WHY: Column = {
  key: "why",
  label: "Why it works",
  format: "text",
  sortable: false,
  hint: "Estimated from each champion's kit: engage, crowd control, heals and shields, carries. Pairs are listed only when their boost held on earlier patches too.",
  phone: "hide",
};
const PAIRS: Column = {
  key: "duos",
  label: "Duos",
  format: "int",
  hint: "How many champion pairs the average covers. Fewer pairs make it less certain.",
  phone: "wide",
};

export default function DuosTable({
  archetypes,
  tagInfo,
  version,
  quests = [],
}: {
  archetypes: Row[];
  tagInfo: TagInfo;
  version: string;
  /** Pairs that start a team quest together (components/champion/Quests.tsx): [first, second, quest name]. */
  quests?: [string, string, string][];
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<"best" | "all" | "arch">("best");
  const arch = mode === "arch";
  const t = useT("tier-list");
  const tq = useT("quests");
  const names = useNames();
  useEffect(() => {
    const v = getParam("dview");
    setMode(v === "arch" || v === "all" ? v : "best");
  }, []);
  useEffect(() => {
    fetch(`/data/duos.json?v=${version}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setRows)
      .catch(() => setFailed(true));
  }, [version]);
  const view = (
    <div className="duos-bar">
      <div className="seg" role="group" aria-label={t("Duos")}>
        {(
          [
            ["best", "Best pairs"],
            ["all", "All pairs"],
            ["arch", "Archetypes"],
          ] as const
        ).map(([m, l]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setParams({ dview: m === "best" ? null : m, sort: null });
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
          initialSort={{ key: "delta", desc: true }}
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
        key={mode}
        columns={[champion("a", "Champion"), champion("b", "With"), PAIR_DELTA, PICK, WHY]}
        advancedColumns={[
          champion("a", "Champion"),
          champion("b", "With"),
          DELTA,
          PICK,
          WHY,
          ...(rows.some((r) => r.noCC) ? [CC] : []),
          { key: "roles", label: "Roles", format: "text", sortable: false },
        ]}
        rows={(mode === "best" ? bestPairs(rows as (Row & { a: string; b: string; delta: number })[]) : rows).map((r) => ({ ...r, ...(r.noCC ? { noCC: t(String(r.noCC)) } : {}), why: r.why ? t(String(r.why)) : "" }))}
        initialSort={{ key: "delta", desc: true }}
        searchKey="pair"
        searchLabel="Find a champion"
        urlTab="duos"
      />
      {quests.map(([a, b, quest]) => (
        <p key={`${a}-${b}`} className="duo-quest">
          <RowLink href={`/champions/${a}#quests`}>
            {t("Team quest: {a} and {b} on the same team start {quest}.", {
              a: names("champions", a, a),
              b: names("champions", b, b),
              quest: tq(quest),
            })}
          </RowLink>
        </p>
      ))}
    </>
  );
}
