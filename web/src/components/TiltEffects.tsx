"use client";

import { useEffect } from "react";
import { loadSettings } from "@/lib/settings";

// Cards marked data-tilt lean toward the cursor and catch a shimmer in their rarity's color
// (data-rarity: silver, gold, prismatic). data-tilt="soft" leans less, for wide rows. Anything marked
// data-parallax gets --px and --py (-0.5 to 0.5 from its centre), so its splash art can shift the other
// way and seem to sit behind it.
// Mouse and pen only; off with reduced motion or Low graphics.

const MAX = { strong: 12, soft: 3 };

export default function TiltEffects() {
  useEffect(() => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const off = () =>
      document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches || loadSettings().graphics === "low";
    let current: HTMLElement | null = null;
    const reset = (el: HTMLElement) => {
      el.removeAttribute("data-tilting");
      el.style.removeProperty("--rx");
      el.style.removeProperty("--ry");
      el.style.removeProperty("--px");
      el.style.removeProperty("--py");
    };
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tilt], [data-parallax]") as HTMLElement | null;
      if (current && current !== el) reset(current);
      current = el;
      if (!el || off()) return;
      const r = el.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      el.setAttribute("data-tilting", "");
      if (el.hasAttribute("data-parallax")) {
        el.style.setProperty("--px", (fx - 0.5).toFixed(3));
        el.style.setProperty("--py", (fy - 0.5).toFixed(3));
      }
      if (el.hasAttribute("data-tilt")) {
        const max = el.dataset.tilt === "soft" ? MAX.soft : MAX.strong;
        el.style.setProperty("--rx", `${((0.5 - fy) * max).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${((fx - 0.5) * max).toFixed(2)}deg`);
      }
      el.style.setProperty("--mx", `${(fx * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(fy * 100).toFixed(1)}%`);
    };
    const onLeave = () => current && (reset(current), (current = null));
    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return null;
}
