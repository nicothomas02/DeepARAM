"use client";

import { useEffect } from "react";
import { buzz, hapticsAvailable, type HapticKind } from "@/lib/haptics";

// Page-wide haptics: a light tap on buttons, toggles, tabs and menu links, a firmer step on tab
// switches and choices, and a light tick each time a strip snaps to its next stop or a slider moves a
// step. It listens after the page's own handlers, so a control's own buzz (a "done", say) plays first
// and this one is skipped as a repeat; data-haptic="off" opts an element out. Embedded tools on the
// site (the Simulator) ask for one with postMessage({type: "deeparam-haptic", kind}).

const TAP = 'button, [role="button"], [role="switch"], [role="menuitem"], summary, .chip-toggle, .nav a, .nav-menu a, .tabbar a, .sheet a, .recent-item';
const STEP = '[role="tab"], [aria-pressed], input[type="checkbox"], input[type="radio"]';

export default function HapticTaps() {
  useEffect(() => {
    if (!hapticsAvailable()) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(`${STEP}, ${TAP}`);
      if (!el || el.closest('[data-haptic="off"]') || (el as HTMLButtonElement).disabled) return;
      buzz(el.matches(STEP) ? "step" : "tap");
    };
    const onChange = (e: Event) => {
      if ((e.target as Element | null)?.matches?.("select")) buzz("step");
    };
    const onInput = (e: Event) => {
      const el = e.target as HTMLInputElement | null;
      if (el?.type === "range" && !el.closest('[data-haptic="off"]')) buzz("tick");
    };
    const onSnap = (e: Event) => {
      if (!(e.target as Element | null)?.closest?.('[data-haptic="off"]')) buzz("tick");
    };
    const KINDS: HapticKind[] = ["tap", "step", "done", "tick", "thud", "win"];
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== "deeparam-haptic" || !KINDS.includes(e.data.kind)) return;
      buzz(e.data.kind);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("input", onInput);
    document.addEventListener("scrollsnapchange", onSnap, true);
    addEventListener("message", onMessage);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("change", onChange);
      document.removeEventListener("input", onInput);
      document.removeEventListener("scrollsnapchange", onSnap, true);
      removeEventListener("message", onMessage);
    };
  }, []);
  return null;
}
