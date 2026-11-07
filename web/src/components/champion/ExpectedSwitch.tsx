"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";

// The champion page's Expected switch, above the build panels: off shows each build's real win rate; on shows the
// expected one, which leans on the estimate when a build has few games of its own (data/estimates/synergies.py),
// with every row labelled Real or Expected. The choice is kept for the visitor's next pages.

const KEY = "deeparam-expected";

export default function ExpectedSwitch() {
  const t = useT("champions");
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "1") setOn(true);
    } catch {
      /* storage blocked: the switch starts off */
    }
  }, []);
  useEffect(() => {
    if (on) document.documentElement.dataset.expected = "1";
    else delete document.documentElement.dataset.expected;
    return () => {
      delete document.documentElement.dataset.expected;
    };
  }, [on]);
  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* storage blocked: the choice lasts for this page */
    }
  };
  return (
    <div className="cp-xp">
      <button type="button" role="switch" aria-checked={on} className="chip-toggle" onClick={toggle}>
        {t("Expected")}
      </button>
      <span>{t("Builds with few games lean on the estimate: how much of a rare build's lead usually holds up.")}</span>
    </div>
  );
}
