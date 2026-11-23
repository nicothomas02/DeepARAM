import "server-only";
import championIds from "@/data/champion-ids.json";
import { BRACKETS, bracketData } from "./brackets";
import { archetypeRows, archetypes, duoRows } from "./duos";
import { liveTiers, livePatch } from "./highlights";
import { patchName } from "./patch-name";
import { readRepoCsv } from "./repo-data";
import { pairKey, type TeamFitData } from "./team-fit-score";

// Data for "Best pick for your team" (lib/team-fit-score.ts): public live stats only.
const r4 = (n: number) => Math.round(n * 10000) / 10000;
/** The patch before `p` in the history ("16.23" -> "16.22"), if it has rows. */
const prevPatch = (p: string | null) => {
  const list = (readRepoCsv("data/cn/history/patches.csv") ?? []).map((r) => r.patch);
  const i = p ? list.indexOf(p) : -1;
  return i > 0 ? list[i - 1] : null;
};

export function teamFitData(): TeamFitData {
  const champions: TeamFitData["champions"] = {};
  for (const c of liveTiers()) champions[c.id] = [r4(c.next), archetypes(c.id)];
  const pairs: TeamFitData["pairs"] = {};
  for (const r of duoRows()) pairs[pairKey(r.a, r.b)] = r4(r.delta);
  const arch: TeamFitData["archetypes"] = {};
  for (const r of archetypeRows())
    arch[[r.a, r.b].sort().join("+")] = r4(r.delta);
  const live = livePatch();
  // Skill brackets: the live patch's, or until it has them (published a while into a patch) the patch before's, named
  // in bracketPatch so the app can say so.
  const all = bracketData();
  const bp = [live, prevPatch(live)].find((p) => p && all[p]) ?? null;
  const brackets: NonNullable<TeamFitData["brackets"]> = {};
  for (const b of BRACKETS) {
    const d = bp ? all[bp]?.[b] : undefined;
    if (d) brackets[b] = Object.fromEntries(liveTiers(bp, d).map((c) => [c.id, r4(c.next)]));
  }
  return {
    patch: patchName(live) || null,
    champions,
    pairs,
    archetypes: arch,
    // The desktop companion's champion select reports champion ids, not names.
    ids: championIds as Record<string, number>,
    brackets,
    bracketPatch: bp ? patchName(bp) || bp : null,
  };
}

/** Changes whenever the data does, so browsers never pair a new page with an old cached copy. */
export function teamFitVersion() {
  let h = 0;
  for (const ch of JSON.stringify(teamFitData()))
    h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
