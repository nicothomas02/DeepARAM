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
