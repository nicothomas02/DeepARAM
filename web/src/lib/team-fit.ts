import "server-only";
import { archetypeRows, archetypes, duoRows } from "./duos";
import { liveTiers, livePatch } from "./highlights";
import { patchName } from "./patch-name";
import { pairKey, type TeamFitData } from "./team-fit-score";

// Data for "Best pick for your team" (lib/team-fit-score.ts): public live stats only.
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function teamFitData(): TeamFitData {
  const champions: TeamFitData["champions"] = {};
  for (const c of liveTiers()) champions[c.id] = [r4(c.next), archetypes(c.id)];
  const pairs: TeamFitData["pairs"] = {};
  for (const r of duoRows()) pairs[pairKey(r.a, r.b)] = r4(r.delta);
  const arch: TeamFitData["archetypes"] = {};
  for (const r of archetypeRows())
    arch[[r.a, r.b].sort().join("+")] = r4(r.delta);
  return {
    patch: patchName(livePatch()) || null,
    champions,
    pairs,
    archetypes: arch,
  };
}

/** Changes whenever the data does, so browsers never pair a new page with an old cached copy. */
export function teamFitVersion() {
  let h = 0;
  for (const ch of JSON.stringify(teamFitData()))
    h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
