"use client";

import { useEffect, useMemo, useState } from "react";
import { buzz } from "@/lib/haptics";
import { useNames, useT } from "./I18n";
import ShareButton from "./ShareButton";

// The Clash page's team planner. A team enters the five champions it rolled and the ones on the bench;
// the planner reads the team from each champion's official class and 1-10 ratings (attack, magic,
// defense, difficulty) and attack range: damage split, frontline, range, and the bench swap that
// balances it best. Bans are a list to agree on. Everything lives in the address (#t=..&b=..&x=..),
// so the Share button hands the whole plan to teammates. No stats, no lookups.

export type ClashChampion = {
  id: string;
  name: string;
  tags: string[];
  attack: number;
  defense: number;
  magic: number;
  difficulty: number;
  range: number;
  hp: number;
  armor: number;
  mr: number;
};

const TEAM = 5;
const BENCH = 10;
const BANS = 5;

type Slots = (string | null)[];
type Plan = { team: Slots; bench: Slots; bans: Slots };
type Field = keyof Plan;

const empty = (n: number): Slots => Array.from({ length: n }, () => null);
const blank = (): Plan => ({ team: empty(TEAM), bench: empty(BENCH), bans: empty(BANS) });

const isFront = (c: ClashChampion) => c.tags.includes("Tank") || c.defense >= 7 || (c.tags[0] === "Fighter" && c.defense >= 5);
const isRanged = (c: ClashChampion) => c.range >= 300;

type Read = { physical: number; front: number; ranged: number; defense: number; difficulty: number; score: number; classes: [string, number][] };

function read(team: ClashChampion[]): Read {
  const atk = team.reduce((s, c) => s + c.attack, 0);
  const mag = team.reduce((s, c) => s + c.magic, 0);
  const physical = atk + mag ? atk / (atk + mag) : 0.5;
  const front = team.filter(isFront).length;
  const ranged = team.filter(isRanged).length;
  const avg = (k: "defense" | "difficulty") => (team.length ? team.reduce((s, c) => s + c[k], 0) / team.length : 0);
  const counts = new Map<string, number>();
  for (const c of team) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  // Higher is better: an even damage split, at least two frontliners and at least two ranged champions.
  let score = -Math.abs(physical - 0.5) * 4;
  score -= front === 0 ? 2 : front === 1 ? 0.5 : 0;
  score -= ranged === 0 ? 1.5 : ranged === 1 ? 0.5 : 0;
  return { physical, front, ranged, defense: avg("defense"), difficulty: avg("difficulty"), score, classes: [...counts].sort((a, b) => b[1] - a[1]) };
}

function parse(hash: string, known: Set<string>): Plan {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const list = (k: string, n: number): Slots => {
    const ids = (p.get(k) ?? "").split(",").map((s) => (known.has(s) ? s : null));
    return Array.from({ length: n }, (_, i) => ids[i] ?? null);
  };
  return { team: list("t", TEAM), bench: list("b", BENCH), bans: list("x", BANS) };
}

const encode = (plan: Plan) => {
  const part = (k: string, s: Slots) => (s.some(Boolean) ? `${k}=${s.map((x) => x ?? "").join(",").replace(/,+$/, "")}` : "");
  return [part("t", plan.team), part("b", plan.bench), part("x", plan.bans)].filter(Boolean).join("&");
};

