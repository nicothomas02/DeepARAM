"use client";

import { useState, type ReactNode } from "react";
import { T } from "@/components/I18n";

// Build style tabs on the champion card (lib/build-plan.ts styleCores): one tab per real style, e.g. Tank and AP
// for Alistar-like champions. The server renders every panel; this only picks which one shows.
// `whole`: the tabs switch the whole card (every tile), so each panel lays its tiles out like the card itself.
export default function StyleTabs({ tabs, whole = false }: { tabs: { key: string; label: string; share: string; panel: ReactNode }[]; whole?: boolean }) {
  const [on, setOn] = useState(0);
  return (
    <div className="cp-style-tabs">
      <div className="cp-style-tablist" role="tablist">
        {tabs.map((t, i) => (
          <button key={t.key} type="button" role="tab" aria-selected={i === on} className={i === on ? "on" : undefined} onClick={() => setOn(i)}>
            <T ns="champions">{t.label}</T> <small>{t.share}</small>
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.key} role="tabpanel" hidden={i !== on} className={whole ? "cp-style-panel cp-style-whole" : "cp-style-panel"}>
          {t.panel}
        </div>
      ))}
    </div>
  );
}
