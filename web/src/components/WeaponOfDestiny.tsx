"use client";

import { useEffect, useState } from "react";
import DataTable, { type Column, type Row } from "@/components/DataTable";
import type { RealDestinyChampion, RealDestinyItem } from "@/lib/weapon-of-destiny";
import { getParam, setParams } from "@/lib/url-state";
import { useNames, useT } from "./I18n";

// The Tier List's Weapon of Destiny tab (?tab=weapon-of-destiny), from real games (lib/weapon-of-destiny.ts
// realDestiny): every Legendary item players upgrade with the augment, by DeepScore on how much more the same
// champions win with it than with the augment on average. "By champion" (?wview=champions) shows each champion's usual
// Weapon and, when another well-followed item scores higher, that one too. Rows are built here so the item names and
// stats show in the page's language.

type Item = RealDestinyItem;

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
  champions: RealDestinyChampion[];
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
    "DeepScore rates each item from 0 to 100 against the others, where 50 is average: how much more the champions who make it their Weapon of Destiny win than they do with the augment on average, with small samples pulled toward the average. Tiers: S 70+, A 59+, B 44+, C 32+, D below.",
  );
  const columns: Column[] = [
    { key: "tier", label: t("Tier"), format: "tier", sortKey: "rank", hint: valueHelp },
    { key: "name", label: t("Item"), format: "item", iconKey: "icon", hrefKey: "href" },
    { key: "score", label: t("DeepScore"), format: "deepscore", sortKey: "rank", hint: valueHelp },
    {
      key: "share",
      label: t("Picked"),
      format: "pct",
      hint: t("Share of Weapon of Destiny games that upgrade this item. Each champion counts its three most upgraded items."),
    },
    {
      key: "stats",
      label: t("Each takedown"),
      format: "text",
      sortable: false,
      phone: "hide",
      hint: t("What one takedown adds to the item: {gold} gold worth of its own stats, shared equally.", { gold }),
    },
    {
      key: "best",
      label: t("Most with"),
      format: "champion-icon",
      sortable: false,
      hint: t("The champion whose Weapon of Destiny games pick it most often."),
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
    share: i.share,
    stats: perTakedown(i.perTakedown),
    best: i.best,
  }));

  const championColumns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    {
      key: "item",
      label: t("Usual Weapon"),
      format: "item",
      iconKey: "icon",
      hrefKey: "href",
      sortable: false,
      hint: t("The first Legendary item most of its Weapon of Destiny games upgrade."),
    },
    { key: "share", label: t("Picked"), format: "pct", hint: t("Share of its Weapon of Destiny games that upgrade it.") },
    {
      key: "next",
      label: t("Higher DeepScore"),
      format: "text",
      hrefKey: "nextHref",
      sortable: false,
      phone: "hide",
      hint: t("Another item its players often upgrade that wins more, when there is one."),
    },
  ];
  const championRows: Row[] = champions.map((c) => ({
    champion: c.champion,
    item: names("items", c.usual.id, c.usual.name),
    icon: c.usual.icon,
    href: c.usual.slug ? `/items/${c.usual.slug}` : null,
    share: c.usual.share,
    next: c.best ? `${names("items", c.best.id, c.best.name)} (${c.best.deepScore})` : null,
    nextHref: c.best?.slug ? `/items/${c.best.slug}` : null,
  }));

  return (
    <>
      {/* Outside the fine print, so Simple view shows it too. */}
      <div
        className="subtab-note helper-threats"
        role="group"
        aria-label={t("View")}
      >
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
      </div>
      {view === "champions" ? (
        <>
          <p className="patch-note subtab-note">
            {t(
              "Each champion's usual Weapon of Destiny, the first Legendary item its players upgrade, and a well-followed item that wins more when there is one.",
            )}
          </p>
          <DataTable
            key="champions"
            columns={championColumns}
            rows={championRows}
            initialSort={{ key: "share", desc: true }}
            searchKey="champion"
            searchLabel={t("Find a champion")}
            urlTab="weapon-of-destiny"
          />
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
        </>
      )}
    </>
  );
}
