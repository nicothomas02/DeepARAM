"use client";

import { useEffect, useState } from "react";
import DataTable, { type Column, type Row } from "@/components/DataTable";
import type { DestinyChampionRow } from "@/lib/weapon-of-destiny";
import { getParam, setParams } from "@/lib/url-state";
import { useNames, useT } from "./I18n";

// The Tier List's Weapon of Destiny tab (?tab=weapon-of-destiny): every Legendary item ranked, labelled Anticipated
// and by valuable stats until the augment has real games, then by DeepScore from its win rate and pick rate as the
// Weapon (lib/weapon-of-destiny.ts). "By champion" (?wview=champions) shows each champion's own best item instead,
// from simulated upgrades plus its real first-item win rate. Rows are built here so the item names and stats show in
// the page's language.

type Item = {
  id: number;
  slug: string;
  name: string;
  icon: string;
  perTakedown: Record<string, number>;
  share: number;
  lift: number | null;
  rare: number;
  score: number | null;
  tier: string | null;
  rank: number | null;
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
  anticipated,
  champions,
}: {
  items: Item[];
  gold: number;
  anticipated: boolean;
  champions: DestinyChampionRow[];
}) {
  const t = useT("destiny");
  const names = useNames();
  const [view, setView] = useState<"items" | "champions">("items");
  useEffect(() => {
    if (getParam("wview") === "champions" && champions.length) setView("champions");
  }, [champions.length]);
  const pick = (v: "items" | "champions") => {
    setView(v);
    setParams({ wview: v === "champions" ? v : null, sort: null, q: null });
  };
  const perTakedown = (s: Item["perTakedown"]) =>
    STATS.filter(([k]) => s[k])
      .map(([k, label, pct]) => `+${amount(pct ? s[k] * 100 : s[k])}${pct ? "%" : ""} ${t(label)}`)
      .join(", ");

  const help = t(
    "DeepScore rates each item from 0 to 100 against the others, where 50 is average. It starts from how much the item raises the win rate of the champions who make it their first Legendary item, and trusts items picked first less often less. Tiers: S 70+, A 59+, B 44+, C 32+, D below.",
  );
  const valueHelp = t(
    "Stat value rates each item from 0 to 100 against the others, where 50 is average. Each of its stats counts by how much it's worth to upgrade, most for stats that multiply all your damage such as Critical Strike Damage or Armor Penetration, and by how few Legendary items give it. Tiers: S 70+, A 59+, B 44+, C 32+, D below.",
  );
  const pickRate: Column = {
    key: "share",
    label: t("Pick rate"),
    format: "pct",
    hint: t("Estimated. How often it would be the Weapon of Destiny: the first Legendary item of the champions likely to take the augment."),
  };
  const stats: Column = { key: "stats", label: t("Each takedown"), format: "text", sortable: false, phone: "hide", hint: t("What one takedown adds to the item: {gold} gold worth of its own stats, shared equally.", { gold }) };
  const best: Column = { key: "best", label: t("Best with"), format: "champion-icon", sortable: false, hint: t("The champion who would upgrade it most often.") };
  const columns: Column[] = anticipated
    ? [
        { key: "tier", label: t("Tier"), format: "tier", sortKey: "rank", hint: valueHelp },
        { key: "name", label: t("Item"), format: "item", iconKey: "icon", hrefKey: "href" },
        { key: "score", label: t("Stat value"), format: "deepscore", sortKey: "rank", hint: valueHelp },
        stats,
        best,
      ]
    : [
        { key: "tier", label: t("Tier"), format: "tier", sortKey: "rank", hint: help },
        { key: "name", label: t("Item"), format: "item", iconKey: "icon", hrefKey: "href" },
        { key: "score", label: "DeepScore", format: "deepscore", sortKey: "rank", hint: help },
        {
          key: "lift",
          label: t("Win rate boost"),
          format: "pts",
          phone: "hide",
          hint: t("Estimated. Win rate of builds that start with it, minus what the same champions win with their other first items."),
        },
        pickRate,
        {
          key: "rare",
          label: t("Rare stats"),
          format: "int",
          phone: "hide",
          hint: t("How much of each upgrade goes into stats few Legendary items give, such as Critical Strike Damage or Armor Penetration. 100 is the rarest mix."),
        },
        stats,
        best,
      ];
  const rows: Row[] = items.map((i) => ({
    id: i.id,
    name: names("items", i.id, i.name),
    icon: i.icon,
    href: `/items/${i.slug}`,
    tier: i.tier,
    score: i.score,
    rank: i.rank,
    lift: i.lift,
    share: i.share,
    rare: i.rare,
    stats: perTakedown(i.perTakedown),
    best: i.best,
  }));

  const why = t(
    "Anticipated: Weapon of Destiny has no games yet, so items are ranked by how valuable their stats are to upgrade. Once it has games, they're ranked by DeepScore from how the Weapon wins.",
  );

  const championColumns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    { key: "item", label: t("Best item"), format: "item", iconKey: "icon", hrefKey: "href", sortable: false },
    {
      key: "boost",
      label: t("Win rate boost"),
      format: "pts",
      hint: t("Estimated. How much making this item the Weapon of Destiny raises the champion's win rate: its simulated upgrades plus how the item already wins as this champion's first Legendary item."),
    },
    {
      key: "power",
      label: t("Fight power"),
      format: "pct",
      phone: "hide",
      hint: t("Simulated. How much stronger the upgraded item makes the champion in fights, with half its usual takedowns per game."),
    },
    {
      key: "share",
      label: t("Built first"),
      format: "pct",
      phone: "hide",
      hint: t("How often the champion already buys this item as its first Legendary item."),
    },
    { key: "next", label: t("Next best"), format: "text", hrefKey: "nextHref", sortable: false, phone: "hide", hint: t("The second-best item to upgrade for this champion.") },
  ];
  const championRows: Row[] = champions.map((c) => ({
    champion: c.champion,
    item: names("items", c.item.id, c.item.name),
    icon: c.item.icon,
    href: `/items/${c.item.slug}`,
    boost: c.boost,
    power: c.power,
    share: c.share,
    next: c.next ? names("items", c.next.id, c.next.name) : null,
    nextHref: c.next ? `/items/${c.next.slug}` : null,
  }));

  return (
    <>
      {/* Outside the fine print, so Simple view shows it too. */}
      {(anticipated || champions.length > 0) && (
        <div className="subtab-note helper-threats" role="group" aria-label={t("View")}>
          {anticipated && (
            <span className="tag tag-mixed" title={why}>
              {t("Anticipated")}
            </span>
          )}
          {champions.length > 0 && (
            <>
              <button type="button" className="chip-toggle" aria-pressed={view === "items"} onClick={() => pick("items")}>
                {t("By item")}
              </button>
              <button type="button" className="chip-toggle" aria-pressed={view === "champions"} onClick={() => pick("champions")}>
                {t("By champion")}
              </button>
            </>
          )}
          {view === "champions" && (
            <span className="tag tag-mixed" title={t("Simulated: picked from simulated fights with each champion's most popular build.")}>
              {t("Simulated")}
            </span>
          )}
        </div>
      )}
      {view === "champions" ? (
        <>
          <p className="patch-note subtab-note">
            {t(
              "Each champion's best item to make its Weapon of Destiny: every candidate is upgraded in simulated fights with the champion's most popular build, then combined with how the item already wins as its first Legendary item.",
            )}
          </p>
          <DataTable
            key="champions"
            columns={championColumns}
            rows={championRows}
            initialSort={{ key: "boost", desc: true }}
            searchKey="champion"
            searchLabel={t("Find a champion")}
            urlTab="weapon-of-destiny"
          />
          <p className="patch-note">
            {t("Simulated and estimated. Win rate boost turns the simulated upgrades into estimated win rate points, so champions near the top gain the most from the augment.")}
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
          <DataTable key="items" columns={columns} rows={rows} initialSort={{ key: "rank", desc: true }} searchKey="name" searchLabel={t("Find an item")} urlTab="weapon-of-destiny" />
          <p className="patch-note">
            {anticipated
              ? why
              : t(
                  "Estimated. Ranked by DeepScore, from each item's win rate and pick rate as the first Legendary item of the champions who take the augment. Items no champion buys first have no score yet.",
                )}
          </p>
        </>
      )}
    </>
  );
}
