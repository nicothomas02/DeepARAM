import { describe, expect, it } from "vitest";
import { patchImpactSummary, simulatorValidation } from "@/lib/research";

// The Research page's live figures (lib/research.ts) must be present and in range, or its case studies drop out.
describe("research page figures", () => {
  it("counts patch changes and sizes a damage modifier", () => {
    const s = patchImpactSummary();
    expect(s).not.toBeNull();
    expect(s!.changes).toBeGreaterThan(0);
    expect(s!.worked + s!.opposite + s!.rest).toBe(s!.changes);
    expect(s!.ci[0]).toBeLessThanOrEqual(s!.ci[1]);
  });
  it("summarises the Simulator validation", () => {
    const v = simulatorValidation();
    expect(v).not.toBeNull();
    expect(Math.abs(v!.rho)).toBeLessThanOrEqual(1);
    expect(v!.versions).toBeGreaterThan(1);
    expect(v!.slope).toBeGreaterThan(0);
  });
});

describe("research track record", () => {
  it("has scored picks for at least one patch change", async () => {
    const { scorecard } = await import("@/lib/scorecard");
    const rows = scorecard();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.augments!.deepscore.hit).toBeGreaterThanOrEqual(0);
      expect(r.augments!.deepscore.hit).toBeLessThanOrEqual(1);
    }
  });
  it("reads the forecast scorecard, graded or waiting", async () => {
    const { forecastScorecard } = await import("@/lib/analysis");
    const f = forecastScorecard();
    expect(f).not.toBeNull();
    expect(f!.patches.length + f!.waiting.length).toBeGreaterThan(0);
    for (const p of f!.patches)
      expect(p.summary.direction.right).toBeLessThanOrEqual(
        p.summary.direction.of,
      );
  });
  it("links no repository until it is public", async () => {
    const { NOTEBOOK_REPO } = await import("@/lib/research");
    if (NOTEBOOK_REPO)
      expect(NOTEBOOK_REPO).toMatch(/^https:\/\/github\.com\//);
  });
});
