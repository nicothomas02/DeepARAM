"use client";

import DataTable, { type Column, type Row } from "@/components/DataTable";
import { useNames, useT } from "./I18n";

// The Tier List's Weapon of Destiny tab (?tab=weapon-of-destiny): every Legendary item ranked by how much the
// augment's upgrades add to the champions who buy it first (lib/weapon-of-destiny.ts). Rows are built here so
// the item names and stats show in the page's language.

type Item = {
  id: number;
  slug: string;
  name: string;
  icon: string;
  perTakedown: Record<string, number>;
  fight: number | null;
  dps: number | null;
  alive: number | null;
  tier: string | null;
  score: number | null;
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

export default function WeaponOfDestiny({ items, takedowns, gold }: { items: Item[]; takedowns: number; gold: number }) {
  const t = useT("destiny");
  const names = useNames();
  const perTakedown = (s: Item["perTakedown"]) =>
    STATS.filter(([k]) => s[k])
      .map(([k, label, pct]) => `+${amount(pct ? s[k] * 100 : s[k])}${pct ? "%" : ""} ${t(label)}`)
      .join(", ");

  const columns: Column[] = [
    { key: "tier", label: t("Tier"), format: "tier", sortKey: "fight", hint: t("From the simulated fight damage it adds, against every other Legendary item: S is far above average, D far below.") },
    { key: "name", label: t("Item"), format: "item", iconKey: "icon", hrefKey: "href" },
    {
      key: "fight",
      label: t("Damage per fight"),
      format: "gain",
      hint: t("Estimated. How much more damage the champions who buy it first deal over a simulated fight once it has {n} takedowns of upgrades.", { n: takedowns }),
    },
    { key: "dps", label: t("Damage per second"), format: "gain", phone: "hide", hint: t("Estimated. The change in their simulated damage per second.") },
    { key: "alive", label: t("Time alive"), format: "gain", phone: "hide", hint: t("Estimated. How much longer they stay alive in the simulated fight.") },
    { key: "stats", label: t("Each takedown"), format: "text", sortable: false, phone: "hide", hint: t("What one takedown adds to the item: {gold} gold worth of its own stats, shared equally.", { gold }) },
    { key: "best", label: t("Best with"), format: "champion-icon", sortable: false, hint: t("The champion it helps most in the simulator.") },
  ];
  const rows: Row[] = items.map((i) => ({
    id: i.id,
    name: names("items", i.id, i.name),
    icon: i.icon,
    href: `/items/${i.slug}`,
    tier: i.tier,
    score: i.score,
    fight: i.fight,
    dps: i.dps,
    alive: i.alive,
    stats: perTakedown(i.perTakedown),
    best: i.best,
  }));

  return (
    <>
      <p className="patch-note subtab-note">
        {t(
          "Weapon of Destiny makes your first Legendary item your Weapon of Destiny. Every champion takedown adds {gold} gold worth of that item's own stats, shared equally between them, so an item with fewer stats puts more into each one.",
          { gold },
        )}
      </p>
      <DataTable columns={columns} rows={rows} initialSort={{ key: "fight", desc: true }} searchKey="name" searchLabel={t("Find an item")} urlTab="weapon-of-destiny" />
      <p className="patch-note">
        {t(
          "Estimated. Each item is simulated on the champions who buy it first most often, once as it is and once with {n} takedowns of upgrades, about half a typical game's takedowns.",
          { n: takedowns },
        )}
      </p>
    </>
  );
}
