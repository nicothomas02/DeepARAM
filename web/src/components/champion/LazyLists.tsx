"use client";

import { useEffect, useRef, useState } from "react";
import { Name, T } from "@/components/I18n";
import RowLink from "@/components/RowLink";
import WinRate, { Sampled } from "@/components/WinRate";
import DeepScore from "@/components/DeepScore";
import FewPlayers from "@/components/champion/FewPlayers";
import { Cell, ItemIcon, ItemName, pct, Row, signed, tone } from "@/components/champion/Ranked";
import type { ChampionLists } from "@/lib/champion-lists";
import type { ItemTier } from "@/lib/items";

// The champion page's longest lists, fetched from /data/champion-lists/<Alias> only when a visitor opens them
// (lib/champion-lists.ts): the teammates past the first rows ("Show all") and the "All items" fold. Until the
// numbers arrive a short "Loading…" line holds the place; a failed load offers a retry.

const NS = "champions";
const cache = new Map<string, Promise<ChampionLists>>();
const load = (alias: string) => {
  let p = cache.get(alias);
  if (!p) {
    p = fetch(`/data/champion-lists/${alias}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    p.catch(() => cache.delete(alias));
    cache.set(alias, p);
  }
  return p;
};

function useLists(alias: string, go: boolean) {
  const [data, setData] = useState<ChampionLists | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!go || data) return;
    let live = true;
    load(alias).then(
      (d) => live && setData(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [alias, go, data, tries]);
  const retry = () => {
    setFailed(false);
    setTries((n) => n + 1);
  };
  return { data, failed, retry };
}

function Waiting({ failed, retry }: { failed: boolean; retry: () => void }) {
  if (failed)
    return (
      <p className="cp-lazy" role="status">
        <T ns={NS}>{"Couldn't load this list."}</T>{" "}
        <button type="button" className="cp-lazy-retry" onClick={retry}>
          <T ns="tables">Try again</T>
        </button>
      </p>
    );
  return (
    <p className="cp-lazy" role="status" aria-busy="true">
      <T ns="common">Loading…</T>
    </p>
  );
}

/** Teammate rows past the first `start`, mounted when "Show all" opens the list. */
export function LazyMates({ alias, start }: { alias: string; start: number }) {
  const { data, failed, retry } = useLists(alias, true);
  if (!data) return <Waiting failed={failed} retry={retry} />;
  return (
    <>
      {data.mates.map((m, i) => (
        <Row
          key={m.id}
          rank={start + i + 1}
          cells={
            <>
              <Cell value={<Sampled n={m.games}>{signed(m.synergy)}</Sampled>} label="Win rate boost" tone={tone(m.synergy)} />
              <Cell value={pct(m.pickRate)} label="Pick rate" />
            </>
          }
        >
          <RowLink className="cp-link" href={`/champions/${m.id}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- small local icons */}
            <img className="cp-icon" src={`/icons/champions/${m.id}.webp`} alt="" width={36} height={36} loading="lazy" />
            <span className="cp-name">
              <Name kind="champions" id={m.id}>
                {m.name}
              </Name>
            </span>
            {/* Neither champion has hard crowd control (lib/cc.ts). */}
            {m.noCC && (
              <span className="cp-pill cp-tag">
                <T ns={NS}>No hard CC</T>
              </span>
            )}
          </RowLink>
        </Row>
      ))}
    </>
  );
}

const TIER_LABEL: Record<ItemTier, string> = {
  legendary: "Legendary",
  boots: "Boots",
  epic: "Epic",
  basic: "Basic",
  starter: "Starter",
  consumable: "Consumables",
  reward: "From augments",
};

/** The "All items" tiles, fetched once the panel comes near the screen (an open fold, or Detailed view). */
export function LazyItems({ alias, help, earlierHelp }: { alias: string; help: string; earlierHelp: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    // A closed fold hides the panel (display: none), so it never intersects until opened.
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const { data, failed, retry } = useLists(alias, near);
  return (
    <div ref={box}>
      {!data ? (
        <Waiting failed={failed} retry={retry} />
      ) : (
        data.items.map(({ tier, rows, older }) => (
          <section key={tier} className="cp-itier" aria-label={TIER_LABEL[tier]}>
            <h4 className="cp-itier-h">
              <T ns={NS}>{TIER_LABEL[tier]}</T> <span>{rows.length + older.length}</span>
            </h4>
            <div className="cp-strip-x" role="list">
              {rows.map((r) => (
                <div key={r.id} className="cp-tile" role="listitem">
                  <ItemIcon id={r.id} info={data.info} />
                  <ItemName id={r.id} info={data.info} />
                  {r.few && <FewPlayers augment={r.few.augment} build={r.few.build} situation={r.few.situation} />}
                  {r.deepScore !== undefined && <DeepScore value={r.deepScore} edge={r.deepEdge} help={help} />}
                  <Cell value={signed(r.lift)} label="Win rate boost" tone={tone(r.lift)} />
                  <Cell value={<WinRate p={r.winRate} n={r.games} />} label="Win rate" />
                  <Cell value={pct(r.pickRate)} label="Pick rate" />
                </div>
              ))}
              {/* Built last patch, not enough games yet on this one: no DeepScore, tagged with its patch. */}
              {older.map((r) => (
                <div key={`earlier-${r.id}`} className="cp-tile" role="listitem">
                  <ItemIcon id={r.id} info={data.info} />
                  <ItemName id={r.id} info={data.info} />
                  <small className="cp-stale-tag" title={earlierHelp}>
                    <T ns={NS} v={{ patch: data.earlierPatch }}>
                      {"Patch {patch}"}
                    </T>
                  </small>
                  <Cell value={<WinRate p={r.winRate} n={r.games} />} label="Win rate" />
                  <Cell value={pct(r.pickRate)} label="Pick rate" />
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
