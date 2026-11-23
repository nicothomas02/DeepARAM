// The "What it does" line for lib/mechanisms.ts effects, translated (client-safe: no data reads).
import type { Effect, Metric } from "./mechanisms";

export const EFFECT_LABEL: Record<Metric, string> = {
  damage: "{n} damage to champions",
  healing: "{n} healing",
  mitigated: "{n} damage blocked",
  cc: "{n} crowd control",
  deaths: "{n} deaths per 10 minutes",
};

export function whatItDoesText(t: (s: string, v?: Record<string, string | number>) => string, effects: Effect[]): string {
  if (!effects.length) return "";
  return t("What it does (estimated): {effects}", { effects: effects.map((e) => t(EFFECT_LABEL[e.metric], { n: e.n })).join(", ") });
}
