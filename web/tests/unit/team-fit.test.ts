import { describe, expect, it } from "vitest";
import { pairBoost, rankPicks, type TeamFitData } from "@/lib/team-fit-score";

const data: TeamFitData = {
  patch: "16.9",
  champions: {
    Lux: [0.52, ["Burst"]],
    Vi: [0.5, ["Diver"]],
    Jinx: [0.51, ["Marksman"]],
    Ashe: [0.53, ["Marksman"]],
    Nami: [0.5, ["Enchanter"]],
  },
  pairs: { "Jinx Lux": 0.02 },
  archetypes: { "Marksman+Marksman": -0.03, "Enchanter+Marksman": 0.01 },
};

describe("best pick for your team", () => {
  it("uses the exact pair when listed, else the archetypes", () => {
    expect(pairBoost(data, "Lux", "Jinx")).toEqual({
      boost: 0.02,
      exact: true,
    });
    expect(pairBoost(data, "Ashe", "Jinx")).toEqual({
      boost: -0.03,
      exact: false,
    });
    expect(pairBoost(data, "Vi", "Nami")).toEqual({ boost: 0, exact: false });
  });

  it("ranks by strength alone with no team, and adds team fit with one", () => {
    expect(rankPicks(data, [])[0].id).toBe("Ashe");
    const withJinx = rankPicks(data, ["Jinx"]);
    expect(withJinx.map((p) => p.id)).not.toContain("Jinx");
    // A second marksman drops below the enchanter that pairs with Jinx.
    expect(withJinx.findIndex((p) => p.id === "Nami")).toBeLessThan(
      withJinx.findIndex((p) => p.id === "Ashe"),
    );
  });

  it("ranks only the given choices when there are some", () => {
    expect(rankPicks(data, ["Lux"], ["Vi", "Jinx"]).map((p) => p.id)).toEqual([
      "Jinx",
      "Vi",
    ]);
  });
});