export default function ClashPlanner({ champions }: { champions: ClashChampion[] }) {
  const t = useT("clash");
  const name = useNames();
  const byId = useMemo(() => new Map(champions.map((c) => [c.id, c])), [champions]);
  const [plan, setPlan] = useState<Plan>(blank);
  const [open, setOpen] = useState<{ field: Field; i: number } | null>(null);
  const [query, setQuery] = useState("");

  // The plan comes from the address after hydration, so the first render matches the server's.
  useEffect(() => {
    setPlan(parse(location.hash, new Set(byId.keys())));
  }, [byId]);
  useEffect(() => {
    const h = encode(plan);
    history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
  }, [plan]);

  const used = new Set([...plan.team, ...plan.bench, ...plan.bans].filter(Boolean) as string[]);
  const champ = (id: string | null) => (id ? byId.get(id) : undefined);
  const team = plan.team.map(champ).filter(Boolean) as ClashChampion[];
  const bench = plan.bench.map(champ).filter(Boolean) as ClashChampion[];
  const r = read(team);

  const set = (field: Field, i: number, id: string | null) => {
    setPlan((p) => ({ ...p, [field]: p[field].map((x, j) => (j === i ? id : x)) }));
    buzz("step");
  };

  // The one team-for-bench swap that raises the score most.
  let swap: { out: ClashChampion; in: ClashChampion; gain: number } | null = null;
  if (team.length === TEAM) {
    for (const out of team)
      for (const b of bench) {
        const gain = read(team.map((c) => (c === out ? b : c))).score - r.score;
        if (gain > 0.25 && (!swap || gain > swap.gain)) swap = { out, in: b, gain };
      }
  }

  const tips: string[] = [];
  if (team.length) {
    if (r.physical >= 0.7) tips.push(t("Mostly physical damage. One armor item on their side cuts most of your damage."));
    if (r.physical <= 0.3) tips.push(t("Mostly magic damage. One magic resist item on their side cuts most of your damage."));
    if (r.front === 0) tips.push(t("No frontline. Nobody can stand in front for your team in a long fight."));
    if (team.length >= 3 && r.ranged <= 1) tips.push(t("Few ranged champions. Poke and trades before a fight will be hard."));
    if (r.ranged === team.length && team.length >= 4) tips.push(t("All ranged. Engage and peel will be thin if they dive you."));
    if (r.difficulty >= 7) tips.push(t("Hard team to play. Several champions here take practice."));
  }

  const q = query.trim().toLowerCase();
  const choices = champions.filter((c) => !q || c.name.toLowerCase().includes(q) || name("champions", c.id, c.name).toLowerCase().includes(q));

  const slot = (field: Field, i: number, label: string) => {
    const c = champ(plan[field][i]);
    const active = open?.field === field && open.i === i;
    return (
      <li key={`${field}${i}`} className="clash-slot" data-on={c ? "" : undefined} data-active={active ? "" : undefined}>
        <button type="button" onClick={() => (setOpen(active ? null : { field, i }), setQuery(""))} aria-label={c ? name("champions", c.id, c.name) : label}>
          {c ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/icons/champions/${c.id}.webp`} alt="" width={56} height={56} />
          ) : (
            <span className="clash-plus" aria-hidden="true">+</span>
          )}
          <span className="clash-slot-name">{c ? name("champions", c.id, c.name) : label}</span>
        </button>
        {c && (
          <button type="button" className="clash-clear" onClick={() => set(field, i, null)} aria-label={t("Remove")}>
            ×
          </button>
        )}
      </li>
    );
  };

  const picker = (field: Field) =>
    open?.field === field && (
      <div className="clash-picker">
        <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search champions")} aria-label={t("Search champions")} />
        <ul>
          {choices.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={used.has(c.id) && plan[field][open.i] !== c.id}
                onClick={() => {
                  set(field, open.i, c.id);
                  // Move on to the next empty slot of the same row, or close the picker when the row is full.
                  const next = plan[field].findIndex((x, j) => !x && j !== open.i);
                  setOpen(next >= 0 ? { field, i: next } : null);
                  setQuery("");
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/icons/champions/${c.id}.webp`} alt="" width={40} height={40} loading="lazy" />
                <span>{name("champions", c.id, c.name)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  const bar = (label: string, value: number, max: number, note: string) => (
    <div className="clash-meter">
      <div className="clash-meter-head">
        <span>{label}</span>
        <b>{note}</b>
      </div>
      <div className="clash-meter-track">
        <i style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
    </div>
  );

  return (
    <div className="clash-planner">
      <section className="card clash-team">
        <div className="card-head">
          <h2>{t("Your team")}</h2>
          <div className="clash-actions">
            {used.size > 0 && (
              <button type="button" className="clash-reset" onClick={() => (setPlan(blank()), setOpen(null))}>
                {t("Clear")}
              </button>
            )}
            <ShareButton label={t("Share plan")} title={t("Our ARAM Clash plan")} />
          </div>
        </div>
        <ul className="clash-slots">{plan.team.map((_, i) => slot("team", i, t("Player {n}", { n: i + 1 })))}</ul>
        {picker("team")}
        <h3 className="clash-sub">{t("Bench")}</h3>
        <p className="clash-hint">{t("Champions you could swap in from the bench or a reroll.")}</p>
        <ul className="clash-slots clash-small">{plan.bench.map((_, i) => slot("bench", i, t("Bench")))}</ul>
        {picker("bench")}
      </section>

      <section className="card clash-read" aria-live="polite">
        <div className="card-head">
          <h2>{t("Team read")}</h2>
          <span className="clash-count">{t("{n} of 5 picked", { n: team.length })}</span>
        </div>
        {team.length === 0 ? (
          <p className="clash-hint">{t("Add your champions to see the team's damage split, frontline and range.")}</p>
        ) : (
          <>
            <div className="clash-split" role="img" aria-label={t("{p}% physical, {m}% magic", { p: Math.round(r.physical * 100), m: Math.round((1 - r.physical) * 100) })}>
              <div className="clash-meter-head">
                <span>{t("Physical {p}%", { p: Math.round(r.physical * 100) })}</span>
                <span>{t("Magic {m}%", { m: Math.round((1 - r.physical) * 100) })}</span>
              </div>
              <div className="clash-split-track">
                <i className="phys" style={{ width: `${r.physical * 100}%` }} />
                <i className="mag" />
              </div>
            </div>
            {bar(t("Frontline"), r.front, TEAM, t("{n} of {of}", { n: r.front, of: team.length }))}
            {bar(t("Ranged"), r.ranged, TEAM, t("{n} of {of}", { n: r.ranged, of: team.length }))}
            {bar(t("Toughness"), r.defense, 10, `${r.defense.toFixed(1)} / 10`)}
            {bar(t("Difficulty"), r.difficulty, 10, `${r.difficulty.toFixed(1)} / 10`)}
            <ul className="clash-classes">
              {r.classes.map(([c, n]) => (
                <li key={c}>
                  {t(c)} <b>{n}</b>
                </li>
              ))}
            </ul>
            <ul className="clash-tips">
              {tips.length ? tips.map((x) => <li key={x}>{x}</li>) : <li data-good="">{t("Balanced team: mixed damage, a frontline and range.")}</li>}
            </ul>
            {swap && (
              <p className="clash-swap">
                {t("Best bench swap: {in} for {out}.", { in: name("champions", swap.in.id, swap.in.name), out: name("champions", swap.out.id, swap.out.name) })}
              </p>
            )}
            <table className="clash-detail">
              <thead>
                <tr>
                  <th>{t("Champion")}</th>
                  <th>{t("Range")}</th>
                  <th>{t("Health at 18")}</th>
                  <th>{t("Armor at 18")}</th>
                  <th>{t("Magic resist at 18")}</th>
                </tr>
              </thead>
              <tbody>
                {team.map((c) => (
                  <tr key={c.id}>
                    <td>{name("champions", c.id, c.name)}</td>
                    <td>{c.range}</td>
                    <td>{c.hp.toLocaleString()}</td>
                    <td>{c.armor}</td>
                    <td>{c.mr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card clash-bans">
        <div className="card-head">
          <h2>{t("Bans")}</h2>
        </div>
        <p className="clash-hint">{t("Agree on your bans before the lobby opens.")}</p>
        <ul className="clash-slots clash-small">{plan.bans.map((_, i) => slot("bans", i, t("Ban {n}", { n: i + 1 })))}</ul>
        {picker("bans")}
      </section>
    </div>
  );
}
