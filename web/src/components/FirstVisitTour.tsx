"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useT } from "./I18n";

// A short guided tour of Home: a spotlight moves over a few key places with a line about each. It never
// opens by itself: first-time visitors get a small "Take a quick tour" chip under the headline (TourChip),
// which starts it or can be dismissed; either ends the offer for this browser (localStorage). Settings'
// "Take the tour" or /?tour replays it.

const KEY = "deeparam-tour";
/** Fired by Settings' "Take the tour" link. */
export const TOUR_EVENT = "deeparam-tour";

const STEPS: { sel: string[]; title: string; body: string }[] = [
  { sel: ['.site-header .nav a[href="/tier-list"]', '.tabbar a[href="/tier-list"]'], title: "Tier List", body: "Every champion and augment ranked on the live patch. Pick older patches from the list." },
  { sel: ['.site-header .nav a[href="/simulator"]', '.tabbar a[href="/simulator"]'], title: "Simulator", body: "Simulated teamfights and builds for every champion." },
  { sel: [".search-btn"], title: "Search anything", body: "Champions, augments, items and pages. Press / or Ctrl+K from anywhere." },
  { sel: ['.site-header [aria-label="Settings"]'], title: "Make it yours", body: "Light or dark theme, less motion, sound and graphics. Saved in this browser." },
];

const visible = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).offsetParent !== null && el.getBoundingClientRect().width > 0;
const find = (sels: string[]) => sels.map((s) => document.querySelector(s)).find(visible) ?? null;

export default function FirstVisitTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [steps, setSteps] = useState<typeof STEPS>([]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [asked, setAsked] = useState(0);
  const t = useT();
  useEffect(() => {
    const ask = () => setAsked((n) => n + 1);
    addEventListener(TOUR_EVENT, ask);
    return () => removeEventListener(TOUR_EVENT, ask);
  }, []);

  useEffect(() => {
    if (pathname !== "/") return;
    if (!asked && !new URLSearchParams(location.search).has("tour")) return;
    const t = setTimeout(() => {
      const ok = STEPS.filter((s) => find(s.sel));
      if (ok.length) {
        setI(0);
        setSteps(ok);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [pathname, asked]);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(KEY, "done");
    } catch {}
    setSteps([]);
    if (new URLSearchParams(location.search).has("tour")) router.replace("/", { scroll: false });
  }, [router]);

  const step = steps[i];
  useLayoutEffect(() => {
    if (!step) return;
    const el = find(step.sel);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    const place = () => setRect(el.getBoundingClientRect());
    place();
    addEventListener("resize", place);
    addEventListener("scroll", place, { passive: true });
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place);
    };
  }, [step]);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (i < steps.length - 1) setI(i + 1);
        else finish();
      }
      else if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [step, i, steps.length, finish]);

  if (!step || !rect) return null;
  const pad = 8;
  const below = rect.bottom + 200 < innerHeight;
  const left = Math.min(Math.max(16, rect.left + rect.width / 2 - 160), innerWidth - 336);
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-hole" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="tour-card" style={below ? { left, top: rect.bottom + pad + 12 } : { left, top: rect.top - pad - 12, translate: "0 -100%" }}>
        <p className="tour-count">
          {t("{i} of {n}", { i: i + 1, n: steps.length })}
        </p>
        <h2 id="tour-title">{t(step.title)}</h2>
        <p>{t(step.body)}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={finish}>
            {i === steps.length - 1 ? t("Close") : t("Skip tour")}
          </button>
          {i > 0 && (
            <button type="button" className="btn ghost" onClick={() => setI(i - 1)}>
              {t("Back")}
            </button>
          )}
          <button type="button" className="btn" autoFocus onClick={() => (i < steps.length - 1 ? setI(i + 1) : finish())}>
            {i < steps.length - 1 ? t("Next") : t("Done")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Home's offer of the tour for first-time visitors: starts it, or × hides the offer for good. */
export function TourChip() {
  const [show, setShow] = useState(false);
  const t = useT();
  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "done");
    } catch {}
  }, []);
  if (!show) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "done");
    } catch {}
    setShow(false);
  };
  return (
    <span className="tour-chip">
      <button type="button" onClick={() => (close(), dispatchEvent(new Event(TOUR_EVENT)))}>
        {t("New here? Take a quick tour")}
      </button>
      <button type="button" className="tour-chip-x" aria-label={t("Dismiss")} onClick={close}>
        ×
      </button>
    </span>
  );
}
