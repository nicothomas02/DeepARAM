import { describe, expect, it } from "vitest";
import { cleanSubmission } from "@/lib/kitchen";

// The Kitchen's community builds: what the Simulator may send (lib/kitchen.ts).
const ok = {
  champion: "Jinx",
  items: ["infinity_edge", "kraken_slayer"],
  item_ids: [3031, 6672],
  item_names: ["Infinity Edge", "Kraken Slayer"],
  augments: ["dual_wield"],
  augment_ids: [1234],
  augment_names: ["Dual Wield"],
  title: "Rocket Rain",
  description: "Dual Wield doubles every rocket, so Fishbones hits the whole team at once.",
  sim: { mean_dps: 900, survival_rate: 0.4, trials: 2000 },
  lang: "fr",
};

describe("cleanSubmission", () => {
  it("accepts a valid build", () => {
    const s = cleanSubmission(ok);
    expect(s.champion).toBe("Jinx");
    expect(s.items).toEqual([{ key: "infinity_edge", id: 3031, name: "Infinity Edge" }, { key: "kraken_slayer", id: 6672, name: "Kraken Slayer" }]);
    expect(s.augments).toHaveLength(1);
    expect(s.lang).toBe("fr");
  });

  it.each([
    [{ champion: "NotAChamp" }, "Pick a champion first."],
    [{ items: [], item_ids: [], item_names: [] }, "Send 1 to 6 items."],
    [{ item_ids: [3031] }, "The build's items are missing."],
    [{ item_ids: [3031, -1] }, "One of the build's items isn't valid."],
    [{ items: ["infinity_edge", "infinity_edge"] }, "The build lists the same item twice."],
    [{ augments: ["a1", "a2", "a3", "a4", "a5"], augment_ids: [1, 2, 3, 4, 5], augment_names: ["A", "B", "C", "D", "E"] }, "Send at most 4 augments."],
    [{ title: "x" }, "Give the build a name of 3 to 60 characters."],
    [{ description: "too short" }, "Say why it works in 20 to 280 characters."],
    [{ title: "<script>alert" }, "The name or text has characters it can't use."],
  ])("rejects %o", (change, message) => expect(() => cleanSubmission({ ...ok, ...change })).toThrow(message));

  it("drops an oversized sim block and an unknown language", () => {
    const s = cleanSubmission({ ...ok, sim: { junk: "x".repeat(2000) }, lang: "klingon" });
    expect(s.sim).toBeNull();
    expect(s.lang).toBeNull();
  });
});

// Home's Chef Special card compares itself with /data/chef-special.json and refreshes when they differ,
// so the route must name the same special the pages are built from (data/cook-builds/chefs-special.json).
describe("current Chef Special route", () => {
  it("names the special in the repo data", async () => {
    const { GET } = await import("@/app/data/chef-special.json/route");
    const { chefsSpecial } = await import("@/lib/highlights");
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync(new URL("../../../data/cook-builds/chefs-special.json", import.meta.url), "utf8"));
    const body = await GET().json();
    expect(body.id).toBe(raw.id);
    expect(body.id).toBe(chefsSpecial()?.id);
  });
});
