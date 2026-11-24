import { describe, expect, it } from "vitest";
import { MIN_FOLLOWING } from "@/lib/card-score";
import { skillOrders } from "@/lib/skill-orders";
import ids from "@/data/champion-ids.json";

const ID = ids as Record<string, number>;

describe("skill orders from real level-ups", () => {
  it("leads with an order that has a real following, best DeepScore among those", () => {
    for (const id of Object.values(ID)) {
      const s = skillOrders(id);
      if (!s) continue;
      for (const rows of [s.all, ...Object.values(s.styles)]) {
        if (rows.length < 2) continue;
        const top = Math.max(...rows.map((r) => r.games));
        const led = rows.filter((r) => r.games >= MIN_FOLLOWING * top);
        expect(rows[0].games).toBeGreaterThanOrEqual(MIN_FOLLOWING * top);
        expect(rows[0].deepScore).toBe(Math.max(...led.map((r) => r.deepScore ?? 0)));
      }
    }
  });

  it("maxes Zeri's Q first (her Q starts with a free rank, so it's maxed after four points)", () => {
    expect(skillOrders(ID.Zeri)?.all[0]?.max[0]).toBe("Q");
  });

  it("gives attack-speed Ashe Q first when the data backs it (Nico 2026-11-24)", () => {
    const crit = skillOrders(ID.Ashe)?.styles.crit;
    expect(crit?.[0]?.max.join("")).toBe("QWE");
  });
});
