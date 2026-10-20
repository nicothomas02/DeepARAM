"use client";

import { useEffect, useState } from "react";
import { getParam, setParams } from "@/lib/url-state";
import { useT } from "./I18n";

// The Tier List's Champions tab: single champions, or Duos (?cview=duos), so the three main tabs stay Champions,
// Augments and Items. Duos mounts the first time it's opened, since it loads its own data. Old ?tab=duos links land here.
export default function ChampionsPanel({ solo, duos }: { solo: React.ReactNode; duos?: React.ReactNode }) {
  const t = useT("tier-list");
  const [view, setView] = useState<"solo" | "duos">("solo");
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!duos) return;
    if (getParam("tab") === "duos") {
      setParams({ tab: null, cview: "duos" });
      setView("duos");
    } else if (getParam("cview") === "duos") setView("duos");
  }, [duos]);
  useEffect(() => {
    if (view === "duos") setOpened(true);
  }, [view]);
  if (!duos) return <>{solo}</>;
  const pick = (v: "solo" | "duos") => {
    if (v === view) return;
    setView(v);
    // Search and sort belong to the view they were set on.
    setParams({ cview: v === "duos" ? "duos" : null, q: null, sort: null });
  };
  return (
    <>
      <div className="seg champ-view" role="group" aria-label={t("Champions")}>
        <button type="button" aria-pressed={view === "solo"} onClick={() => pick("solo")}>
          {t("Champions")}
        </button>
        <button type="button" aria-pressed={view === "duos"} onClick={() => pick("duos")}>
          {t("Duos")}
        </button>
      </div>
      <div hidden={view !== "solo"}>{solo}</div>
      {opened && <div hidden={view !== "duos"}>{duos}</div>}
    </>
  );
}
