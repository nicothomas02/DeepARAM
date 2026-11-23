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

  it("ranks by strength, with or without a team, and still works out fit", () => {
    expect(rankPicks(data, [])[0].id).toBe("Ashe");
    const withJinx = rankPicks(data, ["Jinx"]);
    expect(withJinx.map((p) => p.id)).not.toContain("Jinx");
    expect(withJinx[0].id).toBe("Ashe");
    const nami = withJinx.find((p) => p.id === "Nami")!;
    const ashe = withJinx.find((p) => p.id === "Ashe")!;
    expect(nami.fit).toBeGreaterThan(ashe.fit);
  });

  it("ranks only the given choices when there are some", () => {
    expect(rankPicks(data, ["Lux"], ["Vi", "Jinx"]).map((p) => p.id)).toEqual([
      "Jinx",
      "Vi",
    ]);
    expect(rankPicks(data, ["Lux"], ["Ashe", "Jinx"]).map((p) => p.id)).toEqual(
      ["Ashe", "Jinx"],
    );
  });
});

describe("team-fit.json for the desktop app", () => {
  it("maps champion ids, since champion select reports ids", async () => {
    const { teamFitData } = await import("@/lib/team-fit");
    const d = teamFitData();
    expect(d.ids?.Ashe).toBe(22);
    expect(Object.keys(d.ids ?? {}).length).toBeGreaterThan(150);
  });
});
