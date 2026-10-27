"use client";

import { useEffect, useState } from "react";
import DataTable, { type Column, type Row } from "@/components/DataTable";
import type { DestinyChampionRow } from "@/lib/weapon-of-destiny";
import { getParam, setParams } from "@/lib/url-state";
import { useNames, useT } from "./I18n";

// The Tier List's Weapon of Destiny tab (?tab=weapon-of-destiny): every Legendary item ranked by stat value, labelled
// Predicted, since the stats can't tell which games had the augment (lib/weapon-of-destiny.ts, Nico 2026-10-27).
// "By champion" (?wview=champions) shows each champion's own best item instead, from simulated upgrades. Rows are
// built here so the item names and stats show in the page's language.

type Item = {
  id: number;
  slug: string | null;
  name: string;
  icon: string;
  perTakedown: Record<string, number>;
  share: number;
  score: number;
  tier: string;
  rank: number;
  best: string | null;
};

// Simulator stat keys, in the order a tooltip lists them; the true ones are shares shown as percentages.
const STATS: [string, string, boolean][] = [
  ["ad", "Attack Damage", false],
  ["ap", "Ability Power", false],
  ["as", "Attack Speed", true],
  ["crit", "Critical Strike Chance", true],
  ["crit_damage", "Critical Strike Damage", true],
  ["ah", "Ability Haste", false],
  ["hp", "Health", false],
  ["mana", "Mana", false],
  ["armor", "Armor", false],
  ["mr", "Magic Resist", false],
  ["lethality", "Lethality", false],
  ["armor_pen", "Armor Penetration", true],
  ["magic_pen", "Magic Penetration", false],
  ["magic_pen_pct", "Magic Penetration", true],
  ["lifesteal", "Life Steal", true],
  ["omnivamp", "Omnivamp", true],
  ["ms_pct", "Move Speed", true],
  ["heal_shield_power", "Heal and Shield Power", true],
];

// One decimal at most, none when it's whole.
const amount = (n: number) => String(Math.round(n * 10) / 10);

