// The next patch from Riot's published schedule (data/patch-schedule.json). Dates there are calendar
// days in Pacific Time, so "today" is worked out in that zone too. No server-only imports: the
// countdown runs in the browser so a static page doesn't show the day it was built.

export type PatchSchedule = { timeZone: string; time?: string; patches: { patch: string; date: string; time?: string }[] };
export type NextPatch = { patch: string; date: string; days: number; hours: number; at: string };

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** The UTC instant at which `date` + `time` ("2026-10-21", "06:30") is on the clock in `timeZone`. */
export function zonedInstant(date: string, time: string, timeZone: string) {
  const want = Date.parse(`${date}T${time}:00Z`);
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
    );
    guess += want - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  }
  return guess;
}

/** Today's calendar date ("2026-10-17") in the given time zone. */
export function dayIn(timeZone: string, now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The next patch whose update time hasn't come yet, with the days and hours to it. Once a patch's time passes it
 * moves on to the one after, so the countdown rolls over by itself. Null once the list runs out. */
export function nextPatch(s: PatchSchedule, now = new Date()): NextPatch | null {
  const t = now.getTime();
  const next = [...s.patches]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ ...p, at: zonedInstant(p.date, p.time ?? s.time ?? "00:00", s.timeZone) }))
    .find((p) => p.at > t);
  if (!next) return null;
  const left = next.at - t;
  return { patch: next.patch, date: next.date, days: Math.floor(left / DAY), hours: Math.floor((left % DAY) / HOUR), at: new Date(next.at).toISOString() };
}

/** "Wednesday, October 21" for a schedule date, written the way `lang` writes dates. */
export function longDate(date: string, lang = "en") {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(lang === "en" ? "en-US" : lang, { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
}
