/* eslint-disable @next/next/no-img-element -- small local icons */
import { T } from "@/components/I18n";
import type { BaseStats, Change } from "@/lib/champion-page";
import ChangeName from "./ChangeName";
import { Panel } from "./Ranked";

// The bottom of a champion page: every ability number Mayhem changes, mode-wide adjustments, and base stats.

const NS = "champions";
const num = (v: number, d = 2) => Number(v.toFixed(d)).toLocaleString("en-US");
const wordList = (n: string) =>
  n
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/);
// Ratios and percentages are stored as fractions (0.6 = 60%). Whole words only: "Duration" contains "ratio".
const PCT_WORDS = new Set([
  "ratio",
  "percent",
  "pct",
  "amp",
  "mod",
  "multiplier",
]);
const isPct = (name: string, vals: number[]) =>
  wordList(name).some((w) => PCT_WORDS.has(w)) &&
  vals.every((v) => Math.abs(v) <= 5);
function values(name: string, vals: number[]) {
  const f = (v: number) =>
    isPct(name, vals) ? `${num(v * 100, Math.abs(v) < 0.01 ? 3 : 1)}%` : num(v);
  const uniq = [...new Set(vals)];
  return uniq.length === 1 ? f(uniq[0]) : vals.map(f).join(" / ");
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

const MODS: Record<string, string> = {
  damage_dealt: "Damage dealt",
  damage_taken: "Damage taken",
  healing: "Healing done",
  shielding: "Shielding done",
  tenacity: "Tenacity",
  ability_haste: "Ability haste",
  attack_speed: "Total attack speed",
  energy_regen: "Energy regen",
};

export function MayhemChanges({
  name,
  changes,
  modifiers,
}: {
  name: string;
  changes: Change[];
  modifiers: Record<string, number>;
}) {
  const mods = Object.entries(modifiers);
  return (
    <Panel
      id="changes"
      title="Mayhem changes"
      count={changes.length || undefined}
    >
      {mods.length > 0 && (
        <div className="cp-mods">
          {mods.map(([k, v]) => {
            // Taking more damage is bad for the champion; everything else helps when it goes up.
            const good = k === "damage_taken" ? v < 0 : v > 0;
            return (
              <span key={k} className={good ? "up" : "down"}>
                <T ns={NS}>{MODS[k] ?? k}</T> {v > 0 ? "+" : ""}
                {k === "ability_haste" ? num(v) : `${num(v * 100)}%`}
              </span>
            );
          })}
        </div>
      )}
      {changes.length > 0 ? (
        <div className="cp-scroll">
          <table className="cp-table">
            <thead>
              <tr>
                <th>
                  <T ns={NS}>Ability</T>
                </th>
                <th>
                  <T ns={NS}>Value</T>
                </th>
                <th className="num">
                  <T ns={NS}>Rift</T>
                </th>
                <th className="num">
                  <T ns={NS}>Mayhem</T>
                </th>
              </tr>
            </thead>
            <tbody>
              {changes.map((m, i) => {
                const up = avg(m.mayhem) > avg(m.rift);
                const helps = /cooldown|cost/i.test(m.name) ? !up : up;
                return (
                  <tr key={i}>
                    <td>
                      <span className="cp-ability">
                        {m.icon && (
                          <img
                            className="cp-icon"
                            src={m.icon}
                            alt=""
                            width={32}
                            height={32}
                            loading="lazy"
                          />
                        )}
                        <b className="cp-key" data-k={m.slot}>
                          {m.slot}
                        </b>
                        {m.ability}
                      </span>
                    </td>
                    <td>
                      <ChangeName name={m.name} />
                    </td>
                    <td className="num">{values(m.name, m.rift)}</td>
                    <td className="num">
                      <b>{values(m.name, m.mayhem)}</b>{" "}
                      <span className={helps ? "up" : "down"}>
                        {up ? "▲" : "▼"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="cp-empty-line">
          <T ns={NS} v={{ name }}>
            {"Mayhem doesn't change any of {name}'s ability numbers."}
          </T>
        </p>
      )}
    </Panel>
  );
}

const STATS: [keyof BaseStats, string][] = [
  ["hp", "Health"],
  ["hp5", "Health regen (per 5s)"],
  ["ad", "Attack damage"],
  ["as", "Attack speed"],
  ["armor", "Armor"],
  ["mr", "Magic resist"],
];

// Level 18 adds 17 levels of growth; attack speed grows as a percentage of its base.
export function BaseStatsTable({ stats }: { stats: BaseStats }) {
  const rows: [string, number, string | number, number, number][] = [];
  for (const [k, label] of STATS) {
    const [base, per] = stats[k] as number[];
    if (k === "as")
      rows.push([
        label,
        base,
        `${num(per, 2)}%`,
        base * (1 + (17 * per) / 100),
        3,
      ]);
    else rows.push([label, base, per, base + 17 * per, 1]);
    if (k === "hp5" && stats.resource) {
      const r = stats.resource;
      rows.push([r.kind, r.base[0], r.base[1], r.base[0] + 17 * r.base[1], 1]);
      rows.push([
        `${r.kind} regen (per 5s)`,
        r.regen[0],
        r.regen[1],
        r.regen[0] + 17 * r.regen[1],
        1,
      ]);
    }
  }
  rows.push(
    ["Attack range", stats.range, "", stats.range, 0],
    ["Move speed", stats.ms, "", stats.ms, 0],
  );
  return (
    <Panel
      id="stats"
      title="Base stats"
      note={<T ns={NS}>{"Before items, augments and Mayhem's bonuses"}</T>}
    >
      <div className="cp-scroll">
        <table className="cp-table">
          <thead>
            <tr>
              <th>
                <T ns={NS}>Stat</T>
              </th>
              <th className="num">
                <T ns={NS} v={{ n: 1 }}>
                  {"Level {n}"}
                </T>
              </th>
              <th className="num">
                <T ns={NS}>Per level</T>
              </th>
              <th className="num">
                <T ns={NS} v={{ n: 18 }}>
                  {"Level {n}"}
                </T>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b, z, d]) => (
              <tr key={label}>
                <td>
                  <T ns="/embed/champions/i18n">{label}</T>
                </td>
                <td className="num">{num(a, 3)}</td>
                <td className="num">
                  {b === "" ? "–" : typeof b === "number" ? num(b, 3) : b}
                </td>
                <td className="num">
                  <b>{num(z, d)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
