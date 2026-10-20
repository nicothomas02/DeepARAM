"use client";

import { useEffect, useState } from "react";
import { nextPatch, type NextPatch, type PatchSchedule } from "@/lib/patch-schedule";
import { patchName } from "@/lib/patch-name";
import { useLang, useT } from "./I18n";

// Countdown to the next patch on Riot's schedule. The server renders it as of the build (asOf, so the first
// browser render matches it); the browser recomputes it on load and every minute so a cached page stays right. Its wording is in /i18n/patch-countdown/.
export default function PatchCountdown({ schedule, asOf, note }: { schedule: PatchSchedule; asOf: string; note?: React.ReactNode }) {
  const [next, setNext] = useState<NextPatch | null>(() => nextPatch(schedule, new Date(asOf)));
  const t = useT("patch-countdown");
  const lang = useLang();
  const [mine, setMine] = useState(false); // the visitor's own time zone, known only in the browser
  useEffect(() => {
    const tick = () => setNext(nextPatch(schedule));
    tick();
    setMine(true);
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [schedule]);
  if (!next) return null;

  const v = { patch: patchName(next.patch), n: next.days };
  const when = new Intl.DateTimeFormat(lang === "en" ? "en-US" : lang, {
    weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    ...(mine ? {} : { timeZone: schedule.timeZone }),
  }).format(new Date(next.at));
  const hours = new Intl.NumberFormat(lang === "en" ? "en-US" : lang, { style: "unit", unit: "hour", unitDisplay: "narrow" }).format(next.hours);
  return (
    <div className="patch-countdown" role="status">
      <span className="patch-countdown-days">
        {next.out ? (
          <b>{t("Today")}</b>
        ) : next.days === 0 ? (
          <b>{hours}</b>
        ) : (
          <>
            <b>{next.days}</b> {t(next.days === 1 ? "day" : "days")}
            <span>{hours}</span>
          </>
        )}
      </span>
      <span className="patch-countdown-text">
        <b>
          {t(next.out ? "Patch {patch} is out today" : next.days === 0 ? "Patch {patch} comes out in under 24 hours" : next.days === 1 ? "Patch {patch} comes out tomorrow" : "Patch {patch} comes out in {n} days", v)}
        </b>
        <span className="sub">{when}</span>
        {note && <span className="sub">{note}</span>}
      </span>
    </div>
  );
}
