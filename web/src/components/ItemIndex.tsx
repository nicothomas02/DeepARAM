"use client";

import { useEffect, useMemo, useState } from "react";
import { textMatches } from "@/lib/fold";
import DataTable, { type Column, type Row } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { ITEM_TAGS, TAG_GROUPS, itemTag } from "@/lib/item-tags";
import { ITEM_TIER_DEEPSCORE_HELP } from "@/lib/deepscore";
import { getParam, setParams } from "@/lib/url-state";
import { useNames, useT } from "./I18n";

// Items index (the Tier List's Items tab, ?tab=items&itag=crit,as&iq=…; the params are prefixed so they don't
// clash with the champion table's), laid out like the Champions tab: colour-coded tag filters under a "Filter by
// tags" fold (every picked tag must match) and a name search above one table sorted by its column headers. Tags come from the shop's
// categories (lib/item-tags.ts).

type Item = {
  id: number;
  slug: string;
  name: string;
  icon?: string;
  cost: number;
  tags: string[];
  popularity: number;
  tier: Tier;
  deepScore: number | null;
  /** Estimated (lib/estimates.ts): win rate, share of builds, and whether an augment can grant it. */
  winRate: number | null;
  buildShare: number | null;
  granted: boolean;
  /** Estimated share of its builds at the 1st, 2nd and 3rd item slot. */
  slots: number[];
};

// Quick filters above the tag fold: the build slot it's usually bought at (a quarter or more of its builds there,
// estimated), a few broad categories, and a switch to leave out items augments hand out (they skew win rates).
const SLOTS: [string, string][] = [
  ["", "Any slot"],
  ["0", "1st item"],
  ["1", "2nd item"],
  ["2", "3rd item"],
];
const CATEGORIES: [string, string, (i: Item) => boolean][] = [
  ["", "All items", () => true],
  ["ad", "AD", (i) => i.tags.includes("ad")],
  ["ap", "AP", (i) => i.tags.includes("ap")],
  ["onhit", "On-hit", (i) => i.tags.includes("onhit")],
  ["tank", "Tank", (i) => i.tags.includes("tank")],
  ["boots", "Boots", (i) => i.tier === "boots"],
];
// Shop tiers (lib/items.ts itemTier), in the order the DeepScore view groups them; each group folds
// away from its header.
type Tier = "legendary" | "boots" | "starter" | "epic" | "basic" | "consumable" | "reward";
const TIERS: [Tier, string][] = [
  ["legendary", "Legendary"],
  ["reward", "From augments"],
  ["boots", "Boots"],
  ["starter", "Starter"],
  ["epic", "Epic"],
  ["basic", "Basic"],
  ["consumable", "Consumables"],
];

// Table columns. The list opens on DeepScore, best first, across every type; sort by Type to group them.
const COLUMNS: Column[] = [
  { key: "name", label: "Item", format: "item", iconKey: "icon", hrefKey: "href" },
  { key: "type", label: "Type", format: "text", sortKey: "typeOrder", phone: "hide" },
  { key: "deepScore", label: "DeepScore", format: "deepscore", hint: ITEM_TIER_DEEPSCORE_HELP },
  { key: "winRate", label: "Est. win rate", format: "pct", hint: "Estimated win rate of the champions who build it." },
  { key: "buildShare", label: "In builds", format: "pct", hint: "Estimated share of builds that include it.", phone: "wide" },
  { key: "cost", label: "Cost", format: "int", phone: "hide" },
];

