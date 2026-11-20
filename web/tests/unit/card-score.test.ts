import { describe, expect, it } from "vitest";
import { alongCore, followed } from "@/lib/card-score";

describe("followed", () => {
  it("keeps a rare build from leading the list", () => {
    const rows = [
      { id: "ap", pickRate: 0.009 },
      { id: "tank", pickRate: 0.118 },
      { id: "mixed", pickRate: 0.04 },
    ];
    expect(followed(rows).map((r) => r.id)).toEqual(["tank", "mixed", "ap"]);
  });
  it("leaves close rows in their order", () => {
    const rows = [
      { id: "a", pickRate: 0.03 },
      { id: "b", pickRate: 0.033 },
    ];
    expect(followed(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("alongCore", () => {
  const full = [{ items: [1, 2, 3, 4, 5, 6] }, { items: [10, 11, 12, 13, 14, 15] }];
  it("puts items bought with the core first", () => {
    const pool = [{ items: [13] }, { items: [5] }, { items: [4] }];
    expect(alongCore(pool, [1, 2, 3], full).map((r) => r.items[0])).toEqual([5, 4, 13]);
  });
  it("keeps the pool when no build has the core", () => {
    const pool = [{ items: [13] }, { items: [5] }];
    expect(alongCore(pool, [7, 8, 9], full)).toEqual(pool);
  });
});
