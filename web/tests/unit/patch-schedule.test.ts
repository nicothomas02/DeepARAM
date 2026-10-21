import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { awaitingData, longDate, nextPatch, type PatchSchedule } from "@/lib/patch-schedule";

const schedule = JSON.parse(readFileSync("../data/patch-schedule.json", "utf8")) as PatchSchedule;

describe("patch countdown", () => {
  it("counts days and hours to the 6:30 AM Pacific update", () => {
    // 13:30 UTC on Oct 17 is 6:30 PDT; the update is 13:30 UTC on Oct 21 (PDT, UTC-7): exactly 4 days.
    expect(nextPatch(schedule, new Date("2026-10-17T13:30:00Z"))).toEqual({ patch: "26.21", date: "2026-10-21", days: 4, hours: 0, at: "2026-10-21T13:30:00.000Z" });
    expect(nextPatch(schedule, new Date("2026-10-20T12:30:00Z"))).toMatchObject({ days: 1, hours: 1 });
  });

  it("uses the Pacific date, not the UTC one, late in the evening", () => {
    // 05:00 UTC on Oct 21 is 22:00 on Oct 20 in Los Angeles: 8 and a half hours to go.
    expect(nextPatch(schedule, new Date("2026-10-21T05:00:00Z"))).toMatchObject({ patch: "26.21", days: 0, hours: 8 });
  });

  it("handles the daylight-saving switch", () => {
    // Nov 4 is PST (UTC-8): 6:30 there is 14:30 UTC.
    expect(nextPatch(schedule, new Date("2026-11-01T00:00:00Z"))?.at).toBe("2026-11-04T14:30:00.000Z");
  });

  it("rolls over to the next patch the moment the update time passes", () => {
    expect(nextPatch(schedule, new Date("2026-10-21T13:29:00Z"))).toMatchObject({ patch: "26.21", days: 0, hours: 0 });
    // 26.22 is Nov 4 at 6:30 PST (14:30 UTC): 14 days and 1 hour after 13:30 UTC on Oct 21
    expect(nextPatch(schedule, new Date("2026-10-21T13:30:00Z"))).toMatchObject({ patch: "26.22", days: 14, hours: 1 });
    expect(nextPatch(schedule, new Date("2026-10-21T20:00:00Z"))?.patch).toBe("26.22");
  });

  it("calls a patch live until the stats reach it", () => {
    const after = new Date("2026-10-21T20:00:00Z");
    expect(awaitingData(schedule, "16.20", after)?.patch).toBe("26.21");
    expect(awaitingData(schedule, "16.21", after)).toBeNull();
    // before 26.21's update time, 26.20 is the newest patch out and the stats already cover it
    expect(awaitingData(schedule, "16.20", new Date("2026-10-21T13:29:00Z"))).toBeNull();
    expect(awaitingData(schedule, null, after)).toBeNull();
  });

  it("shows nothing once the published list runs out", () => {
    expect(nextPatch(schedule, new Date("2026-12-20T20:00:00Z"))).toBeNull();
  });

  it("words the dates for players", () => {
    expect(longDate("2026-10-21")).toBe("Wednesday, October 21");
    expect(longDate("2026-10-21", "fr")).toBe("mercredi 21 octobre");
  });
});
