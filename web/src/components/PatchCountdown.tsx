"use client";

import { useEffect, useState } from "react";
import { longDate, nextPatch, type NextPatch, type PatchSchedule } from "@/lib/patch-schedule";
import { patchName } from "@/lib/patch-name";
import { useLang, useT } from "./I18n";

// Countdown to the next patch on Riot's schedule. The server renders it as of the build (asOf, so the first
// browser render matches it); the browser recomputes it on load and every hour so a cached page stays right. Its wording is in /i18n/patch-countdown/.
export default function PatchCountdown({ schedule, asOf, note }: { schedule: PatchSchedule; asOf: string; note?: React.ReactNode }) {
  const [next, setNext] = useState<NextPatch | null>(() => nextPatch(schedule, new Date(asOf)));
  const t = useT("patch-countdown");
  const lang = useLang();
  useEffect(() => {
    const tick = () => setNext(nextPatch(schedule));
    tick();
    const id = setInterval(tick, 3_600_000);
    return () => clearInterval(id);
  }, [schedule]);
  if (!next) return null;

  const v = { patch: patchName(next.patch), n: next.days };
  return (
    <div className="patch-countdown" role="status">
      <span className="patch-countdown-days">
        {next.days === 0 ? (
          <b>{t("Today")}</b>
        ) : (
          <>
            <b>{next.days}</b> {t(next.days === 1 ? "day" : "days")}
          </>
        )}
      </span>
      <span className="patch-countdown-text">
        <b>
          {t(next.days === 0 ? "Patch {patch} is out today" : next.days === 1 ? "Patch {patch} comes out tomorrow" : "Patch {patch} comes out in {n} days", v)}
        </b>
        <span className="sub">{t("{date} (Pacific Time)", { date: longDate(next.date, lang) })}</span>
        {note && <span className="sub">{note}</span>}
      </span>
    </div>
  );
}
