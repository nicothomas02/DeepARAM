"use client";

/* eslint-disable @next/next/no-img-element -- small local icons */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { T, useT } from "@/components/I18n";
import WinRate from "@/components/WinRate";
import { Cell, ItemIcon, LaterItems, RatedCells, pct } from "@/components/champion/Ranked";
import { buildOrder } from "@/lib/card-score";
import { cardBuyOrder } from "@/lib/engine/first-buys";
import { radarFor } from "@/lib/radar";
import { bySet } from "@/lib/sets";
import { champStats, type PatchRow } from "@/lib/tiers";
import { cardFor, type HistFile } from "@/lib/timeframe";
import { SITUATIONS } from "@/lib/situations";
import { getParam, setParams } from "@/lib/url-state";
import { patchName } from "@/lib/patch-name";

// The champion page's timeframe (Nico, 2026-11-20): the live patch by default, with a live dot; any patches; any
// Mayhem sets; or all time. One kind at a time, several patches or sets at once. The header numbers, the top card
// and the Performance tiles follow the pick; the server renders the live patch, and other picks are worked out here
// from /data/tier-history.json (every champion, so tiers and ranks match the Tier List) and
// /data/champion-history/<Alias> (builds, saved from 16.20 on). ?tf= in a link: all, p:16.21,16.22 or s:Set 3.

type Pick = { kind: "patch" | "set" | "all" | "only"; list: string[] };
// The default: "{live}+", the live patch with the patch before at half weight (lib/tiers.ts plusRows), drawn by the
// server (the `plus` views). ONLY: the live patch alone ("{live} only", ?tf=only), also drawn by the server.
const LIVE: Pick = { kind: "patch", list: [] };
const ONLY: Pick = { kind: "only", list: [] };

let current: Pick = LIVE;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function choose(p: Pick, live?: string) {
  current = p.kind === "patch" && p.list.length === 1 && p.list[0] === live ? LIVE : p;
  const c = current;
  setParams({ tf: c === LIVE ? null : c === ONLY ? "only" : c.kind === "all" ? "all" : `${c.kind[0]}:${c.list.join(",")}` });
  listeners.forEach((fn) => fn());
}
const usePick = () => useSyncExternalStore(subscribe, () => current, () => LIVE);

/** The patches a pick covers, oldest first (null = the live patch, which the server already drew). */
function patchesOf(p: Pick, patches: string[]): string[] | null {
  if (p === LIVE || p === ONLY) return null;
  if (p.kind === "all") return patches;
  if (p.kind === "patch") return patches.filter((x) => p.list.includes(x));
  const sets = new Set(p.list);
  return bySet(patches).flatMap((g) => (sets.has(g.set.name) ? g.patches : []));
}

// ---- Data, loaded once a range other than the live patch is picked. ----

let rowsCache: Promise<PatchRow[]> | null = null;
const loadRows = () =>
  (rowsCache ??= fetch("/data/tier-history.json").then((r) => (r.ok ? r.json() : Promise.reject(r.status))));
