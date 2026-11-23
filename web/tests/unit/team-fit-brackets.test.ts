import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { teamFitData } from "@/lib/team-fit";

// The public app's skill-bracket toggle reads team-fit.json `brackets`: same scoring as `champions`, per bracket.
describe("team-fit brackets", () => {
  const d = teamFitData();
  it("carries a strength per bracket for the live patch when it has bracket data", () => {
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
    for (const m of Object.values(d.brackets ?? {})) for (const a of Object.keys(m!)) expect(d.champions[a]).toBeDefined();
  });
});