export default function ItemIndex({ items }: { items: Item[] }) {
  const t = useT("items");
  const tr = t; // for maps whose item is named t
  const names = useNames();
  const name = (i: Item) => names("items", i.id, i.name);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState("");
  const [cat, setCat] = useState("");
  const [noGranted, setNoGranted] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const tags = (getParam("itag") ?? "").split(",").filter((t) => itemTag(t));
    setPicked(tags);
    if (tags.length) setFiltersOpen(true);
    setQuery(getParam("iq") ?? "");
    const sl = getParam("islot") ?? "";
    if (SLOTS.some(([k]) => k === sl)) setSlot(sl);
    const c = getParam("icat") ?? "";
    if (CATEGORIES.some(([k]) => k === c)) setCat(c);
    setNoGranted(getParam("inogrant") === "1");
  }, []);

  // Only tags some item has; counts follow the tags already picked.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inCat = CATEGORIES.find(([k]) => k === cat)?.[2] ?? (() => true);
    return items.filter(
      (i) =>
        picked.every((t) => i.tags.includes(t)) &&
        inCat(i) &&
        (!slot || (i.slots[Number(slot)] ?? 0) >= 0.25) &&
        (!noGranted || (!i.granted && i.tier !== "reward")) &&
        (!q || textMatches(`${i.name} ${name(i)}`.toLowerCase(), q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- name follows names
  }, [items, picked, query, names, slot, cat, noGranted]);
  const count = (key: string) => shown.filter((i) => i.tags.includes(key)).length;

  const toggle = (key: string) => {
    const next = picked.includes(key) ? picked.filter((t) => t !== key) : [...picked, key];
    setPicked(next);
    setParams({ itag: next.join(",") || null });
  };

  const tableRows = (): Row[] =>
    shown.map((i) => {
      const at = TIERS.findIndex(([k]) => k === i.tier);
      return {
        id: i.id,
        name: name(i),
        icon: i.icon ?? "",
        href: `/items/${i.slug}`,
        type: tr(TIERS[at]?.[1] ?? ""),
        typeOrder: TIERS.length - at,
        deepScore: i.deepScore,
        winRate: i.winRate,
        buildShare: i.buildShare,
        cost: i.cost || null,
      };
    });

  return (
    <div className="items-index">
      <div className="items-quick">
        <div className="helper-threats" role="group" aria-label={t("Build slot")}>
          {SLOTS.map(([k, l]) => (
            <button
              key={k || "any"}
              type="button"
              className="chip-toggle"
              aria-pressed={slot === k}
              title={k ? t("Estimated: items often bought at this slot.") : undefined}
              onClick={() => {
                setSlot(k);
                setParams({ islot: k || null });
              }}
            >
              {t(l)}
            </button>
          ))}
        </div>
        <div className="helper-threats" role="group" aria-label={t("Category")}>
          {CATEGORIES.map(([k, l]) => (
            <button
              key={k || "all"}
              type="button"
              className="chip-toggle"
              aria-pressed={cat === k}
              onClick={() => {
                setCat(k);
                setParams({ icat: k || null });
              }}
            >
              {t(l)}
            </button>
          ))}
        </div>
        <label className="items-switch">
          <input
            type="checkbox"
            checked={noGranted}
            onChange={(e) => {
              setNoGranted(e.target.checked);
              setParams({ inogrant: e.target.checked ? "1" : null });
            }}
          />
          {t("Hide items augments can give")}
        </label>
      </div>
      <details className="items-filter-menu" open={filtersOpen} onToggle={(e) => setFiltersOpen(e.currentTarget.open)}>
        <summary>
          {t("Filter by tags")}
          {picked.length > 0 && <span className="items-filter-n">{picked.length}</span>}
        </summary>
        <div className="items-filters">
          {TAG_GROUPS.map(([group, label]) => (
            <div key={group} className="items-group" data-group={group} role="group" aria-label={t(label)}>
              <span className="items-group-label">{t(label)}</span>
              {ITEM_TAGS.filter((t) => t.group === group && items.some((i) => i.tags.includes(t.key))).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="item-tag"
                  data-group={group}
                  aria-pressed={picked.includes(t.key)}
                  disabled={!picked.includes(t.key) && count(t.key) === 0}
                  onClick={() => toggle(t.key)}
                >
                  {tr(t.label)}
                  <small>{picked.includes(t.key) ? "" : count(t.key)}</small>
                </button>
              ))}
            </div>
          ))}
        </div>
      </details>
      <div className="items-bar">
        <input
          type="search"
          className="table-search"
          placeholder={t("Find an item")}
          aria-label={t("Find an item")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setParams({ iq: e.target.value.trim() || null });
          }}
        />
        <span className="items-count">{t("{n} of {total}", { n: shown.length, total: items.length })}</span>
      </div>
      {shown.length ? (
        <DataTable columns={COLUMNS} rows={tableRows()} initialSort={{ key: "deepScore", desc: true }} />
      ) : (
        <EmptyState
          title={t("No item has all of those")}
          action={
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPicked([]);
                setQuery("");
                setSlot("");
                setCat("");
                setNoGranted(false);
                setParams({ itag: null, iq: null, islot: null, icat: null, inogrant: null });
              }}
            >
              {t("Show every item")}
            </button>
          }
        >
          {t("Remove a tag or clear the search.")}
        </EmptyState>
      )}
    </div>
  );
}
