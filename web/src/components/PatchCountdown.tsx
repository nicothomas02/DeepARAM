"use client";

import { useEffect, useState } from "react";
import { awaitingData, nextPatch, type NextPatch, type PatchSchedule } from "@/lib/patch-schedule";
import { patchName, patchVersion } from "@/lib/patch-name";
import { setOf } from "@/lib/sets";
import { useLang, useT } from "./I18n";

// Countdown to the next patch on Riot's schedule. Once a patch is out but the stats (dataPatch, the newest patch they
// cover) haven't reached it yet, it says that patch is live instead, and counts down to the one after once they have. The server renders it as of the build (asOf, so the first
// browser render matches it); the browser recomputes it on load and every minute so a cached page stays right, and moves on to the next patch once one comes out. Its wording is in /i18n/patch-countdown/.
export default function PatchCountdown({ schedule, asOf, dataPatch, note }: { schedule: PatchSchedule; asOf: string; dataPatch?: string | null; note?: React.ReactNode }) {
  const [next, setNext] = useState<NextPatch | null>(() => nextPatch(schedule, new Date(asOf)));
  const [live, setLive] = useState(() => awaitingData(schedule, dataPatch, new Date(asOf)));
  const t = useT("patch-countdown");
  const ts = useT("patches");
  const lang = useLang();
  const [mine, setMine] = useState(false); // the visitor's own time zone, known only in the browser
  useEffect(() => {
    const tick = () => {
      setNext(nextPatch(schedule));
      setLive(awaitingData(schedule, dataPatch));
    };
    tick();
    setMine(true);
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [schedule, dataPatch]);

  if (live) {
    const version = patchVersion(live.patch);
    const set = setOf(version);
    const v = { patch: patchName(live.patch), set: ts(set.name) };
    return (
      <div className="patch-countdown" role="status">
        <span className="patch-countdown-days">
          <b>{v.patch}</b>
        </span>
        <span className="patch-countdown-text">
          <b>{t(set.first === version ? "{set} (Patch {patch}) is live!" : "Patch {patch} is live!", v)}</b>
          <span className="sub">{t("New patch data takes a couple of days to collect.")}</span>
          {note && <span className="sub">{note}</span>}
        </span>
      </div>
    );
  }
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
        {next.days === 0 ? (
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
          {t(next.days === 0 ? "Patch {patch} comes out in under 24 hours" : next.days === 1 ? "Patch {patch} comes out tomorrow" : "Patch {patch} comes out in {n} days", v)}
        </b>
        <span className="sub">{when}</span>
        {note && <span className="sub">{note}</span>}
      </span>
    </div>
  );
}
