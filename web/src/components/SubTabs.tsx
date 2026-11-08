"use client";

import { useEffect, useRef, useState } from "react";
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
  // Each tab is a Back step: Back and Forward reopen the tab the address names.
  useEffect(() => {
    const sync = () => {
      const want = new URLSearchParams(location.search).get("tab");
      setActive(want && tabs.some((t) => t.id === want) ? want : tabs[0]?.id);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [tabs]);
  // On a phone the tab row scrolls sideways: keep the open tab in view (a deep link to the last tab used to land with
  // it off screen). Only the row scrolls, never the page.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = list.current;
    const tab = row?.querySelector<HTMLElement>(`#tab-${CSS.escape(active ?? "")}`);
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    const left = tab.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    if (left < row.scrollLeft || left + tab.offsetWidth > row.scrollLeft + row.clientWidth)
      row.scrollTo({ left: Math.max(0, left - (row.clientWidth - tab.offsetWidth) / 2) });
  }, [active]);
  return (
    <div className="subtabs">
      <div className="subtab-list" role="tablist" ref={list}>
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
              }, { push: true });
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
