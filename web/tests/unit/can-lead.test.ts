import { describe, expect, it } from "vitest";
import { canLead, leading, MIN_GAMES, SPELL_MIN_GAMES } from "@/lib/card-score";

const row = (pickRate: number, games?: number, pooled?: number) => ({
  pickRate,
  winRate: 0.5,
  lift: 0,
  ...(games !== undefined ? { games } : {}),
  ...(pooled !== undefined ? { pooled: { winRate: 0.5, games: pooled, patches: 2 } } : {}),
});

describe("canLead (flat game minimum, Nico 2026-11-24)", () => {
  it("lets any row with MIN_GAMES real games lead, however rare next to the top row", () => {
    const rows = [row(0.9, 90000), row(0.01, MIN_GAMES), row(0.009, MIN_GAMES - 1)];
    const ok = canLead(rows, 0.05);
    expect(rows.map(ok)).toEqual([true, true, false]);
  });
  it("counts pooled games where earlier patches are pooled in", () => {
    const rows = [row(0.9, 90000), row(0.01, 300, 1500)];
    expect(rows.map(canLead(rows, 0.25))).toEqual([true, true]);
  });
  it("leaves only the most played row when none has MIN_GAMES", () => {
    const rows = [row(0.5, 400), row(0.3, 600), row(0.2, 100)];
    expect(rows.map(canLead(rows, 0.25))).toEqual([false, true, false]);
  });
  it("keeps the share rule for lists without real game counts", () => {
    const rows = [row(0.5), row(0.03), row(0.02)];
    expect(rows.map(canLead(rows, 0.05))).toEqual([true, true, false]);
    expect(leading(rows, 0.05)).toEqual([rows[0], rows[1], rows[2]]);
  });

  it("lets spell pairs lead from SPELL_MIN_GAMES (Nico chose 100, 2026-11-24)", () => {
    const rows = [row(0.9, 90000), row(0.001, SPELL_MIN_GAMES), row(0.001, SPELL_MIN_GAMES - 1)];
    expect(rows.map(canLead(rows, 0.02, SPELL_MIN_GAMES))).toEqual([true, true, false]);
    expect(rows.map(canLead(rows, 0.02))).toEqual([true, false, false]);
  });
});
