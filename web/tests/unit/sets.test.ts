import { describe, expect, it } from "vitest";
import { bySet, setOf } from "@/lib/sets";

describe("Mayhem sets", () => {
  it("puts each patch in the set that started at or before it", () => {
    expect(setOf("15.21").name).toBe("Launch");
    expect(setOf("16.2").name).toBe("Launch");
    expect(setOf("16.3").name).toBe("Set 1");
    expect(setOf("16.11").name).toBe("Set 1");
    expect(setOf("16.12").name).toBe("Set 2");
    expect(setOf("16.20").name).toBe("Set 2");
    expect(setOf("16.21").name).toBe("Set 3");
  });
  it("groups patches by set in the order given", () => {
    expect(bySet(["16.1", "16.2", "16.3", "16.12", "16.13"]).map((g) => [g.set.name, g.patches])).toEqual([
      ["Launch", ["16.1", "16.2"]],
      ["Set 1", ["16.3"]],
      ["Set 2", ["16.12", "16.13"]],
    ]);
  });
});
