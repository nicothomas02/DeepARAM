"use client";

import { useEffect, useState } from "react";
import { buzz } from "@/lib/haptics";
import { setParams } from "@/lib/url-state";
import { useT } from "./I18n";

// In-page tabs. Panels are rendered on the server and this only switches which is visible,
// except `lazy` ones, which mount the first time they're opened (so they can load their own data then).
// With `ns`, tab labels are translated from that namespace.
export default function SubTabs({
  tabs,
  ns,
}: {
  tabs: {
    id: string;
    label: string;
    content: React.ReactNode;
    lazy?: boolean;
  }[];
  ns?: string;
}) {
  const tr = useT(ns);
  const label = (l: string) => (ns ? tr(l) : l);
  const [active, setActive] = useState(tabs[0]?.id);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (active) setOpened((s) => (s.has(active) ? s : new Set(s).add(active)));
  }, [active]);
  // ?tab=<id> opens that tab, so links from the home page and search land on the right one.
  useEffect(() => {
    const want = new URLSearchParams(location.search).get("tab");
    if (want && tabs.some((t) => t.id === want)) setActive(want);
  }, [tabs]);
  return (
    <div className="subtabs">
      <div className="subtab-list" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => {
              if (t.id !== active) buzz("step");
              setActive(t.id);
              // Search and sort belong to the tab they were set on.
              setParams({
                tab: t.id === tabs[0]?.id ? null : t.id,
                q: null,
                sort: null,
              });
            }}
          >
            {label(t.label)}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id}>
          {(!t.lazy || opened.has(t.id)) && t.content}
        </div>
      ))}
    </div>
  );
}
