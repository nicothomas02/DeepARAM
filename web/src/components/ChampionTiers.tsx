"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadSettings } from "@/lib/settings";
import { getParam, setParams } from "@/lib/url-state";
import DataTable, { type Column } from "./DataTable";
import { champStats, TIER_HELP, type PatchRow } from "@/lib/tiers";
import Skeleton from "@/components/Skeleton";
import { tagsByKind, tagStyle, type TagInfo } from "@/lib/tag-info";
import { useT } from "./I18n";
import { bySet } from "@/lib/sets";
import { patchName } from "@/lib/patch-name";

// Champion tier list over a chosen patch range: the live patch (default), any set of patches, or all time.
// The page carries only the live and previous patch; older patches load from /data/tier-history.json when picked.

const TIER: Column = {
  key: "tier",
  label: "Tier",
  format: "tier",
  sortKey: "deepScore",
  hint: TIER_HELP,
};
const DEEP: Column = {
  key: "deepScore",
  label: "DeepScore",
  format: "deepscore",
  hint: TIER_HELP,
};
const NAME: Column = { key: "name", label: "Champion", format: "champion" };

const CHANGE: Column = {
  key: "change",
  label: "Change",
  format: "pts",
  hint: "Win rate change since the previous patch, in percentage points.",
};

// Phones keep tier, name, DeepScore and win rate in view; pick rate shows from 360px wide (DataTable Column.phone).
const STANDARD: Column[] = [
  TIER,
  NAME,
  DEEP,
  { key: "win_rate", label: "Win rate", format: "pct" },
  { key: "pick_rate", label: "Pick rate", format: "pct", phone: "wide" },
];

// Every stat in one table, the most useful on the left: rank, win and pick rates first, the finer numbers to the right.
const ADVANCED: Column[] = [
  TIER,
  NAME,
  DEEP,
  { key: "win_rate", label: "Raw win rate", format: "pct" },
  { key: "pick_rate", label: "Pick rate", format: "pct" },
  {
    key: "score",
    label: "Confident win rate",
    format: "pct",
    hint: "The low end of the win rate's likely range, after allowing for how many games there are. DeepScore ranks on this.",
  },
  { key: "damage", label: "Damage share", format: "pct" },
  { key: "tank", label: "Damage taken", format: "pct" },
  { key: "kp", label: "Kill part.", format: "pct" },
  { key: "dead", label: "Time dead", format: "sec" },
  {
    key: "share",
    label: "Game share",
    format: "pct",
    hint: "Estimated share of all games in the chosen patches, from pick rate and days.",
  },
];

// Estimated power curve (lib/estimates.ts powerCurve), sorted by the scaling score behind the label.
const CURVE: Column = {
  key: "curve",
  label: "Strongest",
  format: "text",
  sortKey: "scaling",
  hint: "Estimated from simulated damage at levels 8, 13 and 18: whether the champion peaks early, late or stays even.",
};

// Estimated spread of the champion's win rate over the augments it takes (lib/estimates.ts).
const RELIANCE: Column = {
  key: "reliance",
  label: "Augment reliance",
  format: "spread",
  hint: "Estimated. How far the champion's win rate swings with the augments it gets. High means its augment picks matter a lot.",
};

// Live-patch game counts, when the page has them (lib/fill.ts).
const GAMES: Column = { key: "games", label: "Games", format: "int", hint: "Estimated games on the live patch." };

const MOVERS = { key: "change", desc: true };
const BEST = { key: "deepScore", desc: true };

type Props = {
  rows: PatchRow[];
  patches: string[];
  tags: Record<string, string[]>;
  tagInfo: TagInfo;
  games?: Record<string, number> | null;
  scaling?: Record<string, number>;
  reliance?: Record<string, number>;
};

