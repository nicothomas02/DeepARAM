// Types and helpers for the Simulator's Tuning and Accuracy tabs (simulator/analysis/*.json, written by
// simulator/tools/sensitivity.py and simulator/tools/validation.py).

export type Metric = "dps" | "alive" | "per_fight" | "taken";
export type Curve = { e: number; se: number | null; curve: (number | null)[]; curvature: number | null; monotone: boolean };
export type Tuning = {
  patch: string;
  steps: number[];
  seeds: number;
  trials: number;
  levers: Record<string, string>;
  metrics: Record<Metric, string>;
  roles: Record<string, { n: number; levers: Record<string, Partial<Record<Metric, { median: number; p25: number; p75: number }>>> }>;
  champions: {
    champion: string;
    name: string;
    role: string;
    build_source: string;
    items: string[];
    augments: string[];
    base: Record<Metric, number>;
    levers: Record<string, Partial<Record<Metric, Curve>>>;
    exchange: Record<string, number | null>;
  }[];
  items: { item: string; name: string; id: number; stats: string[]; champions: { champion: string; dps: number; per_fight?: number }[]; median: Partial<Record<Metric, number>> }[];
};

/** What the Tuning tab's champion view needs: per lever and shown metric, [elasticity, its spread, curve]. */
export type SlimCurve = [e: number, se: number | null, curve: (number | null)[], steady: boolean];
export type SlimTuning = {
  patch: string;
  steps: number[];
  levers: string[];
  champions: Record<string, { role: string; base: Partial<Record<Metric, number>>; l: Record<string, Partial<Record<Metric, SlimCurve>>>; x: Record<string, number | null> }>;
};

// What each lever changes (simulator/tools/sensitivity.py LEVERS); also the Tuning tab's card and column names.
export const LEVER_LABELS: Record<string, string> = {
  damage_dealt: "Damage dealt modifier",
  damage_taken: "Damage taken modifier",
  ability_damage: "Ability damage",
  base_ad: "Base attack damage",
  attack_speed: "Base attack speed",
  base_hp: "Base health",
  base_resists: "Base armor and magic resist",
};

export const SHOWN: Metric[] = ["per_fight", "dps", "alive"];

export function slimTuning(t: Tuning): SlimTuning {
  const champions: SlimTuning["champions"] = {};
  for (const c of t.champions) {
    const l: SlimTuning["champions"][string]["l"] = {};
    for (const [lever, m] of Object.entries(c.levers)) {
      l[lever] = {};
      for (const k of SHOWN) {
        const v = m[k];
        if (v) l[lever][k] = [v.e, v.se, v.curve, v.monotone];
      }
    }
    champions[c.champion] = {
      role: c.role,
      base: Object.fromEntries(SHOWN.map((k) => [k, c.base[k]])),
      l,
      x: c.exchange,
    };
  }
  return { patch: t.patch, steps: t.steps, levers: Object.keys(t.levers), champions };
}

export type Corr = { rho: number; n: number; ci95?: [number, number] };
export type Validation = {
  patch: string;
  date: string;
  trials: number;
  bootstrap: number;
  n: number;
  dps_vs_damage_share: Corr;
  taken_vs_tank_share: Corr | null;
  role_adjusted: {
    spearman: Corr;
    r2_log: number;
    calibration_slope: number;
    mae_points: number;
    dps_coefficient: number;
    bins: { n: number; predicted: number; real: number; real_ci95: [number, number] }[];
  };
  role_only: { spearman: Corr; r2_log: number; mae_points: number };
  roles: { role: string; n: number; within: Corr | null; raw_bias: number; raw_bias_se: number | null; resid_sd: number | null }[];
  underrated: { champion: string; role: string; factor: number; real_share: number; sim_dps: number }[];
  overrated: { champion: string; role: string; factor: number; real_share: number; sim_dps: number }[];
  history: { commit: string; date: string; pr: number | null; title: string; spearman: number; ci95?: [number, number]; role_adjusted: number; taken: number | null; n: number }[];
  history_current: { spearman: number; ci95?: [number, number]; role_adjusted: number; taken: number | null; n: number };
};

/** "+1.23" style signed number. */
export const signed = (v: number, digits = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
