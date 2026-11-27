import "server-only";
import { readdirSync } from "node:fs";
import { readRepoJson, repoHas, repoPath } from "./repo-data";

/** Which champions a patch buffed or nerfed, per patch (client version, "16.24"): the PBE change tracker's tags as frozen
 *  when the patch went live (data/analysis/forecast_snapshots, forecast_scorecard.py). Only the direction is used, never
 *  the forecast's numbers: on 16.23 the forecast didn't beat "no change" (Nico 2026-11-27 chose marks only). */
export type PatchChanges = Record<string, Record<string, "buff" | "nerf">>;

type Snapshot = { patch?: string; entries?: { alias?: string; tag?: string }[] };

export function patchChanges(): PatchChanges {
  const dir = "data/analysis/forecast_snapshots";
  if (!repoHas(dir)) return {};
  const out: PatchChanges = {};
  for (const f of readdirSync(repoPath(dir)).filter((x) => x.endsWith(".json"))) {
    const s = readRepoJson<Snapshot>(`${dir}/${f}`);
    if (!s?.patch) continue;
    const marks: Record<string, "buff" | "nerf"> = {};
    for (const e of s.entries ?? []) if (e.alias && (e.tag === "buff" || e.tag === "nerf")) marks[e.alias] = e.tag;
    out[s.patch] = marks;
  }
  return out;
}
