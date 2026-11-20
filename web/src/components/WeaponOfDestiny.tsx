"use client";

import { useEffect, useState } from "react";
import DataTable, { type Column, type Row } from "@/components/DataTable";
import { getParam, setParams } from "@/lib/url-state";
import { useNames, useT } from "./I18n";

// The Tier List's Weapon of Destiny tab (?tab=weapon-of-destiny), labelled Predicted: game stats don't record which
// item became the Weapon, so lib/predicted-tabs.ts estimates it (Nico 2026-11-20). "By item" ranks items by their
// predicted share of Weapon picks; "By champion" (?wview=champions) lists each champion's three likeliest Weapons.
// Rows are built here so the item names and stats show in the page's language.

type Item = {
  id: number;
  slug: string | null;
  name: string;
  icon: string;
  perTakedown: Record<string, number>;
  share: number;
  champions: number;
  score: number;
  tier: string;
};
type ItemRef = { id: number; slug: string | null; name: string; icon: string };
type Champion = { champion: string; items: ItemRef[] };

// Stat keys, in the order a tooltip lists them; the true ones are shares shown as percentages.
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
  champions: Champion[];
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

  const shareHelp = t(
    "Predicted. Out of every Weapon of Destiny game, how often this item is the Weapon. Tiers compare it with the other items: S 70+, A 59+, B 44+, C 32+, D below.",
  );
  const columns: Column[] = [
    {
      key: "tier",
      label: t("Tier"),
      format: "tier",
      sortKey: "share",
      hint: shareHelp,
    },
    {
      key: "name",
      label: t("Item"),
      format: "item",
      iconKey: "icon",
      hrefKey: "href",
    },
    { key: "share", label: t("Weapon picks"), format: "pct", hint: shareHelp },
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
      key: "champions",
      label: t("Champions"),
      format: "int",
      phone: "hide",
      hint: t("How many champions most likely make it their Weapon."),
    },
  ];
  const href = (i: ItemRef) => (i.slug ? `/items/${i.slug}` : null);
  const rows: Row[] = items.map((i) => ({
    id: i.id,
    name: names("items", i.id, i.name),
    icon: i.icon,
    href: href(i),
    tier: i.tier,
    share: i.share,
    stats: perTakedown(i.perTakedown),
    champions: i.champions,
  }));

  const why = t(
    "Predicted, not measured: game stats don't record which item becomes the Weapon of Destiny, so these are estimates from the picks players make, not win rates.",
  );

  const championColumns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    {
      key: "item",
      label: t("Likely Weapon"),
      format: "item",
      iconKey: "icon",
      hrefKey: "href",
      sortable: false,
    },
    {
      key: "also",
      label: t("Also common"),
      format: "text",
      sortable: false,
      phone: "hide",
      hint: t("The next likeliest Weapons for this champion."),
    },
  ];
  const championRows: Row[] = champions.map((c) => ({
    champion: c.champion,
    item: names("items", c.items[0].id, c.items[0].name),
    icon: c.items[0].icon,
    href: href(c.items[0]),
    also:
      c.items
        .slice(1)
        .map((i) => names("items", i.id, i.name))
        .join(", ") || null,
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
      </div>
      {view === "champions" ? (
        <>
          <p className="patch-note subtab-note">
            {t(
              "Each champion's likeliest Weapon of Destiny, from the Legendary items it builds and the Weapons similar champions pick.",
            )}
          </p>
          <DataTable
            key="champions"
            columns={championColumns}
            rows={championRows}
            initialSort={{ key: "champion", desc: false }}
            searchKey="champion"
            searchLabel={t("Find a champion")}
            urlTab="weapon-of-destiny"
          />
          <p className="patch-note">{why}</p>
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
            initialSort={{ key: "share", desc: true }}
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
