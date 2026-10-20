"use client";

import { useEffect, useState } from "react";
import Embed from "@/components/Embed";
import { useT } from "@/components/I18n";

// "?r=2": the owner's browser may still hold the old owner-only full.html, which was cached privately for a day.
const FULL = "/embed/simulator/full.html?r=2";
const LITE = "/embed/simulator/index.html?r=2";
// A new key: the old owner-only switch saved "2d" under "deeparam-sim-view", which must not carry over.
const LITE_KEY = "deeparam-sim-fewer-animations";

// The 1v1 tab: the 3D replay (champion models) by default, or the 2D one with champion icons when the
// visitor picks "Show fewer animations". Both run the same fights, panel, sounds and controls; only
// the arena's drawing differs. The pick is remembered on this device.
export default function SimReplayEmbed() {
  const t = useT("simulator");
  const [lite, setLite] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(LITE_KEY) === "1") setLite(true);
      localStorage.removeItem("deeparam-sim-view");
    } catch {
      // Storage blocked: 3D stays the default.
    }
  }, []);
  const toggle = () => {
    const next = !lite;
    setLite(next);
    try {
      localStorage.setItem(LITE_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the pick lasts until the page closes.
    }
  };
  const src = lite ? LITE : FULL;
  return (
    <>
      <div className="sim-view-switch">
        <button type="button" role="switch" aria-checked={lite} className="chip-toggle" onClick={toggle}>
          {t("Show fewer animations")}
        </button>
      </div>
      <Embed key={src} src={src} title="Mayhem fight replay" minHeight={900} />
    </>
  );
}
