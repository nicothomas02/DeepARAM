"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import RowLink from "@/components/RowLink";
import { PICK_EVENT } from "@/components/champion/AugmentBuildPicker";
import { useRef, useState, type DragEvent } from "react";
import { KEPT, useKept } from "@/lib/kept";
import { useBracket, type BracketKey } from "@/lib/bracket-pref";
import { Name, useDescription, useNames, useT } from "@/components/I18n";
import DeepScore from "@/components/DeepScore";
import { signedPts, tone } from "@/components/champion/Ranked";
import type { AugmentRow } from "@/lib/champion-page";
import { AUGMENT_DEEPSCORE_HELP } from "@/lib/deepscore";
import { PICK_TAG_SHARE, SHOW_AUGMENT_WIN_RATES } from "@/lib/augment-policy";
import { comboPotential, synergyWhyTemplate, synergyWith, type SynergyPair } from "@/lib/synergy-picks";

// A champion's augments as one ranked table with rarity and augment pick filters, best DeepScore first, each with the game's
// build tags, ten to a page. The number columns' headers re-sort it (highest first; a second click flips it). The search box
// above it finds an augment by name (English or the page's language) and keeps its rank, so a visitor sees where it places.
// The round "+" by a row's icon selects an augment the visitor already has: it leaves the list, and the rest re-rank by their boost
// plus their estimated synergy with the taken ones (lib/synergy-picks.ts), so Mystic Punch climbs once Ethereal Weapon is in.

const RARITIES = ["all", "prismatic", "gold", "silver"] as const;
const LABEL = {
  all: "All",
  prismatic: "Prismatic",
  gold: "Gold",
  silver: "Silver",
};
const PAGE = 10;
// Augment picks: "any", or the 1st to 4th pick of the game. An augment counts for a pick when at least a fair share
// (a quarter) of its picks, across all champions, happen there (estimated).
const PICKS = ["any", 0, 1, 2, 3] as const;
const PICK_LABEL = ["1st augment", "2nd augment", "3rd augment", "4th augment"];
const FAIR_SHARE = 0.25;
type SortKey = "deepScore" | "winRate" | "lift" | "pickRate" | "fit" | "combo";
// Four augments a game: four slots, in pick order (order matters for some pairs, lib/synergy-picks.ts).
const MAX_TAKEN = 4;
const SLOT_LABEL = ["1st augment", "2nd augment", "3rd augment", "4th augment"];
// Drag data type for an augment id, from a row or a slot to a slot.
const DRAG = "application/x-deeparam-augment";

const BRACKET_LABELS: [BracketKey, string][] = [
  ["all", "All players"],
  ["casual", "Casual"],
  ["mid", "Mid"],
  ["high", "Top 5%"],
];

