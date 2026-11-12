import { readRepoJson } from "@/lib/repo-data";
import { slimTuning, type Tuning } from "@/lib/sim-analysis";

// Every champion's tuning-sensitivity curves for the Simulator's Tuning tab, loaded when a visitor opens it.
// Built once per deploy from simulator/analysis/tuning-sensitivity.json (simulator/tools/sensitivity.py).
export const dynamic = "force-static";

export function GET() {
  const t = readRepoJson<Tuning>("simulator/analysis/tuning-sensitivity.json");
  return Response.json(t ? slimTuning(t) : null);
}
