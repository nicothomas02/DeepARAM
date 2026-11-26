import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { bracketData } from "@/lib/brackets";
import { readRepoCsv } from "@/lib/repo-data";
import { teamFitData } from "@/lib/team-fit";

// The public app's skill-bracket toggle reads team-fit.json `brackets`: same scoring as `champions`, per bracket.
describe("team-fit brackets", () => {
  const d = teamFitData();
  it("carries a strength per bracket for the live patch when it has bracket data", () => {
    // Bracket tables arrive a while into a patch; until then the patch before lends its own, and no older one does.
    // So the brackets are exactly that patch's, and with tables in neither there are none and no patch is named.
    const tables = bracketData();
    const newest = (readRepoCsv("data/cn/history/patches.csv") ?? []).slice(-2).map((r) => r.patch);
    const source = newest.reverse().find((p) => tables[p]);
    expect(Object.keys(d.brackets ?? {})).toEqual(Object.keys(source ? tables[source] : {}));
    expect(d.bracketPatch != null).toBe(source !== undefined);
    for (const [b, m] of Object.entries(d.brackets ?? {})) {
      expect(["casual", "mid", "high"]).toContain(b);
      const vals = Object.values(m!);
      expect(vals.length).toBeGreaterThan(50);
      for (const v of vals) {
        expect(v).toBeGreaterThan(0.3);
        expect(v).toBeLessThan(0.7);
      }
    }
  });
  it("only names champions the main table knows", () => {
    const named = Object.values(d.brackets ?? {}).flatMap((m) => Object.keys(m!));
    expect(named.filter((a) => d.champions[a] === undefined)).toEqual([]);
  });
});
