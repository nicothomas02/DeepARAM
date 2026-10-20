"use client";

import { useEffect, useState } from "react";
import Embed from "@/components/Embed";
import { useT } from "@/components/I18n";

const FULL = "/embed/simulator/full.html";
const LITE = "/embed/simulator/index.html";
const VIEW_KEY = "deeparam-sim-view";

// The 1v1 tab: the 3D replay (champion models) by default, or the 2D one with champion icons when the
// visitor picks "Show fewer animations". Both run the same fights, panel, sounds and controls; only
// the arena's drawing differs. The pick is remembered on this device.
export default function SimReplayEmbed() {
  const t = useT("simulator");
  const [lite, setLite] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "2d") setLite(true);
    } catch {
      // Storage blocked: 3D stays the default.
    }
  }, []);
  const toggle = () => {
    const next = !lite;
    setLite(next);
    try {
      localStorage.setItem(VIEW_KEY, next ? "2d" : "3d");
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
