"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import RowLink from "./RowLink";
import { useEffect, useMemo, useState } from "react";
import DataTable, { type Column, type Row } from "@/components/DataTable";
import DeepScore from "@/components/DeepScore";
import { EmptyState } from "@/components/EmptyState";
import { ITEM_TAGS, TAG_GROUPS, itemTag } from "@/lib/item-tags";
import { ITEM_TIER_DEEPSCORE_HELP } from "@/lib/deepscore";
import { getParam, setParams } from "@/lib/url-state";
import { useLang, useNames, useT } from "./I18n";

// Items index (the Tier List's Items tab, ?tab=items&itag=crit,as&isort=cost; the params are prefixed so
// they don't clash with the champion table's): colour-coded tag filters (every picked tag must match),
// a name search and a sort. Tags come from the shop's categories (lib/item-tags.ts). "Table" (?iview=table) lists the
// same items as a table sorted by its column headers, for comparing numbers side by side.

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
};
// Shop tiers (lib/items.ts itemTier), in the order the DeepScore view groups them.
type Tier = "legendary" | "boots" | "starter" | "epic" | "basic" | "consumable" | "reward";
const TIERS: [Tier, string][] = [
  ["legendary", "Legendary"],
  ["boots", "Boots"],
  ["starter", "Starter"],
  ["epic", "Epic"],
  ["basic", "Basic"],
  ["consumable", "Consumables"],
  ["reward", "From augments"],
];
const SORTS = [
  ["deepscore", "DeepScore"],
  ["popular", "Most built"],
  ["winrate", "Win rate"],
  ["name", "Name"],
  ["cost", "Cost"],
] as const;
type Sort = (typeof SORTS)[number][0];
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// Table columns. DeepScore compares an item with others of its type, so its column sorts by type first (the
// cards' grouped order), then score.
const COLUMNS: Column[] = [
  { key: "name", label: "Item", format: "item", iconKey: "icon", hrefKey: "href" },
  { key: "type", label: "Type", format: "text", sortKey: "typeOrder" },
  { key: "deepScore", label: "DeepScore", format: "deepscore", sortKey: "rank", hint: ITEM_TIER_DEEPSCORE_HELP },
  { key: "winRate", label: "Est. win rate", format: "pct", hint: "Estimated win rate of the champions who build it." },
  { key: "buildShare", label: "In builds", format: "pct", hint: "Estimated share of builds that include it." },
  { key: "cost", label: "Cost", format: "int" },
];

export default function ItemIndex({ items }: { items: Item[] }) {
  const t = useT("items");
  const tr = t; // for maps whose item is named t
  const names = useNames();
  const lang = useLang();
  const name = (i: Item) => names("items", i.id, i.name);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("deepscore");
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    setPicked((getParam("itag") ?? "").split(",").filter((t) => itemTag(t)));
    const s = getParam("isort");
    if (SORTS.some(([k]) => k === s)) setSort(s as Sort);
    setQuery(getParam("iq") ?? "");
    setAsTable(getParam("iview") === "table");
  }, []);

  // Only tags some item has; counts follow the tags already picked.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((i) => picked.every((t) => i.tags.includes(t)) && (!q || `${i.name} ${name(i)}`.toLowerCase().includes(q)));
    const byName = (a: Item, b: Item) => name(a).localeCompare(name(b), lang);
    if (sort === "deepscore") return list.sort((a, b) => (b.deepScore ?? -1) - (a.deepScore ?? -1) || b.popularity - a.popularity);
    if (sort === "winrate") return list.sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || byName(a, b));
    return list.sort((a, b) => (sort === "name" ? byName(a, b) : sort === "cost" ? b.cost - a.cost || byName(a, b) : b.popularity - a.popularity));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- name follows names
  }, [items, picked, query, sort, names, lang]);
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
        rank: (TIERS.length - at) * 1000 + (i.deepScore ?? -1),
        winRate: i.winRate,
        buildShare: i.buildShare,
        cost: i.cost || null,
      };
    });

  return (
    <div className="items-index">
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
        <div className="seg view-switch" role="group" aria-label={t("View")}>
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={asTable === v}
              onClick={() => {
                setAsTable(v);
                setParams({ iview: v ? "table" : null });
              }}
            >
              {v ? t("Table") : t("Cards")}
            </button>
          ))}
        </div>
        {!asTable && (
          <div className="seg" role="group" aria-label={t("Sort")}>
            {SORTS.map(([k, l]) => (
              <button
                key={k}
                type="button"
                aria-pressed={sort === k}
                onClick={() => {
                  setSort(k);
                  setParams({ isort: k === "deepscore" ? null : k });
                }}
              >
                {t(l)}
              </button>
            ))}
          </div>
        )}
        <span className="items-count">{t("{n} of {total}", { n: shown.length, total: items.length })}</span>
      </div>
      {shown.length && asTable ? (
        <DataTable columns={COLUMNS} rows={tableRows()} initialSort={{ key: "rank", desc: true }} />
      ) : shown.length ? (
        (sort === "deepscore" ? TIERS.map(([k, l]) => [l, shown.filter((i) => i.tier === k)] as const) : [[null, shown] as const])
          .filter(([, list]) => list.length)
          .map(([label, list]) => (
            <section key={label ?? "all"} className="items-tier" aria-label={label ? t(label) : undefined}>
              {label && (
                <h3 className="items-tier-h">
                  {t(label)} <span>{list.length}</span>
                </h3>
              )}
              <ul className="items-grid">
                {list.map((i) => (
                  <li key={i.id}>
                    <RowLink href={`/items/${i.slug}`} className="item-card">
                      {i.icon && <img src={i.icon} alt="" width={48} height={48} loading="lazy" />}
                      <span className="item-card-body">
                        <b>{name(i)}</b>
                        {i.cost > 0 && (
                          <small>
                            {t("{cost} gold", {
                              cost: i.cost.toLocaleString(lang === "en" ? "en-US" : lang),
                            })}
                          </small>
                        )}
                        {sort === "deepscore" && i.deepScore !== null && <DeepScore value={i.deepScore} help={ITEM_TIER_DEEPSCORE_HELP} static />}
                        {i.popularity === 0 && i.tier !== "reward" && <small className="item-card-est">{t("Rarely bought")}</small>}
                        {i.winRate !== null && i.buildShare !== null && (
                          <small className="item-card-est" title={t("Estimated")}>
                            {t("{wr} win · in {share} of builds", { wr: pct(i.winRate), share: pct(i.buildShare) })}
                            {i.granted && ` · ${t("augment item")}`}
                          </small>
                        )}
                        <span className="item-card-tags">
                          {i.tags.map((k) => (
                            <span key={k} className="item-dot" data-group={itemTag(k)?.group} title={itemTag(k) && t(itemTag(k)!.label)} />
                          ))}
                        </span>
                      </span>
                    </RowLink>
                  </li>
                ))}
              </ul>
            </section>
          ))
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
                setParams({ itag: null, iq: null });
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
