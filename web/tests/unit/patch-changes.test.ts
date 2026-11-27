import { describe, expect, it } from "vitest";
import { patchChanges } from "@/lib/patch-changes";
import { awaitingData, type PatchSchedule } from "@/lib/patch-schedule";

// Patch day (Nico 2026-11-27): marks only, from the change tags frozen when each patch went live.
describe("patch-day marks", () => {
  it("reads each patch's buffed and nerfed champions, and nothing else", () => {
    const c = patchChanges();
    expect(Object.keys(c).length).toBeGreaterThan(0);
    for (const marks of Object.values(c)) for (const tag of Object.values(marks)) expect(["buff", "nerf"]).toContain(tag);
  });
  it("turns on only between a patch's release and its first data", () => {
    const s: PatchSchedule = { timeZone: "America/Los_Angeles", time: "06:30", patches: [{ patch: "26.24", date: "2026-12-09" }] };
    expect(awaitingData(s, "16.23", new Date("2026-12-08T18:00:00Z"))).toBeNull();
    expect(awaitingData(s, "16.23", new Date("2026-12-09T18:00:00Z"))?.patch).toBe("26.24");
    expect(awaitingData(s, "16.24", new Date("2026-12-09T18:00:00Z"))).toBeNull();
  });
});
