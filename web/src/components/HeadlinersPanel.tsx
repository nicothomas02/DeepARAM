"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import Link from "next/link";
import { useState } from "react";
import DataTable, { type Column } from "./DataTable";
import { useNames, useT } from "./I18n";
import type { HeadlinerChamp, HeadlinersData } from "@/lib/headliners";

// The Tier List's Headliners tab (Set 3): one view per Headliner and one for the band missions.
// Pentakill is simulated per champion; the others rank the champions each Headliner's rule suits.

const NS = "headliners";
const champIcon = (id: string) => `/icons/champions/${id}.webp`;

// Headliner id, shown name, what it does, how champions are ranked for it, and how the number reads.
const HEADLINERS: { id: string; name: string; effect: string; how: string; unit: string; scale?: number; digits?: number }[] = [
  {
    id: "Pentakill",
    name: "Pentakill",
    effect:
      "Empower one basic ability at the start: 20 Ability Haste and 10% more damage, healing and shielding on it. At level 18, Empower another one, your ultimate included.",
    how: "Simulated with each champion's most popular build. The start pick is the basic ability with the most extra damage at level 8 and level 18 together; the level 18 pick is tried on top of it.",
    unit: "+{v}% damage",
    digits: 1,
  },
  {
    id: "KDA",
    name: "K/DA",
    effect: "Collect 4 K/DA Cards to earn an extra augment.",
    how: "Champions whose best augments raise their win rate the most, so one more augment is worth the most. The augment shown is their best one.",
    unit: "+{v} pts",
    scale: 100,
    digits: 1,
  },
  {
    id: "Heartsteel",
    name: "HEARTSTEEL",
    effect: "Augments can come with modifiers that make them stronger.",
    how: "Champions whose win rate swings the most between their augments, so stronger augments matter most.",
    unit: "{v} pts swing",
    scale: 100,
    digits: 1,
  },
  {
    id: "CommandLine",
    name: "Command Line",
    effect: "In every augment pick, reroll one augment into a higher tier.",
    how: "Champions whose Prismatic augments win the most more than their Silver ones, so tier upgrades pay off most.",
    unit: "+{v} pts Prismatic over Silver",
    scale: 100,
    digits: 1,
  },
  {
    id: "TrueDamage",
    name: "True Damage",
    effect: "Multi-kills, shutdowns and destroying towers make minions drop Anvils for your team.",
    how: "Champions with the most multi-kills and tower damage a game, so they earn the most Anvils.",
    unit: "{v} multi-kills a game",
    digits: 1,
  },
  {
    id: "Disco",
    name: "Disco",
    effect: "Dance on the Dance Floor until the Disco Ball drops, giving everyone 1,000 gold.",
    how: "Champions who finish their third core item latest, so a free 1,000 gold moves their build forward the most.",
    unit: "3rd item at {v} min",
    digits: 1,
  },
  {
    id: "CafeCuties",
    name: "Cafe Cuties",
    effect: "Health relics also restore 20% missing Health and give 25% Move Speed that fades over 6 seconds.",
    how: "Champions who take the most damage and heal themselves the least, so relics restore the most for them.",
    unit: "{v} damage taken/min",
    digits: 0,
  },
  {
    id: "Bees",
    name: "Bees",
    effect: "Honey and Bees fly across the map. Honey gives your team 25 gold and heals you for 20% max Health; a Bee hit deals 15% max Health as true damage.",
    how: "Champions with the most dashes and blinks to grab Honey and dodge Bees, then the ones who take the most damage.",
    unit: "{v} dashes",
    digits: 0,
  },
];

// How each mission's champion number reads (per game, estimated).
const MISSION_UNIT: Record<string, string> = {
  takedowns: "{v} takedowns",
  skillshots: "{v} skillshots landed",
  snipe: "{v} long-range hits",
  dash_takedowns: "{v} takedowns after a dash",
  self_heal: "{v} self-healing",
  bonus_health: "{v} bonus Health",
  cc: "{v}s of crowd control",
  bonus_ad_ap: "{v} bonus AD or AP",
  bonus_as: "{v}% bonus attack speed",
  ult_damage: "{v} ultimate damage",
  multi_hit: "{v} multi-champion hits",
};

const EMPOWER: Record<string, string> = { Q: "HEAVY", W: "POWER", E: "THRASH", R: "DOOM" };

