// The early-window blend (data/estimates/early_builds.json) stands in for 101's lists only: a champion whose single
// items come from AramHex keeps those real counts on its page (2026-11-23: the blend was replacing Rek'Sai's).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ids from "@/data/champion-ids.json";
import { championPage } from "@/lib/champion-page";

const repo = join(process.cwd(), "..");
const read = (p: string) => JSON.parse(readFileSync(join(repo, p), "utf8"));

describe("early builds and AramHex items", () => {
  it("keeps AramHex single items for champions the blend flags", () => {
    const early = read("data/estimates/early_builds.json").champions ?? {};
    const alias = Object.fromEntries(Object.entries(ids as Record<string, number>).map(([a, id]) => [String(id), a]));
    let checked = 0;
    for (const [id, c] of Object.entries(early) as [string, { estimated: boolean }][]) {
      const b = read(`data/cn/builds/${id}.json`);
      if (!c.estimated || b.sources?.["items.other"] !== "aramhex" || !alias[id]) continue;
      const page = championPage(alias[id])!;
      const real = new Map((b.items.other as { items: number[]; win_rate: number }[]).map((r) => [r.items[0], r.win_rate]));
      const shown = page.items.filter((r) => r.items.length === 1 && real.has(r.items[0]));
      expect(shown.length, alias[id]).toBeGreaterThan(real.size / 2);
      for (const r of shown) expect(r.winRate, `${alias[id]} ${r.items[0]}`).toBeCloseTo(real.get(r.items[0])!, 4);
      checked++;
    }
    // The blend flags different champions each day, sometimes none, so a day with none passes.
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});
