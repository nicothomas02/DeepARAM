"use client";

import { useEffect, useRef, useState } from "react";
import { loadSettings, SETTINGS_EVENT } from "@/lib/settings";
import { adminFlag } from "@/lib/admin-flag";

// A rotatable 3D model of the champion, idling, in the champion page's hero. Drag to turn it.
// Admins only (the models are admin-only files). Off on Low graphics or without WebGL; reduced motion keeps it still. The renderer (lib/showcase3d.ts)
// only loads once the hero is on screen.

const allowed = () => {
  // The models are admin-only files (src/middleware.ts); everyone else sees the splash art.
  if (!adminFlag()) return false;
  const s = loadSettings();
  if (s.graphics === "low") return false;
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
};
const still = () => loadSettings().motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function ChampionShowcase({ alias, name }: { alias: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"wait" | "off" | "loading" | "ready">("wait");
  const [key, setKey] = useState(0);

  useEffect(() => {
    const bump = () => setKey((k) => k + 1);
    addEventListener(SETTINGS_EVENT, bump);
    return () => removeEventListener(SETTINGS_EVENT, bump);
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !allowed()) return setState("off");
    setState("wait");
    let stop: (() => void) | null = null;
    let cancelled = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      setState("loading");
      import("@/lib/showcase3d")
        .then((m) => m.mount(el, alias, { animate: !still() }))
        .then((s) => (cancelled ? s() : ((stop = s), setState("ready"))))
        .catch(() => !cancelled && setState("off"));
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      stop?.();
    };
  }, [alias, key]);

  // Narrows the hero text beside the model (globals.css; :has() does it where supported).
  useEffect(() => {
    const hero = canvas.current?.closest(".champ-hero");
    hero?.classList.toggle("has-showcase", state !== "off");
    return () => hero?.classList.remove("has-showcase");
  }, [state]);

  return (
    <div className="showcase" data-state={state} hidden={state === "off"}>
      <canvas key={key} ref={canvas} aria-label={`3D model of ${name}. Drag to turn it.`} role="img" />
      {state === "ready" && <span className="showcase-hint">Drag to turn</span>}
    </div>
  );
}