function fmt(v: number, scale = 1, digits = 0) {
  return (v * scale).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function Ranked({ champs, unit, scale, digits, short }: { champs: HeadlinerChamp[]; unit: string; scale?: number; digits?: number; short?: boolean }) {
  const t = useT(NS);
  const names = useNames();
  return (
    <div className={short ? "rank fun-rank short" : "rank fun-rank"}>
      {champs.map((c, i) => (
        <Link key={c.id} href={`/champions/${c.id}`}>
          <span className="rank-i">{i + 1}</span>
          <img className="icon" src={champIcon(c.id)} alt="" width={24} height={24} loading="lazy" />
          <span className="rank-name">
            {names("champions", c.id, c.name)}
            {c.augment && <span className="headliner-aug"> · {names("augments", c.augment.id, c.augment.name)}</span>}
          </span>
          <span className="rank-v">{t(unit, { v: fmt(c.value, scale, digits) })}</span>
        </Link>
      ))}
    </div>
  );
}

function Pentakill({ rows }: { rows: HeadlinersData["pentakill"] }) {
  const t = useT(NS);
  const slot = (s: string) => `${s} · ${EMPOWER[s]}`;
  const columns: Column[] = [
    { key: "id", label: "Champion", format: "champion" },
    { key: "start", label: "Start pick", format: "text", hint: "The basic ability to Empower at the start." },
    { key: "level18", label: "Level 18 pick", format: "text", hint: "The ability to Empower at level 18, on top of the start pick." },
    { key: "gain", label: "Damage gain", format: "pct", hint: "Simulated extra damage from both Empowers at level 18." },
    { key: "q", label: "Q", format: "pct", phone: "hide", hint: "Simulated extra damage from Empowering Q at the start (level 8 and 18 averaged)." },
    { key: "w", label: "W", format: "pct", phone: "hide", hint: "Simulated extra damage from Empowering W at the start (level 8 and 18 averaged)." },
    { key: "e", label: "E", format: "pct", phone: "hide", hint: "Simulated extra damage from Empowering E at the start (level 8 and 18 averaged)." },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows.map((r) => ({
          id: r.id,
          start: slot(r.start),
          level18: slot(r.level18),
          gain: r.gain,
          q: r.q,
          w: r.w,
          e: r.e,
        }))}
        initialSort={{ key: "gain", desc: true }}
        searchKey="id"
        searchLabel="Find a champion"
        urlTab="headliners"
      />
      {rows.some((r) => r.by === "healing") && (
        <p className="fun-note">{t("For champions whose abilities barely change their damage, the pick is the one that heals or shields the most.")}</p>
      )}
    </>
  );
}

export default function HeadlinersPanel({ data }: { data: HeadlinersData }) {
  const t = useT(NS);
  const views = [...HEADLINERS.filter((h) => data.headliners.some((d) => d.id === h.id)), { id: "missions", name: "Missions" }];
  const [view, setView] = useState(views[0]?.id ?? "missions");
  const info = HEADLINERS.find((h) => h.id === view);
  const ranked = data.headliners.find((h) => h.id === view);
  return (
    <div className="headliners">
      <p className="patch-note subtab-note">
        {t("Every Mayhem game has one Headliner. Pick one to see the champions it suits best. All numbers are estimates.")}
      </p>
      <div className="seg fun-kinds" role="group" aria-label={t("Headliner")}>
        {views.map((v) => (
          <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}>
            {v.id === "missions" ? t("Missions") : v.name}
          </button>
        ))}
      </div>
      {info && ranked && (
        <section className="card headliner-card">
          <h3>{info.name}</h3>
          <p>{t(info.effect)}</p>
          <p className="fun-note">{t(info.how)}</p>
          {view === "Pentakill" ? (
            <Pentakill rows={data.pentakill} />
          ) : (
            <Ranked champs={ranked.champions} unit={info.unit} scale={info.scale} digits={info.digits} />
          )}
        </section>
      )}
      {view === "missions" && (
        <>
          <p className="fun-note">
            {t("Band missions have to be finished in one game. Each list shows the champions likely to get the furthest in a typical game.")}
          </p>
          {data.missions.map((b) => (
            <section key={b.band} className="card headliner-card">
              <h3>
                {b.band}
                {b.fame > 0 && <span className="headliner-fame"> · {t("unlocks at {n} Fame", { n: b.fame.toLocaleString("en-US") })}</span>}
              </h3>
              {b.missions.map((m) => (
                <div key={m.title} className="headliner-mission">
                  <h4>{t(m.title)}</h4>
                  <p className="fun-note">
                    {t(m.description)}
                    {m.steps.length > 0 && <> · {t("Next: {steps}", { steps: m.steps.map((s) => t(s)).join(" → ") })}</>}
                  </p>
                  {m.tip ? (
                    <p>{t(m.tip)}</p>
                  ) : (
                    <Ranked champs={m.champions.slice(0, 6)} unit={MISSION_UNIT[m.metric ?? ""] ?? "{v}"} digits={0} short />
                  )}
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
