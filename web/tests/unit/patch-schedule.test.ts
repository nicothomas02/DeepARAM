import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { longDate, nextPatch, type PatchSchedule } from "@/lib/patch-schedule";

const schedule = JSON.parse(readFileSync("../data/patch-schedule.json", "utf8")) as PatchSchedule;

describe("patch countdown", () => {
  it("counts days and hours to the 6:30 AM Pacific update", () => {
    // 13:30 UTC on Oct 17 is 6:30 PDT; the update is 13:30 UTC on Oct 21 (PDT, UTC-7): exactly 4 days.
    expect(nextPatch(schedule, new Date("2026-10-17T13:30:00Z"))).toEqual({ patch: "26.21", date: "2026-10-21", days: 4, hours: 0, at: "2026-10-21T13:30:00.000Z", out: false });
    expect(nextPatch(schedule, new Date("2026-10-20T12:30:00Z"))).toMatchObject({ days: 1, hours: 1 });
  });

  it("uses the Pacific date, not the UTC one, late in the evening", () => {
    // 05:00 UTC on Oct 21 is 22:00 on Oct 20 in Los Angeles: 8 and a half hours to go.
    expect(nextPatch(schedule, new Date("2026-10-21T05:00:00Z"))).toMatchObject({ days: 0, hours: 8, out: false });
  });

  it("handles the daylight-saving switch", () => {
    // Nov 4 is PST (UTC-8): 6:30 there is 14:30 UTC.
    expect(nextPatch(schedule, new Date("2026-11-01T00:00:00Z"))?.at).toBe("2026-11-04T14:30:00.000Z");
  });

  it("shows patch day as out once the update time passes, then moves on", () => {
    expect(nextPatch(schedule, new Date("2026-10-21T20:00:00Z"))).toMatchObject({ patch: "26.21", days: 0, hours: 0, out: true });
    expect(nextPatch(schedule, new Date("2026-10-22T20:00:00Z"))?.patch).toBe("26.22");
  });

  it("shows nothing once the published list runs out", () => {
    expect(nextPatch(schedule, new Date("2026-12-20T20:00:00Z"))).toBeNull();
  });

  it("words the dates for players", () => {
    expect(longDate("2026-10-21")).toBe("Wednesday, October 21");
    expect(longDate("2026-10-21", "fr")).toBe("mercredi 21 octobre");
  });
});
