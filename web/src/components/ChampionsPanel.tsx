"use client";

import { useEffect, useState } from "react";
import { getParam, setParams } from "@/lib/url-state";
import { useT } from "./I18n";

// The Tier List's Champions tab: single champions, Duos (?cview=duos) or Best pick (?cview=team), so the three main
// tabs stay Champions, Augments and Items. Duos and Best pick mount the first time they're opened, since they load
// their own data. Old ?tab=duos links land here.
type View = "solo" | "duos" | "team";

export default function ChampionsPanel({
  solo,
  duos,
  team,
}: {
  solo: React.ReactNode;
  duos?: React.ReactNode;
  team?: React.ReactNode;
}) {
  const t = useT("tier-list");
  const [view, setView] = useState<View>("solo");
  const [opened, setOpened] = useState<Set<View>>(new Set());
  useEffect(() => {
    if (duos && getParam("tab") === "duos") {
      setParams({ tab: null, cview: "duos" });
      setView("duos");
    } else if (duos && getParam("cview") === "duos") setView("duos");
    else if (team && getParam("cview") === "team") setView("team");
  }, [duos, team]);
  useEffect(() => {
    if (view !== "solo")
      setOpened((o) => (o.has(view) ? o : new Set(o).add(view)));
  }, [view]);
  if (!duos && !team) return <>{solo}</>;
  const pick = (v: View) => {
    if (v === view) return;
    setView(v);
    // Search, sort and the team belong to the view they were set on.
    setParams({
      cview: v === "solo" ? null : v,
      q: null,
      sort: null,
      team: null,
      opts: null,
    });
  };
  const views: [View, string, React.ReactNode][] = [
    ["solo", "Champions", solo],
    ...(duos
      ? [["duos", "Duos", duos] as [View, string, React.ReactNode]]
      : []),
    ...(team
      ? [["team", "Best pick", team] as [View, string, React.ReactNode]]
      : []),
  ];
  return (
    <>
      <div className="seg champ-view" role="group" aria-label={t("Champions")}>
        {views.map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => pick(v)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {views.map(([v, , node]) =>
        v === "solo" ? (
          <div key={v} hidden={view !== v}>
            {node}
          </div>
        ) : (
          opened.has(v) && (
            <div key={v} hidden={view !== v}>
              {node}
            </div>
          )
        ),
      )}
    </>
  );
}
