import { describe, expect, it } from "vitest";
import { alongCore, followed, skipsBoots } from "@/lib/card-score";

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

describe("skipsBoots", () => {
  const isBoots = (i: number) => i === 99;
  it("skips when few buy boots and most six-item builds have none", () => {
    const full = [{ items: [1, 2, 3, 4, 5, 6], pickRate: 0.2 }, { items: [1, 2, 3, 4, 5, 99], pickRate: 0.01 }];
    expect(skipsBoots([{ pickRate: 0.05 }], full, isBoots)).toBe(true);
  });
  it("keeps boots when most builds have them", () => {
    const full = [{ items: [1, 2, 3, 4, 5, 99], pickRate: 0.2 }, { items: [1, 2, 3, 4, 5, 6], pickRate: 0.1 }];
    expect(skipsBoots([{ pickRate: 0.2 }], full, isBoots)).toBe(false);
    expect(skipsBoots([{ pickRate: 0.6 }], [{ items: [1, 2, 3, 4, 5, 6], pickRate: 0.2 }], isBoots)).toBe(false);
  });
});
