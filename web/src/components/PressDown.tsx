"use client";

import { useEffect } from "react";

// Buttons, tabs, chips and link cards sink a little while pressed and spring back on release.
// Uses the separate `scale` property through the Web Animations API, so it never fights a
// control's own transform or transitions. Bigger targets sink less. data-press="off" opts out;
// off with reduced motion.

const PRESSABLE = 'button, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], summary, a[href]';
// The spring: a quick overshoot past full size, then settle.
const SPRING = "cubic-bezier(0.34, 1.8, 0.64, 1)";

const reduced = () => document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;

function target(e: PointerEvent): HTMLElement | null {
  const el = (e.target as Element | null)?.closest?.(PRESSABLE) as HTMLElement | null;
  if (!el || el.closest('[data-press="off"]') || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return null;
  // Links inside running text stay put; so does anything you drag or draw on.
  if (el.matches("a") && (el.classList.contains("inline-link") || el.closest("p, li > p, .prose, td"))) return null;
  if (el.closest("canvas, input, textarea, select, [draggable='true']")) return null;
  return el;
}

export default function PressDown() {
  useEffect(() => {
    let pressed: { el: HTMLElement; anim: Animation; depth: number } | null = null;

    const release = () => {
      if (!pressed) return;
      const { el, anim, depth } = pressed;
      pressed = null;
      anim.cancel();
      el.animate([{ scale: depth }, { scale: 1 }], { duration: 420, easing: SPRING });
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || reduced()) return;
      const el = target(e);
      if (!el) return;
      release();
      const r = el.getBoundingClientRect();
      const big = Math.max(r.width, r.height);
      // About 3px of travel whatever the size, kept between a light and a firm press.
      const depth = Math.min(0.985, Math.max(0.94, 1 - 6 / Math.max(big, 1)));
      const anim = el.animate([{ scale: 1 }, { scale: depth }], { duration: 90, easing: "ease-out", fill: "forwards" });
      pressed = { el, anim, depth };
    };
    // Scrolling a touch screen after pressing cancels the press without a click.
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    document.addEventListener("dragstart", release, { passive: true });
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      document.removeEventListener("dragstart", release);
      window.removeEventListener("blur", release);
    };
  }, []);
  return null;
}