export default function AugmentTable({
  rows: givenRows,
  champion,
  synergy = [],
  patch,
  brackets,
}: {
  /** DeepScore per augment for each skill bracket, half bracket and half all players, live patch only
   *  (lib/bracket-augments.ts); absent when the live patch has no bracket tables, and the bracket switch hides. */
  brackets?: Partial<Record<"casual" | "mid" | "high", Record<number, number>>>;
  /** The live patch's name ("16.23"), for the "16.23+" / "16.23 only" switch. */
  patch?: string;
  /** The champion's id ("Kayle"), for the "why" lines. */
  champion?: string;
  /** Augment pairs that feed each other on this champion (estimated), for re-ranking after a selection. */
  synergy?: SynergyPair[];
  rows: (AugmentRow & {
    /** The augment's official description in English, translated on the page. */
    desc?: string;
    href?: string;
    deepScore?: number;
    /** DeepScore on the live patch's games alone; deepScore pools earlier patches where nothing changed. */
    patchScore?: number;
    winRate?: number;
    lift?: number;
    /** Share of the augment's picks at each of the four augment picks. */
    stages?: number[];
    /** The Simulator's best items with it differ from its best items without it (lib/augment-builds.ts). */
    changesBuild?: boolean;
  })[];
}) {
  const t = useT("champions");
  const tt = useT("tables");
  const ts = useT("tier-list");
  const names = useNames();
  const describe = useDescription();
  const box = useRef<HTMLDivElement>(null);
  const [rarity, setRarity] = useKept<(typeof RARITIES)[number]>(
    "all",
    box,
    "rarity",
  );
  const [pick, setPick] = useKept<(typeof PICKS)[number]>("any", box, "pick");
  const [page, setPage] = useKept(0, box, "page");
  const top = useRef<HTMLDivElement>(null);
  // Turning the page from the buttons under the table brings the new page's first row back into view.
  const turn = (p: number) => {
    setPage(p);
    const y = top.current?.getBoundingClientRect().top ?? 0;
    if (y < 0) top.current?.scrollIntoView({ block: "start" });
  };
  const [sort, setSort] = useKept<{ key: SortKey; desc: boolean }>(
    {
      key: "deepScore",
      desc: true,
    },
    box,
    "sort",
  );
  const [query, setQuery] = useState("");
  // Small samples (Nico 2026-11-23): DeepScore pools earlier patches by default; "This patch only" ranks on the live
  // patch's games alone. The switch shows only when the two differ.
  const [thisPatch, setThisPatch] = useKept(false, box, "thisPatch");
  const pooledDiffers = givenRows.some((r) => r.patchScore !== r.deepScore);
  // Skill bracket (Nico 2026-11-24, "Half-and-half, live patch only"): the visitor's bracket re-ranks the list when the
  // live patch has bracket tables; All players otherwise.
  const [bracketPref, setBracketPref] = useBracket();
  const bracketKeys = BRACKET_LABELS.filter(([k]) => k === "all" || brackets?.[k as "casual"]);
  const bracket = bracketPref !== "all" ? (brackets?.[bracketPref] ?? null) : null;
  const allRows = bracket
    ? givenRows.map((r) => ({ ...r, deepScore: bracket[r.id] ?? r.deepScore }))
    : thisPatch && pooledDiffers
      ? givenRows.map((r) => ({ ...r, deepScore: r.patchScore }))
      : givenRows;
  const [took, setTook] = useKept<number[]>([], box, "took");
  const byId = new Map(allRows.map((r) => [r.id, r]));
  const taken = took.filter((id) => byId.has(id));
  const syn = synergyWith(synergy, taken);
  // With augments taken, each other one's boost gains its synergy with them, and "fit" ranks by that.
  // Combo potential (Nico 2026-11-21): a confirmed partner still to come is worth part of the pair while picks remain,
  // so Ethereal Weapon climbs before Mystic Punch is taken. A second sort; the default stays each augment's own power.
  const combos = comboPotential(synergy, taken, new Set(allRows.map((r) => r.id)), MAX_TAKEN);
  const rows = allRows
    .filter((r) => !taken.includes(r.id))
    .map((r) => ({
      ...r,
      fit: taken.length ? (r.lift ?? 0) + (syn.get(r.id)?.total ?? 0) : undefined,
      combo: r.lift === undefined ? undefined : r.lift + (syn.get(r.id)?.total ?? 0) + (combos.get(r.id)?.points ?? 0) / 100,
    }));
  const take = (id: number) => {
    if (taken.includes(id) || taken.length >= MAX_TAKEN) return;
    setTook([...taken, id]);
    if (!taken.length) setSort({ key: "fit", desc: true });
    setPage(0);
  };
  /** Put `id` in slot `i`: replaces what's there; an augment already in another slot swaps places with it. */
  const place = (id: number, i: number) => {
    if (!byId.has(id)) return;
    const next = [...taken];
    const from = next.indexOf(id);
    if (i >= next.length) {
      if (from >= 0) next.splice(from, 1);
      next.push(id);
    } else if (from >= 0) {
      [next[from], next[i]] = [next[i], next[from]];
    } else next[i] = id;
    setTook(next.slice(0, MAX_TAKEN));
    if (!taken.length) setSort({ key: "fit", desc: true });
    setPage(0);
  };
  const dragFrom = (id: number) => (e: DragEvent) => {
    e.dataTransfer.setData(DRAG, String(id));
    e.dataTransfer.effectAllowed = "move";
  };
  const [over, setOver] = useState<number | null>(null);
  const untake = (id?: number) => {
    const next = id === undefined ? [] : taken.filter((x) => x !== id);
    setTook(next);
    if (!next.length && sort.key === "fit") setSort({ key: "deepScore", desc: true });
    setPage(0);
  };
  const sortKey: SortKey = sort.key === "fit" && !taken.length ? "deepScore" : sort.key;
  const ranked = rows
    .filter((r) => rarity === "all" || r.rarity === rarity)
    .filter((r) => pick === "any" || (r.stages?.[pick] ?? 0) >= FAIR_SHARE)
    .sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      // Rows without the number stay last either way.
      if (x === undefined) return y === undefined ? 0 : 1;
      if (y === undefined) return -1;
      return (x - y) * (sort.desc ? -1 : 1);
    });
  const rankOf = new Map(ranked.map((r, i) => [r.id, i]));
  const q = fold(query);
  const shown = q
    ? ranked.filter((r) => fold(r.name).includes(q) || fold(names("augments", r.id, r.name)).includes(q))
    : ranked;
  const head = (key: SortKey, label: string) => (
    <span>
      <button
        type="button"
        className="cp-sort"
        aria-pressed={sortKey === key}
        onClick={() => {
          setSort(
            sort.key === key ? { key, desc: !sort.desc } : { key, desc: true },
          );
          setPage(0);
        }}
      >
        {t(label)}
        <span className="sort-mark" aria-hidden="true">
          {sortKey === key ? (sort.desc ? "↓" : "↑") : ""}
        </span>
      </button>
    </span>
  );
  // Estimated win rates, when there are any: an extra column with each augment's win rate boost below it.
  const est = rows.some((r) => r.winRate !== undefined || r.lift !== undefined) || taken.length > 0;
  const cols = est ? 3 : 2;
  const pages = Math.ceil(shown.length / PAGE);
  const at = Math.min(page, Math.max(0, pages - 1));
  const hasPicks = rows.some((r) => r.stages);
  // Why an augment ranks where it does (visitor feedback 2026-11-06): what it does, then how much it moves this
  // champion's win rate, in plain words. The biggest boost on the champion says so.
  const champ = champion ? names("champions", champion, champion.replace(/([a-z])([A-Z])/g, "$1 $2")) : "";
  const topLift = Math.max(...rows.map((r) => r.lift ?? -Infinity));
  const augName = (id: number) => {
    const r = byId.get(id);
    return r ? names("augments", id, r.name) : String(id);
  };
  // Taken augments that move nothing: no known pair with any augment left in the list.
  const lonely = taken.filter((id) => ![...syn.values()].some((v) => v.parts.some((p) => p.with === id)));
  const why = (a: (typeof rows)[number]) => {
    const parts = [a.desc ? describe("augments", a.id, a.desc) : ""];
    // Synergy with the taken augments first: it's why the row moved.
    for (const p of syn.get(a.id)?.parts ?? []) {
      const n = Math.abs(p.points).toFixed(1);
      const line =
        p.points >= 0
          ? t("Pairs well with {name}: +{n} pts.", { name: augName(p.with), n })
          : t("Overlaps with {name}: -{n} pts.", { name: augName(p.with), n });
      // The reason translates as a template with the augments' names in the page's language.
      const w = p.why ? synergyWhyTemplate(p.why, [[byId.get(a.id)?.name ?? "", a.id], [byId.get(p.with)?.name ?? "", p.with]]) : null;
      parts.push(w ? `${line} ${t(w.key, Object.fromEntries(w.ids.map((id, i) => [String(i + 1), augName(id)])))}` : line);
    }
    const n = Math.abs((a.lift ?? 0) * 100).toFixed(1);
    if (champ && a.lift !== undefined) {
      if (a.lift === topLift && a.lift >= 0.005) parts.push(t("The biggest win rate boost of any augment on {champ}: +{n} pts.", { champ, n }));
      else if (a.lift >= 0.005) parts.push(t("Raises {champ}'s win rate by {n} pts.", { champ, n }));
      else if (a.lift <= -0.005) parts.push(t("Lowers {champ}'s win rate by {n} pts.", { champ, n }));
    }
    return parts.filter(Boolean).join(" ");
  };
  return (
    <>
      <div className="cp-filters" ref={box} {...KEPT}>
        <input
          className="table-search"
          type="search"
          placeholder={tt("Find an augment")}
          aria-label={tt("Find an augment")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <div className="cp-took" role="group" aria-label={t("Your augments")}>
          <span>{t("Your augments")}</span>
          {Array.from({ length: MAX_TAKEN }, (_, i) => {
            const id = taken[i];
            return (
              <div
                key={i}
                className={`cp-slot${id === undefined ? " empty" : ""}${over === i ? " over" : ""}`}
                draggable={id !== undefined}
                onDragStart={id !== undefined ? dragFrom(id) : undefined}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DRAG)) return;
                  e.preventDefault();
                  setOver(i);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const dropped = Number(e.dataTransfer.getData(DRAG));
                  if (dropped) place(dropped, i);
                }}
                title={id === undefined ? t("Drag an augment here, or press + on it.") : t("Drag another augment here to replace it.")}
              >
                {id === undefined ? (
                  <small>{t(SLOT_LABEL[i])}</small>
                ) : (
                  <>
                    <img className="cp-icon round" src={`/icons/augments/${id}.webp`} alt="" width={24} height={24} />
                    <Name kind="augments" id={id}>
                      {byId.get(id)?.name ?? ""}
                    </Name>
                    <button type="button" className="cp-slot-x" onClick={() => untake(id)} aria-label={t("Remove")} title={t("Remove")}>
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {taken.length > 0 && (
            <button type="button" className="cp-took-clear" onClick={() => untake()}>
              {t("Clear")}
            </button>
          )}
        </div>
        <div className="cp-seg" role="group" aria-label={t("Rarity")}>
          {RARITIES.filter(
            (r) => r === "all" || rows.some((x) => x.rarity === r),
          ).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={rarity === r}
              onClick={() => {
                setRarity(r);
                setPage(0);
              }}
            >
              {t(LABEL[r])}
            </button>
          ))}
        </div>
        {hasPicks && (
          <div className="cp-seg" role="group" aria-label={t("Augment pick")}>
            {PICKS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={pick === p}
                onClick={() => {
                  setPick(p);
                  setPage(0);
                }}
              >
                {p === "any" ? t("All picks") : t(PICK_LABEL[p])}
              </button>
            ))}
          </div>
        )}
        {bracketKeys.length > 1 && (
          <div className="cp-seg" role="group" aria-label={ts("Skill bracket")}>
            {bracketKeys.map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={(bracket ? bracketPref : "all") === k}
                onClick={() => (setBracketPref(k as BracketKey), setPage(0))}
              >
                {ts(label)}
              </button>
            ))}
          </div>
        )}
        {pooledDiffers && !bracket && (
          <div
            className="cp-seg"
            role="group"
            aria-label={t("Games counted")}
          >
            <button
              type="button"
              aria-pressed={!thisPatch}
              data-tip={t("Includes similar recent patches, weighted toward this one")}
              onClick={() => (setThisPatch(false), setPage(0))}
            >
              {patch ? t("{patch}+", { patch }) : t("Recent patches")}
            </button>
            <button type="button" aria-pressed={thisPatch} onClick={() => (setThisPatch(true), setPage(0))}>
              {patch ? t("{patch} only", { patch }) : t("This patch only")}
            </button>
          </div>
        )}
        {est && Array.from(combos.values()).some((c) => c.points > 0) && (
          <div className="cp-seg" role="group" aria-label={t("Rank by")}>
            <button
              type="button"
              aria-pressed={sortKey !== "combo"}
              onClick={() => {
                setSort({ key: taken.length ? "fit" : "deepScore", desc: true });
                setPage(0);
              }}
            >
              {t("Own power")}
            </button>
            <button
              type="button"
              aria-pressed={sortKey === "combo"}
              onClick={() => {
                setSort({ key: "combo", desc: true });
                setPage(0);
              }}
            >
              {t("Combo potential")}
            </button>
          </div>
        )}
        {lonely.length > 0 && (
          <p className="cp-filter-note">
            {t("No known synergy with {names} on this champion yet, so the rest rank by their boost alone.", {
              names: lonely.map(augName).join(", "),
            })}
          </p>
        )}
        <p className="cp-filter-note">
          {sortKey === "combo"
            ? t("Estimated: ranked by each augment's boost plus part of its best confirmed combo while picks remain.")
            : taken.length
            ? t("Estimated: ranked by each augment's boost plus its synergy with the ones you took.")
            : t("Already have augments? Press + or drag them into your slots, and the rest re-rank by synergy.")}
        </p>
        {pick !== "any" && (
          <p className="cp-filter-note">
            {t(
              "Estimated: augments often taken at this pick on this champion.",
            )}
          </p>
        )}
      </div>
      <div className="cp-th cp-aug" data-cols={cols} ref={top}>
        <span>{t("Rank")}</span>
        <span>{t("Augment")}</span>
        {head("deepScore", "DeepScore")}
        {est &&
          (sortKey === "combo"
            ? head("combo", "With combos")
            : taken.length
            ? head("fit", "With your picks")
            : SHOW_AUGMENT_WIN_RATES
              ? head("winRate", "Est. win rate")
              : head("lift", "Boost"))}
        {head("pickRate", "Pick rate")}
      </div>
      <div className="cp-rows">
        {shown.slice(at * PAGE, (at + 1) * PAGE).map((a, j) => {
          const i = rankOf.get(a.id) ?? at * PAGE + j;
          const body = (
            <>
              {taken.length < MAX_TAKEN && (
                // Select an augment you already have: a round "+" by its icon. Not an <a>: the whole row links to the
                // augment, so this handles its own click (data-no-link), like "Changes your build".
                <span
                  className="cp-pick"
                  role="button"
                  tabIndex={0}
                  data-no-link
                  aria-label={t("Select {name}: the rest re-rank by synergy with it.", { name: augName(a.id) })}
                  title={t("Select: the rest re-rank by synergy with it.")}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    take(a.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    e.stopPropagation();
                    take(a.id);
                  }}
                >
                  +
                </span>
              )}
              <img
                className="cp-icon round"
                src={`/icons/augments/${a.id}.webp`}
                alt=""
                width={36}
                height={36}
                loading="lazy"
              />
              <span className="cp-text">
                <span className="cp-name">
                  <Name kind="augments" id={a.id}>
                    {a.name}
                  </Name>
                </span>
                <span className={`cp-pill ${a.rarity}`}>
                  {t(LABEL[a.rarity])}
                </span>
                {/* The game's own build tags for the augment (lib/build-tags.ts). */}
                {/* The augment picks (1st to 4th) where it usually shows up on this champion (estimated). */}
                {(() => {
                  const at = (a.stages ?? []).flatMap((share, k) => (share >= PICK_TAG_SHARE ? [k + 1] : []));
                  return at.length ? (
                    <span className="cp-pill cp-tag" title={t("Estimated: the augment picks (1st to 4th) where it usually shows up.")}>
                      {t("Pick {n}", { n: at.join(" · ") })}
                    </span>
                  ) : null;
                })()}
                {a.changesBuild && (
                  // Not an <a>: the whole row already links to the augment, and a link inside a link breaks the page's
                  // hydration. A click here picks the augment in the augment build picker and jumps there instead of opening it.
                  <span
                    className="cp-pill cp-changes"
                    data-no-link
                    title={t("The best items with this augment differ from your usual build.")}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: a.id }));
                      document.getElementById("augment-builds")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      history.replaceState(null, "", "#augment-builds");
                    }}
                  >
                    {t("Changes your build")}
                  </span>
                )}
                {(() => {
                  const total = syn.get(a.id)?.total ?? 0;
                  return Math.abs(total) >= 0.003 ? (
                    <span className={`cp-pill cp-syn ${tone(total) ?? ""}`} title={t("Estimated synergy with the augments you took.")}>
                      {t("Synergy {n}", { n: tt("{n} pts", { n: signedPts(total) }) })}
                    </span>
                  ) : null;
                })()}
                {(() => {
                  const c = combos.get(a.id);
                  return c && c.points > 0 ? (
                    <span
                      className="cp-pill cp-syn up"
                      title={t("Estimated: a confirmed partner is still to come, worth part of the pair's points while picks remain.")}
                    >
                      {t("Combos with {name} {n}", { name: augName(c.with), n: tt("{n} pts", { n: signedPts(c.points / 100) }) })}
                    </span>
                  ) : null;
                })()}
                {(a.tags ?? []).map((tag) => (
                  <span key={tag} className="cp-pill cp-tag">
                    {ts(tag)}
                  </span>
                ))}
              </span>
            </>
          );
          const reason = why(a);
          return (
            <div key={a.id} className="cp-row cp-aug" data-cols={cols} draggable onDragStart={dragFrom(a.id)}>
              <span className="cp-rk">#{i + 1}</span>
              {a.href ? (
                <RowLink className="cp-what" href={a.href}>
                  {body}
                </RowLink>
              ) : (
                <div className="cp-what">{body}</div>
              )}
              <div className="cp-cell">
                {a.deepScore !== undefined ? (
                  <DeepScore
                    value={a.deepScore}
                    help={AUGMENT_DEEPSCORE_HELP}
                  />
                ) : (
                  <b>–</b>
                )}
              </div>
              {est && (
                <div className="cp-cell">
                  {sortKey === "combo" && a.combo !== undefined ? (
                    <b className={tone(a.combo)}>{tt("{n} pts", { n: signedPts(a.combo) })}</b>
                  ) : taken.length && a.fit !== undefined ? (
                    <b className={tone(a.fit)}>{tt("{n} pts", { n: signedPts(a.fit) })}</b>
                  ) : !SHOW_AUGMENT_WIN_RATES && a.lift !== undefined ? (
                    // Riot's policy rules out augment win rates (lib/augment-policy.ts): just the boost, in points.
                    <b className={tone(a.lift ?? 0)}>{tt("{n} pts", { n: signedPts(a.lift ?? 0) })}</b>
                  ) : SHOW_AUGMENT_WIN_RATES && a.winRate !== undefined ? (
                    <>
                      <b className={tone(a.lift ?? 0)}>
                        {(a.winRate * 100).toFixed(1)}%
                      </b>
                      {/* Phones show just the points, so the column stays narrow. */}
                      <small className="cp-wide">
                        {t("{n} boost", {
                          n: tt("{n} pts", { n: signedPts(a.lift ?? 0) }),
                        })}
                      </small>
                      <small className="cp-narrow">
                        {tt("{n} pts", { n: signedPts(a.lift ?? 0) })}
                      </small>
                    </>
                  ) : (
                    <b>–</b>
                  )}
                </div>
              )}
              <div className="cp-cell">
                <b>{(a.pickRate * 100).toFixed(1)}%</b>
                <small className="cp-wide">{t("Pick rate")}</small>
              </div>
              {reason && <p className="cp-why">{reason}</p>}
            </div>
          );
        })}
      </div>
      {pages > 1 && (
        <nav className="cp-pages" aria-label={t("Augment pages")}>
          <button
            type="button"
            disabled={at === 0}
            onClick={() => turn(at - 1)}
            aria-label={t("Previous page")}
          >
            ‹
          </button>
          {pageList(at, pages).map((p, k) =>
            p === null ? (
              <span key={`gap${k}`} aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-current={p === at ? "page" : undefined}
                onClick={() => turn(p)}
              >
                {p + 1}
              </button>
            ),
          )}
          <button
            type="button"
            disabled={at === pages - 1}
            onClick={() => turn(at + 1)}
            aria-label={t("Next page")}
          >
            ›
          </button>
        </nav>
      )}
      {shown.length === 0 && (
        <p className="cp-empty-line cp-filter-note">
          {q && ranked.length > 0
            ? t("No ranked augment on this champion matches that name.")
            : t("No augments match these filters.")}
        </p>
      )}
    </>
  );
}

/** Lower case without accents, so "Kleptomancy" matches "klepto" and "Éclair" matches "eclair". */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Page numbers to show: the first, the last and the current one with its neighbours, with gaps (null) between. */
function pageList(at: number, pages: number): (number | null)[] {
  const keep = [...new Set([0, at - 1, at, at + 1, pages - 1])]
    .filter((p) => p >= 0 && p < pages)
    .sort((a, b) => a - b);
  return keep.flatMap((p, k) =>
    k > 0 && p - keep[k - 1] > 1 ? [null, p] : [p],
  );
}
