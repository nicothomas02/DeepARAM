"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buzz } from "@/lib/haptics";
import { useNames, useT } from "./I18n";

// Draft practice (/tier-list?tab=draft): ARAM champ select as the client runs it. You're dealt two champion cards, and a
// Blessing may add a third. Rerolling deals new cards and puts your old ones on the team's shared bench, where anyone can
// grab them; the four practice teammates reroll and grab from the bench too. Locking in shows how the pick and the team
// rank on the live patch. Real reroll counts come from your account, so practice uses a fixed number.

export type DraftChamp = {
  id: string;
  name: string;
  tier: string | null;
  winRate: number | null;
  deepScore: number | null;
  /** Riot's Tank class, or a Juggernaut: someone to stand in front. */
  front: boolean;
  /** Has a stun, root, knock-up or other hard CC; null when unknown. */
  hardCC: boolean | null;
};

const CARDS = 2;
const BLESSING = 0.25;
const REROLLS = 2;
const BENCH = 10;
const MATES = 4;
const icon = (id: string) => `/icons/champions/${id}.webp`;
const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(1)}%`);

type Mate = { id: string; rerolls: number; swapped: boolean };
type Hand = { cards: string[]; blessed: string | null };

export default function ChampSelectDraft({ champs }: { champs: DraftChamp[] }) {
  const t = useT("tier-list");
  const name = useNames();
  const byId = useMemo(() => new Map(champs.map((c) => [c.id, c])), [champs]);
  const score = useCallback((id: string) => byId.get(id)?.deepScore ?? 0, [byId]);
  const label = useCallback((id: string) => name("champions", id, byId.get(id)?.name ?? id), [byId, name]);

  // Champions nobody holds yet: dealt cards, the bench and teammates all come out of this pool.
  const pool = useRef<string[]>([]);
  const [hand, setHand] = useState<Hand>({ cards: [], blessed: null });
  const [mine, setMine] = useState<string | null>(null);
  const [bench, setBench] = useState<string[]>([]);
  const [mates, setMates] = useState<Mate[]>([]);
  const [rerolls, setRerolls] = useState(REROLLS);
  const [locked, setLocked] = useState(false);

  const take = useCallback((n: number) => pool.current.splice(0, n), []);
  const deal = useCallback((): Hand => {
    const cards = take(CARDS);
    const blessed = Math.random() < BLESSING ? (take(1)[0] ?? null) : null;
    return { cards, blessed };
  }, [take]);
  // The bench holds ten; the oldest falls back into the pool.
  const benchRef = useRef<string[]>([]);
  const toBench = useCallback((ids: string[]) => {
    const next = [...benchRef.current, ...ids];
    pool.current.push(...next.slice(0, Math.max(0, next.length - BENCH)));
    setBench(next.slice(-BENCH));
  }, []);

  const start = useCallback(() => {
    const ids = champs.map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    pool.current = ids;
    setMates(take(MATES).map((id) => ({ id, rerolls: 1, swapped: false })));
    setHand(deal());
    setMine(null);
    setBench([]);
    setRerolls(REROLLS);
    setLocked(false);
  }, [champs, deal, take]);

  useEffect(() => {
    if (champs.length) start();
  }, [champs.length, start]);

  // Teammates think it over: a weak champion gets rerolled, a much better one on the bench gets grabbed.
  benchRef.current = bench;
  useEffect(() => {
    if (locked || !mates.length) return;
    const timer = setTimeout(
      () => {
        const i = Math.floor(Math.random() * mates.length);
        const m = mates[i];
        const best = [...benchRef.current].sort((a, b) => score(b) - score(a))[0];
        if (!m.swapped && best && score(best) > score(m.id) + 8) {
          setBench((b) => [...b.filter((id) => id !== best), m.id]);
          setMates((ms) => ms.map((x, j) => (j === i ? { id: best, rerolls: x.rerolls, swapped: true } : x)));
        } else if (m.rerolls && ["C", "D"].includes(byId.get(m.id)?.tier ?? "")) {
          const [next] = take(1);
          if (!next) return;
          toBench([m.id]);
          setMates((ms) => ms.map((x, j) => (j === i ? { ...x, id: next, rerolls: x.rerolls - 1 } : x)));
        }
      },
      2500 + Math.random() * 3000,
    );
    return () => clearTimeout(timer);
  }, [locked, mates, bench, byId, score, take, toBench]);

  const cards = [...hand.cards, ...(hand.blessed ? [hand.blessed] : [])];
  const fromBench = mine !== null && !cards.includes(mine);

  const reroll = () => {
    if (!rerolls || locked) return;
    buzz("step");
    // Your cards go to the bench (a champion you took from the bench goes back too), and you get new ones.
    toBench(fromBench && mine ? [...cards, mine] : cards);
    setHand(deal());
    setMine(null);
    setRerolls((r) => r - 1);
  };
  const grab = (id: string) => {
    if (locked) return;
    buzz("tap");
    setBench((b) => [...b.filter((x) => x !== id), ...(fromBench && mine ? [mine] : [])]);
    setMine(id);
  };
  const pick = (id: string) => {
    if (locked) return;
    buzz("tap");
    if (fromBench && mine) setBench((b) => [...b, mine]);
    setMine(id);
  };
  const lock = () => {
    if (!mine) return;
    buzz("done");
    setLocked(true);
  };

  if (!champs.length) return null;

  const team = mine ? [mine, ...mates.map((m) => m.id)] : mates.map((m) => m.id);
  const available = [...new Set([...cards, ...bench, ...(mine ? [mine] : [])])];
  const bestOption = [...available].sort((a, b) => score(b) - score(a))[0];
  const teamChamps = team.map((id) => byId.get(id)).filter((c): c is DraftChamp => !!c);
  const known = teamChamps.filter((c) => c.winRate !== null);
  const avg = known.length ? known.reduce((s, c) => s + (c.winRate ?? 0), 0) / known.length : null;
  const noFront = !teamChamps.some((c) => c.front);
  const ccKnown = teamChamps.every((c) => c.hardCC !== null);
  const noCC = ccKnown && !teamChamps.some((c) => c.hardCC);

  const Tier = ({ id }: { id: string }) => {
    const tier = byId.get(id)?.tier;
    return tier ? <span className={`chip tier-${tier.toLowerCase()}`}>{tier}</span> : null;
  };

  return (
    <div className="cs-draft">
      <div className="cs-head">
        <h3>{t("PICK YOUR CHAMPION")}</h3>
        <span className="cs-rerolls" title={t("Re-rolled champions show up here. Click one to switch your selection.")}>
          {rerolls === 0
            ? t("You have no champion rerolls available.")
            : rerolls === 1
              ? t("You have 1 champion reroll available.")
              : t("You have {n} champion rerolls available.", { n: rerolls })}
        </span>
      </div>

      <div className="cs-cards">
        {cards.map((id) => (
          <button
            key={id}
            type="button"
            className="cs-card"
            data-picked={mine === id || undefined}
            data-blessed={id === hand.blessed || undefined}
            onClick={() => pick(id)}
            disabled={locked}
          >
            {id === hand.blessed && <span className="cs-blessing">{t("Blessing")}</span>}
            <img src={icon(id)} alt="" width={72} height={72} />
            <strong>{label(id)}</strong>
            {!locked ? null : <Tier id={id} />}
          </button>
        ))}
        {fromBench && mine && (
          <div className="cs-card" data-picked>
            <span className="cs-blessing">{t("From the bench")}</span>
            <img src={icon(mine)} alt="" width={72} height={72} />
            <strong>{label(mine)}</strong>
            {locked && <Tier id={mine} />}
          </div>
        )}
      </div>
      {hand.blessed && !locked && <p className="patch-note">{t("You pulled an extra champion!")}</p>}

      <div className="cs-actions">
        <button type="button" className="btn ghost" onClick={reroll} disabled={!rerolls || locked}>
          {t("Reroll")}
        </button>
        {locked ? (
          <button type="button" className="btn" onClick={start}>
            {t("Play again")}
          </button>
        ) : (
          <button type="button" className="btn" onClick={lock} disabled={!mine}>
            {t("Lock In")}
          </button>
        )}
      </div>

      <section className="cs-bench" aria-label={t("Available Champions")}>
        <h4 title={t("Re-rolled champions show up here. Click one to switch your selection.")}>{t("Available Champions")}</h4>
        {bench.length ? (
          <div className="cs-bench-row">
            {bench.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => grab(id)}
                disabled={locked}
                title={t("Click to switch your selection to {name}.", { name: label(id) })}
              >
                <img src={icon(id)} alt={label(id)} width={44} height={44} />
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">{t("Re-rolled champions show up here. Click one to switch your selection.")}</p>
        )}
      </section>

      <section className="cs-team" aria-label={t("Your team")}>
        <h4>{t("Your team")}</h4>
        <ol>
          {[mine, ...mates.map((m) => m.id)].map((id, i) => (
            <li key={i} data-you={i === 0 || undefined}>
              {id ? <img src={icon(id)} alt="" width={36} height={36} /> : <span className="cs-empty" />}
              <span>{id ? label(id) : t("Choosing…")}</span>
              {locked && id && <Tier id={id} />}
              {locked && id && <span className="muted num">{pct(byId.get(id)?.winRate ?? null)}</span>}
            </li>
          ))}
        </ol>
      </section>

      {locked && mine && (
        <section className="cs-result" aria-live="polite">
          <p>
            {t("Your team's average live win rate is {wr}.", { wr: pct(avg) })}{" "}
            {bestOption && bestOption !== mine && score(bestOption) > score(mine)
              ? t("The strongest champion you could have locked in was {name}.", { name: label(bestOption) })
              : t("You locked in the strongest champion you could reach.")}
          </p>
          {(noFront || noCC) && (
            <ul className="cs-warn">
              {noFront && <li>{t("No frontline: nobody on your team is a tank or juggernaut.")}</li>}
              {noCC && <li>{t("No hard CC: nobody can stun, root or knock up.")}</li>}
            </ul>
          )}
          <Link href={`/champions/${mine}`}>{t("How to play {name}", { name: label(mine) })}</Link>
        </section>
      )}
    </div>
  );
}
