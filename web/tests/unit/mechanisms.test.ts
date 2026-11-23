import { describe, expect, it } from "vitest";
import { mechanismProfiles, whatItDoes } from "@/lib/mechanisms";

describe("whatItDoes", () => {
  it("keeps at most two clear, sizeable effects (|z| >= 3), biggest first", () => {
    const all = mechanismProfiles()!;
    for (const kind of ["augments", "items"] as const)
      for (const id of Object.keys(all[kind]).slice(0, 50)) {
        const out = whatItDoes(kind, Number(id));
        expect(out.length).toBeLessThanOrEqual(2);
        const p = all[kind][id];
        for (const e of out) {
          expect(Math.abs(p[e.metric].z)).toBeGreaterThanOrEqual(3);
          expect(Math.abs(p[e.metric].change)).toBeGreaterThanOrEqual(e.metric === "deaths" ? 0.3 : 8);
        }
        if (out.length === 2) expect(Math.abs(p[out[0].metric].z)).toBeGreaterThanOrEqual(Math.abs(p[out[1].metric].z));
      }
  });
  it("leaves healing out for picks that shield", () => {
    const all = mechanismProfiles()!;
    const id = Object.keys(all.augments).find((k) => Math.abs(all.augments[k].healing.z) >= 3)!;
    expect(whatItDoes("augments", Number(id)).some((e) => e.metric === "healing")).toBe(true);
    expect(whatItDoes("augments", Number(id), { shield: true }).some((e) => e.metric === "healing")).toBe(false);
  });
  it("finds Mayhem item variants under their base id, and nothing for unknown ids", () => {
    const all = mechanismProfiles()!;
    const id = Object.keys(all.items).find((k) => whatItDoes("items", Number(k)).length)!;
    expect(whatItDoes("items", 220000 + Number(id))).toEqual(whatItDoes("items", Number(id)));
    expect(whatItDoes("items", 999999)).toEqual([]);
  });
  it("serves no sample sizes", () => {
    expect(JSON.stringify(mechanismProfiles())).not.toMatch(/holders|player_games/);
  });
});
