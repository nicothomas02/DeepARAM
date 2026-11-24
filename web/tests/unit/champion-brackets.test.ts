import { describe, expect, it } from "vitest";
import { bracketData, championBrackets } from "@/lib/brackets";

describe("championBrackets", () => {
  it("borrows the newest earlier patch with brackets when the live one has none", () => {
    const withBrackets = Object.keys(bracketData());
    const newest = withBrackets.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)!;
    const later = "99.99";
    const r = championBrackets("Zeri", later);
    expect(r?.patch).toBe(newest);
    expect(r!.rates.high![0]).toBeGreaterThan(0.3);
    expect(championBrackets("Zeri", "1.1")).toBeNull();
  });
});
