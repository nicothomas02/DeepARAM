import { describe, expect, it } from "vitest";
import { fullTeams } from "@/lib/teams";

// Full teams (lib/teams.ts): five champions per row, a champions-vs-synergy split between 0 and 1, and no win rate.
describe("fullTeams", () => {
  it("gives five-champion rows with a split between 0 and 1", () => {
    const { data, frontline } = fullTeams();
    for (const r of [...data, ...frontline]) {
      expect(r.champions).toHaveLength(5);
      expect(r.fromChampions).toBeGreaterThanOrEqual(0);
      expect(r.fromChampions).toBeLessThanOrEqual(1);
      for (const a of r.champions) expect(r.english[a]).toBeTruthy();
      expect(r).not.toHaveProperty("projected_win_rate");
    }
  });
});
