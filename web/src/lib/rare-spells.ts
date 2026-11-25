import "server-only";
import { readRepoJson } from "./repo-data";

/** Why a rare spell pair leads one champion's card (data/estimates/rare_spell_reasons.py, Nico 2026-11-25): a kit
 *  reason checked against three patches of real games, or a tie / mixed verdict. Hover only on the site and apps. */
export type RareSpellWhy = {
  verdict: "holds" | "tie" | "mixed";
  /** Kit template, set only when the edge holds (FewPlayers.tsx SPELL_KIT). */
  template: string | null;
  key: string;
  /** The keyed ability's English name. */
  ability: string;
  /** Pooled edge over the champion's average, points. */
  edge: number | null;
  patches: number;
};

type Row = { spells: number[]; verdict: RareSpellWhy["verdict"]; template: string | null; key: string; ability: string; edge: number | null; patches: unknown[] };
let rows: Record<string, Row> | undefined;

/** The champion's reason when its leading pair is the one the reason was written for, else null (generic line). */
export function rareSpellWhy(alias: string, spellIds: number[]): RareSpellWhy | null {
  rows ??= readRepoJson<{ champions: Record<string, Row> }>("data/estimates/rare_spell_reasons.json")?.champions ?? {};
  const r = rows[alias];
  if (!r) return null;
  const same = [...r.spells].sort().join("+") === [...spellIds].sort().join("+");
  return same ? { verdict: r.verdict, template: r.template, key: r.key, ability: r.ability, edge: r.edge, patches: r.patches.length } : null;
}
