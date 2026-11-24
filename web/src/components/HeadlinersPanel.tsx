"use client";

import { useEffect, useState } from "react";
import { getParam, setParams } from "@/lib/url-state";
import { useT } from "./I18n";

// The Tier List's Headliners tab (Nico, 2026-11-24: one tab instead of three): Weapon of Destiny, Pentakill and
// HEARTSTEEL behind a switch. Each view keeps its old link (?tab=pentakill and so on, SubTabs aliases), so its table's
// search and sort still land on it. A view mounts the first time it's opened.
export type HeadlinerView = { id: string; label: string; node: React.ReactNode };

export default function HeadlinersPanel({ views }: { views: HeadlinerView[] }) {
  const t = useT("tier-list");
  const [view, setView] = useState(views[0]?.id);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  useEffect(() => {
    const sync = () => {
      const want = getParam("tab");
      setView(views.some((v) => v.id === want) ? want! : views[0]?.id);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [views]);
  useEffect(() => {
    if (view) setOpened((o) => (o.has(view) ? o : new Set(o).add(view)));
  }, [view]);
  if (views.length === 1) return <>{views[0].node}</>;
  const pick = (id: string) => {
    if (id === view) return;
    setView(id);
    // Search and sort belong to the view they were set on.
    setParams({ tab: id, q: null, sort: null }, { push: true });
  };
  return (
    <>
      <div className="seg champ-view" role="group" aria-label={t("Headliners")}>
        {views.map((v) => (
          <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => pick(v.id)}>
            {t(v.label)}
          </button>
        ))}
      </div>
      {views.map(
        (v) =>
          opened.has(v.id) && (
            <div key={v.id} hidden={view !== v.id}>
              {v.node}
            </div>
          ),
      )}
    </>
  );
}