export default function WeaponOfDestiny({
  items,
  gold,
  champions,
}: {
  items: Item[];
  gold: number;
  champions: DestinyChampionRow[];
}) {
  const t = useT("destiny");
  const names = useNames();
  const [view, setView] = useState<"items" | "champions">("items");
  useEffect(() => {
    if (getParam("wview") === "champions" && champions.length)
      setView("champions");
  }, [champions.length]);
  const pick = (v: "items" | "champions") => {
    setView(v);
    setParams({ wview: v === "champions" ? v : null, sort: null, q: null });
  };
  const perTakedown = (s: Item["perTakedown"]) =>
    STATS.filter(([k]) => s[k])
      .map(
        ([k, label, pct]) =>
          `+${amount(pct ? s[k] * 100 : s[k])}${pct ? "%" : ""} ${t(label)}`,
      )
      .join(", ");

  const valueHelp = t(
    "Stat value rates each item from 0 to 100 against the others, where 50 is average. Each of its stats counts by how much it's worth to upgrade, most for stats that multiply all your damage such as Critical Strike Damage or Armor Penetration, and by how few Legendary items give it. Tiers: S 70+, A 59+, B 44+, C 32+, D below.",
  );
  const columns: Column[] = [
    {
      key: "tier",
      label: t("Tier"),
      format: "tier",
      sortKey: "rank",
      hint: valueHelp,
    },
    {
      key: "name",
      label: t("Item"),
      format: "item",
      iconKey: "icon",
      hrefKey: "href",
    },
    {
      key: "score",
      label: t("Stat value"),
      format: "deepscore",
      sortKey: "rank",
      hint: valueHelp,
    },
    {
      key: "stats",
      label: t("Each takedown"),
      format: "text",
      sortable: false,
      phone: "hide",
      hint: t(
        "What one takedown adds to the item: {gold} gold worth of its own stats, shared equally.",
        { gold },
      ),
    },
    {
      key: "best",
      label: t("Best with"),
      format: "champion-icon",
      sortable: false,
      hint: t("The champion who would upgrade it most often."),
    },
  ];
  const rows: Row[] = items.map((i) => ({
    id: i.id,
    name: names("items", i.id, i.name),
    icon: i.icon,
    href: i.slug ? `/items/${i.slug}` : null,
    tier: i.tier,
    score: i.score,
    rank: i.rank,
    stats: perTakedown(i.perTakedown),
    best: i.best,
  }));

  const why = t(
    "Predicted: the stats can't tell which games had Weapon of Destiny, so items are ranked by how valuable their stats are to upgrade, not by how they win.",
  );

  const championColumns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    {
      key: "item",
      label: t("Best item"),
      format: "item",
      iconKey: "icon",
      hrefKey: "href",
      sortable: false,
    },
    {
      key: "power",
      label: t("Fight power"),
      format: "pct",
      hint: t(
        "Simulated. How much stronger the upgraded item makes the champion in fights, with half its usual takedowns per game.",
      ),
    },
    {
      key: "next",
      label: t("Next best"),
      format: "text",
      hrefKey: "nextHref",
      sortable: false,
      phone: "hide",
      hint: t("The second-best item to upgrade for this champion."),
    },
  ];
  const championRows: Row[] = champions.map((c) => ({
    champion: c.champion,
    item: names("items", c.item.id, c.item.name),
    icon: c.item.icon,
    href: `/items/${c.item.slug}`,
    power: c.power,
    next: c.next ? names("items", c.next.id, c.next.name) : null,
    nextHref: c.next ? `/items/${c.next.slug}` : null,
  }));

  return (
    <>
      {/* Outside the fine print, so Simple view shows it too. */}
      <div
        className="subtab-note helper-threats"
        role="group"
        aria-label={t("View")}
      >
        <span className="tag tag-mixed" title={why}>
          {t("Predicted")}
        </span>
        {champions.length > 0 && (
          <>
            <button
              type="button"
              className="chip-toggle"
              aria-pressed={view === "items"}
              onClick={() => pick("items")}
            >
              {t("By item")}
            </button>
            <button
              type="button"
              className="chip-toggle"
              aria-pressed={view === "champions"}
              onClick={() => pick("champions")}
            >
              {t("By champion")}
            </button>
          </>
        )}
        {view === "champions" && (
          <span
            className="tag tag-mixed"
            title={t(
              "Simulated: picked from simulated fights with each champion's most popular build.",
            )}
          >
            {t("Simulated")}
          </span>
        )}
      </div>
      {view === "champions" ? (
        <>
          <p className="patch-note subtab-note">
            {t(
              "Each champion's best item to make its Weapon of Destiny: every candidate is upgraded in simulated fights with the champion's most popular build, and the one that makes it strongest wins.",
            )}
          </p>
          <DataTable
            key="champions"
            columns={championColumns}
            rows={championRows}
            initialSort={{ key: "power", desc: true }}
            searchKey="champion"
            searchLabel={t("Find a champion")}
            urlTab="weapon-of-destiny"
          />
          <p className="patch-note">
            {t(
              "Simulated. Champions near the top gain the most from the augment in fights.",
            )}
          </p>
        </>
      ) : (
        <>
          <p className="patch-note subtab-note">
            {t(
              "Weapon of Destiny makes your first Legendary item your Weapon of Destiny. Every champion takedown adds {gold} gold worth of that item's own stats, shared equally between them, so an item with fewer stats puts more into each one.",
              { gold },
            )}
          </p>
          <DataTable
            key="items"
            columns={columns}
            rows={rows}
            initialSort={{ key: "rank", desc: true }}
            searchKey="name"
            searchLabel={t("Find an item")}
            urlTab="weapon-of-destiny"
          />
          <p className="patch-note">{why}</p>
        </>
      )}
    </>
  );
}