export default function ChampionTiers({ rows: initial, patches, tags, tagInfo, games, scaling = {}, reliance = {} }: Props) {
  const t = useT("tier-list");
  const tt = useT("tags");
  const live = patches[patches.length - 1];
  const [rows, setRows] = useState(initial);
  const [full, setFull] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set([live]));
  // Opening sort; the Biggest movers button swaps it (and remounts the table to apply it).
  const [sort, setSort] = useState(BEST);
  // The starting range is ?patches= from a shared link, else a setting (gear menu); picking patches here doesn't change the setting.
  useEffect(() => {
    const fromUrl = getParam("patches");
    const listed = fromUrl === "all" ? patches : (fromUrl?.split(",").filter((p) => patches.includes(p)) ?? []);
    if (listed.length) return setPicked(new Set(listed));
    const r = loadSettings().tierRange;
    if (r === "set" || r === "last3") setPicked(new Set(bySet(patches).at(-1)!.patches));
    else if (r === "all") setPicked(new Set(patches));
  }, [patches]);

  const have = useMemo(() => new Set(rows.map((r) => r.patch)), [rows]);
  const missing = [...picked].some((p) => !have.has(p));
  useEffect(() => {
    if (!missing || full) return;
    setFull(true);
    fetch("/data/tier-history.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((all: PatchRow[]) => setRows(all))
      .catch(() => setFull(false));
  }, [missing, full]);

  // Win rate change since the patch before, when one patch is picked.
  const one = picked.size === 1 ? [...picked][0] : null;
  const before = one ? patches[patches.indexOf(one) - 1] : undefined;
  const curveLabel = (v: number | undefined) => (v === undefined ? "" : v > 0.5 ? t("Late game") : v < -0.5 ? t("Early game") : t("Even"));
  const stats = useMemo(() => {
    if (missing) return [];
    const prev = before && have.has(before) ? new Map(champStats(rows, new Set([before])).map((c) => [c.name, c])) : null;
    return champStats(rows, picked).map((c) => {
      const was = prev?.get(c.name);
      // tier_was lets the table slide a changed tier in from the previous patch's (DataTable).
      return {
        ...c,
        change: was === undefined ? null : c.win_rate - was.win_rate,
        tier_was: was?.tier ?? null,
        games: one === live ? (games?.[c.name] ?? null) : null,
        archetype: (tags[c.name] ?? []).filter((t) => tagInfo[t]?.kind !== "play").join(","),
        scaling: scaling[c.name] ?? null,
        curve: curveLabel(scaling[c.name]),
        reliance: reliance[c.name] ?? null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- curveLabel follows t
  }, [rows, picked, before, have, missing, tags, tagInfo, games, one, live, scaling, reliance, t]);

  // Archetype filter (?tag=Mage,Poke): a champion shows when it has every picked tag. Tiers and
  // DeepScores stay graded against the whole list, so a filtered view shows where each stands overall.
  // The tags sit under a closed "Filter by tags" fold, open when a shared link already picks some.
  const [want, setWant] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    const picked = (getParam("tag") ?? "").split(",").filter((t) => tagInfo[t]);
    setWant(picked);
    if (picked.length) setFiltersOpen(true);
  }, [tagInfo]);
  const pickTag = (t: string) => {
    const next = want.includes(t) ? want.filter((x) => x !== t) : [...want, t];
    setWant(next);
    setParams({ tag: next.length ? next.join(",") : null });
  };
  const shownRows = useMemo(() => (want.length ? stats.filter((c) => want.every((t) => tags[c.name]?.includes(t))) : stats), [stats, want, tags]);
  const kinds = useMemo(() => tagsByKind(tagInfo), [tagInfo]);
  const count = (t: string) => stats.filter((c) => tags[c.name]?.includes(t)).length;
  const tagCol: Column = {
    key: "archetype",
    label: "Class",
    format: "tags",
    sortable: false,
    tags: tagInfo,
    hint: "Riot's class and subclass for the champion. Hover a tag to see what it means.",
  };

  const choose = (next: Set<string>) => {
    setPicked(next);
    const list = [...next];
    setParams({
      patches: list.length === 1 && list[0] === live ? null : list.length === patches.length ? "all" : list.join(","),
    });
  };
  const preset = (list: string[]) => {
    choose(new Set(list));
    if (sort !== BEST) {
      setSort(BEST);
      setParams({ sort: null });
    }
  };
  const same = (list: string[]) => list.length === picked.size && list.every((p) => picked.has(p));
  const toggle = (p: string) => {
    const next = new Set(picked);
    if (next.has(p) && next.size > 1) next.delete(p);
    else next.add(p);
    choose(next);
  };
  const movers = () => {
    choose(new Set([live]));
    setSort(MOVERS);
    setParams({ sort: "change.desc" });
  };
  // A shared link or the home page's "All changes" can open the movers view directly.
  useEffect(() => {
    if (getParam("sort") === "change.desc" && !getParam("tab")) setSort(MOVERS);
  }, []);

  // The patch dropdown closes on a click or tap outside it.
  const pickRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const d = pickRef.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  // Patches by Mayhem set, newest set first; the augment pool only changes between sets.
  const groups = bySet(patches).reverse();
  const presets: [string, string[]][] = [
    [t("Live patch ({patch})", { patch: patchName(live) }), [live]],
    ...(groups[0].patches.length > 1 ? [[t("This set ({set})", { set: t(groups[0].set.name) }), groups[0].patches] as [string, string[]]] : []),
    [t("All time"), patches],
  ];
  const toggleSet = (list: string[]) => {
    const all = list.every((p) => picked.has(p));
    const next = new Set(picked);
    for (const p of list) {
      if (all) next.delete(p);
      else next.add(p);
    }
    choose(next.size ? next : new Set([live]));
  };
  const showMulti = picked.size > 1;
  const showChange = !showMulti && Boolean(before);
  const moversOn = sort === MOVERS && same([live]);

  return (
    <div className="patch-range">
      {/* Phones put the range buttons and the patch dropdown on one line, the buttons scrolling sideways. */}
      <div className="patch-bar">
        <div className="patch-presets" role="group" aria-label={t("Patch range")}>
          {presets.map(([label, list]) => (
            <button key={label} type="button" aria-pressed={same(list) && !moversOn} onClick={() => preset(list)}>
              {label}
            </button>
          ))}
          {patches.length > 1 && (
            <button type="button" aria-pressed={moversOn} onClick={movers}>
              {t("Biggest movers")}
            </button>
          )}
        </div>
        <details className="patch-pick" ref={pickRef}>
          <summary>{one ? t("Patch {patch}", { patch: patchName(one) }) : t("{n} patches", { n: picked.size })}</summary>
          <div className="patch-pick-list" role="group" aria-label={t("Patches")}>
            {groups.map(({ set, patches: list }) => (
              <div key={set.name} className="patch-pick-set" role="group" aria-label={t(set.name)}>
                <label className="patch-pick-set-head">
                  <input
                    type="checkbox"
                    checked={list.every((p) => picked.has(p))}
                    ref={(el) => {
                      if (el) el.indeterminate = !list.every((p) => picked.has(p)) && list.some((p) => picked.has(p));
                    }}
                    onChange={() => toggleSet(list)}
                  />
                  {t(set.name)}
                </label>
                {[...list].reverse().map((p) => (
                  <label key={p}>
                    <input type="checkbox" checked={picked.has(p)} onChange={() => toggle(p)} />
                    {patchName(p)}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </details>
      </div>
      {Object.keys(tagInfo).length > 0 && (
        <details className="items-filter-menu" open={filtersOpen} onToggle={(e) => setFiltersOpen(e.currentTarget.open)}>
          <summary>
            {t("Filter by tags")}
            {want.length > 0 && <span className="items-filter-n">{want.length}</span>}
          </summary>
          <div className="arch-filter" role="group" aria-label={t("Filter by archetype")}>
            {[...kinds.class, ...kinds.play].map((t) => {
              const n = count(t);
              return (
                <button
                  key={t}
                  type="button"
                  className="arch-tag"
                  data-kind={tagInfo[t].kind}
                  data-tip={tt(tagInfo[t].meaning)}
                  aria-pressed={want.includes(t)}
                  disabled={!n && !want.includes(t)}
                  style={tagStyle(tagInfo[t].color)}
                  onClick={() => pickTag(t)}
                >
                  {tt(t)} <span className="arch-count">{n}</span>
                </button>
              );
            })}
            {want.length > 0 && (
              <button type="button" className="btn ghost arch-clear" onClick={() => (setWant([]), setParams({ tag: null }))}>
                {t("Clear")}
              </button>
            )}
          </div>
        </details>
      )}
      <p className="patch-note">
        {picked.size === 1
          ? showChange
            ? t("Patch {patch}, with the change since {before}. Pick patches from the list to add or remove them.", {
                patch: patchName([...picked][0]),
                before: patchName(before),
              })
            : t("Patch {patch}. Pick patches from the list to add or remove them.", { patch: patchName([...picked][0]) })
          : t("{n} patches combined. Pick patches from the list to add or remove them.", { n: picked.size })}
      </p>
      {missing ? (
        <Skeleton rows={12} label={t("Loading older patches…")} />
      ) : (
        // Numbers sit next to the name, as on other stat tables; the class tags come last.
        <DataTable
          key={sort.key}
          columns={[...STANDARD, ...(showChange ? [{ ...CHANGE, phone: "hide" as const }] : []), { ...tagCol, phone: "hide" }]}
          advancedColumns={[
            ...ADVANCED.slice(0, 5),
            ...(showChange ? [CHANGE] : []),
            ...(games && one === live ? [GAMES] : []),
            ...(Object.keys(scaling).length ? [CURVE] : []),
            ...(Object.keys(reliance).length ? [RELIANCE] : []),
            ...ADVANCED.slice(5),
            tagCol,
          ]}
          rows={shownRows}
          initialSort={sort}
          searchKey="name"
          searchLabel="Find a champion"
          urlTab=""
        />
      )}
    </div>
  );
}
