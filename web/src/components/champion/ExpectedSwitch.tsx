"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";

// The champion page's Adjusted / Raw switch, above the build panels (Nico, 2026-11-20). Adjusted, the default, shows
// each build's expected win rate, which leans on the estimate when a build has few games of its own
// (data/estimates/synergies.py), and leaves out items only an augment hands out; Raw shows the plain numbers. Rows
// are labelled Real or Expected. The choice is kept for the visitor's next pages.

const KEY = "deeparam-expected";

export default function ExpectedSwitch() {
  const t = useT("champions");
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "0") setOn(false);
    } catch {
      /* storage blocked: Adjusted stays on */
    }
  }, []);
  useEffect(() => {
    // Adjusted is the page's state with no attribute, so it is what renders before this runs; Raw sets data-raw.
    if (on) delete document.documentElement.dataset.raw;
    else document.documentElement.dataset.raw = "1";
    return () => {
      delete document.documentElement.dataset.raw;
    };
  }, [on]);
  const choose = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* storage blocked: the choice lasts for this page */
    }
  };
  return (
    <div className="cp-xp">
      <div className="seg" role="group" aria-label={t("Build numbers")}>
        <button type="button" aria-pressed={on} onClick={() => choose(true)}>
          {t("Adjusted")}
        </button>
        <button type="button" aria-pressed={!on} onClick={() => choose(false)}>
          {t("Raw")}
        </button>
      </div>
      <span>
        {t(
          on
            ? "Adjusted leaves out items only an augment gives you, and builds with few games lean on the estimate."
            : "Raw shows every build's plain win rate, including items an augment gives you.",
        )}
      </span>
    </div>
  );
}