const histCache = new Map<string, Promise<HistFile>>();
const loadHist = (alias: string) => {
  if (!histCache.has(alias))
    histCache.set(alias, fetch(`/data/champion-history/${alias}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))));
  return histCache.get(alias)!;
};

function useLoaded<T>(load: (() => Promise<T>) | null): T | null | "error" {
  const [v, setV] = useState<T | null | "error">(null);
  useEffect(() => {
    if (!load) return;
    let on = true;
    load().then(
      (x) => on && setV(x),
      () => on && setV("error"),
    );
    return () => {
      on = false;
    };
  }, [load]);
  return v;
}

/** The champion's tier, rates and rank over the picked patches, scored against every champion like the Tier List. */
function useRangeStats(alias: string, patches: string[], matches?: Record<string, number>) {
  const pick = usePick();
  const picked = useMemo(() => patchesOf(pick, patches), [pick, patches]);
  const rows = useLoaded<PatchRow[]>(picked ? loadRows : null);
  return useMemo(() => {
    if (!picked || !rows || rows === "error") return { picked, ready: false };
    const all = champStats(rows, new Set(picked), matches);
    const at = all.findIndex((c) => c.name === alias);
    // The champion's games in each patch (pick rate × matches, or × days), to weigh each patch's builds.
    const mine = rows.filter((r) => r.name === alias && picked.includes(r.patch));
    const weight = Object.fromEntries(mine.map((r) => [r.patch, r.pick_rate * (matches?.[r.patch] ?? r.days)]));
    // Games shown: every game in the picked patches (pick rate × matches), not the recency-weighted sample.
    const games = matches ? Math.round(mine.reduce((n, r) => n + r.pick_rate * (matches[r.patch] ?? 0), 0)) : undefined;
    return { picked, ready: true, all, weight, games, me: at < 0 ? null : all[at], rank: at + 1 };
  }, [picked, rows, alias, matches]);
}

/** children: the live patch alone (server-drawn); plus: the default "{live}+" view (server-drawn), when there is one. */
type Common = { alias: string; patches: string[]; matches?: Record<string, number>; children: ReactNode; plus?: ReactNode };

// ---- Controls ----

export function TimeframePicker({ patches, buildPatches }: { patches: string[]; buildPatches: string[] }) {
  const t = useT();
  const tl = useT("tier-list");
  const tc = useT("champions");
  const pick = usePick();
  const live = patches[patches.length - 1];
  const sets = bySet(patches).reverse();
  useEffect(() => {
    const v = getParam("tf");
    if (!v) return;
    if (v === "all") return choose({ kind: "all", list: [] }, live);
    if (v === "only") return choose(ONLY, live);
    const [k, rest] = [v.slice(0, 2), v.slice(2).split(",")];
    if (k === "p:") {
      const list = rest.filter((p) => patches.includes(p));
      if (list.length) choose({ kind: "patch", list }, live);
    } else if (k === "s:") {
      const list = rest.filter((s) => sets.some((g) => g.set.name === s));
      if (list.length) choose({ kind: "set", list }, live);
    }
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dropdowns close on a click outside them, and each other when one opens.
  const patchRef = useRef<HTMLDetailsElement>(null);
  const setRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      for (const d of [patchRef.current, setRef.current]) if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const patchList = pick === LIVE || pick === ONLY ? [live] : pick.kind === "patch" ? pick.list : [];
  const setList = pick.kind === "set" ? pick.list : [];
  const togglePatch = (p: string) => {
    const has = patchList.includes(p);
    const next = has ? patchList.filter((x) => x !== p) : [...patchList, p];
    choose(next.length ? { kind: "patch", list: next } : LIVE, live);
  };
  const toggleSet = (s: string) => {
    const has = setList.includes(s);
    const next = has ? setList.filter((x) => x !== s) : [...setList, s];
    choose(next.length ? { kind: "set", list: next } : LIVE, live);
  };
  const patchLabel =
    patchList.length > 1
      ? tl("{n} patches", { n: patchList.length })
      : t("Patch {patch}", { patch: patchName(patchList[0] ?? live) });
  const setLabel = setList.length > 1 ? t("{n} sets", { n: setList.length }) : tl(setList[0] ?? sets[0].set.name);

  const picked = patchesOf(pick, patches);
  const inBuilds = picked ? picked.filter((p) => buildPatches.includes(p)) : [live];
  const first = buildPatches[0];
  return (
    <div className="stat-range cp-tf-pick">
      <div className="cp-tf-controls" role="group" aria-label={t("Stats over")}>
        <details className="patch-pick" ref={patchRef} data-on={pick.kind === "patch" || undefined}>
          <summary onClick={() => setRef.current?.removeAttribute("open")}>
            {(pick === LIVE || pick === ONLY) && <span className="cp-tf-live" aria-hidden="true" />}
            {pick === LIVE ? tc("{patch}+", { patch: patchName(live) }) : pick === ONLY ? tc("{patch} only", { patch: patchName(live) }) : patchLabel}
            {(pick === LIVE || pick === ONLY) && <span className="cp-tf-live-word">{t("Live")}</span>}
          </summary>
          <div className="patch-pick-list">
            {sets.map(({ set, patches: list }) => (
              <div key={set.name} className="patch-pick-set" role="group" aria-label={tl(set.name)}>
                <span className="patch-pick-set-head">{tl(set.name)}</span>
                {[...list].reverse().map((p) => (
                  <label key={p}>
                    <input type="checkbox" checked={patchList.includes(p)} onChange={() => togglePatch(p)} />
                    {patchName(p)}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </details>
        <details className="patch-pick" ref={setRef} data-on={pick.kind === "set" || undefined}>
          <summary onClick={() => patchRef.current?.removeAttribute("open")}>{setLabel}</summary>
          <div className="patch-pick-list cp-tf-sets">
            {sets.map(({ set, patches: list }) => (
              <label key={set.name}>
                <input type="checkbox" checked={setList.includes(set.name)} onChange={() => toggleSet(set.name)} />
                {tl(set.name)}
                <small>
                  {patchName(list[0])}
                  {list.length > 1 && `–${patchName(list[list.length - 1])}`}
                </small>
              </label>
            ))}
          </div>
        </details>
        {(pick === LIVE || pick === ONLY) && (
          <div className="seg cp-tf-plus" role="group" aria-label={tc("Games counted")}>
            <button type="button" aria-pressed={pick === LIVE} data-tip={tc("Includes similar recent patches, weighted toward this one")} onClick={() => choose(LIVE, live)}>
              {tc("{patch}+", { patch: patchName(live) })}
            </button>
            <button type="button" aria-pressed={pick === ONLY} onClick={() => choose(ONLY, live)}>
              {tc("{patch} only", { patch: patchName(live) })}
            </button>
          </div>
        )}
        <button
          type="button"
          className="cp-tf-all"
          aria-pressed={pick.kind === "all"}
          onClick={() => choose(pick.kind === "all" ? LIVE : { kind: "all", list: [] }, live)}
        >
          {t("All time")}
        </button>
      </div>
      {picked && (
        <small className="stat-range-span">
          {picked.length > 1
            ? t("Patches {a} to {b}", { a: patchName(picked[0]), b: patchName(picked[picked.length - 1]) })
            : t("Patch {patch}", { patch: patchName(picked[0]) })}
          {" · "}
          {!inBuilds.length
            ? `${t("Builds are saved from patch {patch} on, so the card shows rates only.", { patch: patchName(first) })} `
            : inBuilds.length < picked.length
              ? `${t("Builds cover patch {patch} on.", { patch: patchName(inBuilds[0]) })} `
              : null}
          {t("The rest of the page shows the live patch.")}
        </small>
      )}
    </div>
  );
}

// ---- Views ----

const Loading = () => (
  <span className="cp-tf-loading" role="status">
    <T>Loading…</T>
  </span>
);

/** The tier chip in the header. */
export function TfTier({ alias, patches, matches, children, plus }: Common) {
  const s = useRangeStats(alias, patches, matches);
  const pick = usePick();
  if (!s.picked) return <>{pick === LIVE && plus !== undefined ? plus : children}</>;
  if (!s.ready || !s.me) return null;
  return (
    <span className={`cp-tier chip tier-${s.me.tier.toLowerCase()}`} title="Tier">
      {s.me.tier}
    </span>
  );
}

/** The header's win rate, pick rate, games and rank. */
export function TfStrip({ alias, patches, matches, children, plus }: Common) {
  const s = useRangeStats(alias, patches, matches);
  const pick = usePick();
  if (!s.picked) return <>{pick === LIVE && plus !== undefined ? plus : children}</>;
  if (!s.ready) return <div className="cp-strip">{<Loading />}</div>;
  if (!s.me)
    return (
      <div className="cp-strip">
        <p className="cp-empty-line">
          <T>Not played in these patches.</T>
        </p>
      </div>
    );
  const me = s.me;
  return (
    <div className="cp-strip">
      <Cell value={<WinRate p={me.win_rate} n={me.sample} />} label="Win rate" tone={me.win_rate >= 0.52 ? "up" : me.win_rate <= 0.48 ? "down" : undefined} />
      <Cell value={pct(me.pick_rate)} label="Pick rate" />
      {s.games ? <Cell value={`~${s.games.toLocaleString("en-US")}`} label="Games" /> : null}
      <div className="cp-cell">
        <b>#{s.rank}</b>
        <small>
          <T ns="champions" v={{ n: s.all!.length }}>
            {"of {n} by DeepScore"}
          </T>
        </small>
      </div>
    </div>
  );
}

/** The Performance tiles: each stat's rank among all champions over the picked patches. */
export function TfPerf({ alias, patches, matches, children }: Common) {
  const s = useRangeStats(alias, patches, matches);
  if (!s.picked) return <>{children}</>;
  if (!s.ready || !s.all) return <Loading />;
  const tiles = radarFor(alias, s.all);
  if (!tiles.length) return null;
  return (
    <div className="cp-perf">
      {tiles.map((a) => (
        <div key={a.key}>
          <small>
            <T ns="champions">{a.label}</T>
          </small>
          <b>{a.value.replace(/ dead$/, "")}</b>
          <span>
            #{a.rank}{" "}
            <T ns="champions" v={{ n: a.of }}>
              {"of {n}"}
            </T>
          </span>
        </div>
      ))}
    </div>
  );
}


/** The top card over the picked patches. `spells` and `skill`: the spells and skill order tiles, which don't change
 *  with the range. */
export function TfCard({ alias, patches, matches, spells, skill, children }: Common & { spells: ReactNode; skill: ReactNode }) {
  const s = useRangeStats(alias, patches, matches);
  const load = useMemo(() => () => loadHist(alias), [alias]);
  const hist = useLoaded<HistFile>(s.picked ? load : null);
  const card = useMemo(() => {
    if (!s.picked || !s.ready || !hist || hist === "error") return null;
    return cardFor(hist, s.picked, s.weight ?? {}, s.me?.win_rate ?? 0.5, s.me?.sample);
  }, [hist, s]);
  if (!s.picked) return <>{children}</>;
  if (!hist || !s.ready) return <section className="cp-game" aria-label="Build for your game">{spells}<div className="cp-best"><Loading /></div></section>;
  const info = hist === "error" ? {} : hist.items;
  return (
    <section className="cp-game" aria-label="Build for your game">
      {spells}
      {!card ? (
        <div className="cp-best cp-best-wide">
          <p className="cp-empty-line">
            <T>No saved builds for these patches.</T>
          </p>
        </div>
      ) : (
        <>
          {card.starting && (
            <div className="cp-best">
              <h4>
                <T ns="champions">Starter items</T>
              </h4>
              <div className="cp-icons">
                {card.starting.items.map((id, i) => (
                  <ItemIcon key={i} id={id} info={info} named />
                ))}
              </div>
              <div className="cp-mini">
                <RatedCells r={card.starting} />
              </div>
            </div>
          )}
          {card.augments.length > 0 && (
            <div className="cp-best cp-best-wide cp-best-augs">
              <h4>
                <T>Best augments</T>
              </h4>
              <span className="cp-icons">
                {card.augments.map((a) => (
                  <a key={a.id} href="#augments" title={a.name} className={`cp-named rarity-${a.rarity}`}>
                    <img className="cp-icon round" src={`/icons/augments/${a.id}.webp`} alt={a.name} width={40} height={40} />
                    <small aria-hidden="true">{a.name}</small>
                  </a>
                ))}
              </span>
            </div>
          )}
          {skill}
          {card.core && (
            <div className="cp-best cp-best-wide">
              <h4>
                <T ns="champions">{(card.core.full ?? []).length ? "Full build" : "Best core build"}</T>
              </h4>
              <div className="cp-icons">
                {/* a first-buy item (Hubris, Heartsteel...) leads and late buys (Void Staff...) wait, as in the apps' path (lib/engine/first-buys.ts) */}
                {cardBuyOrder([...buildOrder(card.core), ...(card.core.full ?? []).map((r) => r.items[0])], (i) => i === card.core!.boots).map((id) => (
                  <ItemIcon key={id} id={id} info={info} named />
                ))}
              </div>
              {!card.core.later?.length && (card.core.rest ?? []).length > 0 && (
                <p className="cp-rest">
                  <small>
                    <T ns="champions">Then</T>
                  </small>
                  {card.core.rest!.map((id) => (
                    <ItemIcon key={id} id={id} info={info} named />
                  ))}
                </p>
              )}
              <div className="cp-mini">
                <RatedCells r={card.core} />
              </div>
            </div>
          )}
          {(card.core?.later ?? []).length > 0 && (
            <LaterItems
              rows={card.core!.later!}
              slots={card.core!.slots}
              inBuild={card.core!.full}
              info={info}
              title={(card.core!.full ?? []).length ? "Items 4 to 6" : undefined}
            />
          )}
          {card.situational.length > 0 && (
            <div className="cp-best cp-best-wide cp-best-sit">
              <h4>
                <T ns="champions">Situational items</T>
              </h4>
              <ul className="cp-sit-rows">
                {card.situational.map((s) => {
                  const [best, ...alts] = s.options.slice(0, 3);
                  return (
                    <li key={s.situation}>
                      <span className="cp-sit-when">
                        <T ns="champions">{SITUATIONS[s.situation]}</T>
                      </span>
                      <span className="cp-sit-best">{best && <ItemIcon id={best.items[0]} info={info} named />}</span>
                      <span className="cp-sit-alt">
                        {alts.length > 0 && (
                          <>
                            <small>
                              <T ns="champions">or</T>
                            </small>
                            {alts.map((r) => (
                              <ItemIcon key={r.items[0]} id={r.items[0]} info={info} />
                            ))}
                          </>
                        )}
                      </span>
                      <small className="cp-sit-why" />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
