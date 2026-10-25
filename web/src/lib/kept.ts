"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// "Show all" and "Show more" toggles (and the page they show) that survive leaving the page and coming back
// with the Back button. Each toggle saves its state for the page in this tab (sessionStorage), and on a back or
// forward visit puts it back, then returns the page to where it was scrolled, since the restored rows change
// the page's height. A fresh visit by link starts every toggle closed as before. A toggle is told apart from the
// page's others by where its element sits among them (data-kept), the same on every visit to the page.

const PREFIX = "deeparam-kept:";
const SCROLL = "deeparam-kept-scroll:";

let returning = false;
let scrollQueued = false;
let returnTimer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
let returnY = 0;

const pageKey = () => location.pathname + location.search;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav?.type === "back_forward") markReturning();
  } catch {}
  window.addEventListener("popstate", markReturning);
  let frame = 0;
  window.addEventListener(
    "scroll",
    () => {
      // Until the toggles are restored the page is shorter than it was, so its scroll isn't worth saving.
      if (frame || returning) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          sessionStorage.setItem(
            SCROLL + pageKey(),
            String(Math.round(scrollY)),
          );
        } catch {}
      });
    },
    { passive: true },
  );
}

// The page that mounts next comes from the Back or Forward button.
function markReturning() {
  returning = true;
  try {
    returnY = Number(sessionStorage.getItem(SCROLL + pageKey())) || 0;
  } catch {}
  clearTimeout(returnTimer);
  returnTimer = setTimeout(() => (returning = false), 1500);
}

// Once the restored toggles have laid out, scroll back to where the page was.
function restoreScroll() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      scrollQueued = false;
      if (returnY > 0) scrollTo(0, returnY);
    }),
  );
}

listen();

/** The data-kept attribute for a toggle's element, which useKept finds it by. */
export const KEPT = { "data-kept": "" };

/** useState for a show more/all toggle, kept for this page across Back and Forward. `el` is the toggle's element,
 * marked with KEPT; `name` tells apart several states of one toggle. */
export function useKept<T>(
  initial: T,
  el: RefObject<HTMLElement | null>,
  name = "",
): [T, (v: T) => void] {
  const [value, setValue] = useState(initial);
  const key = useRef("");
  const keyOf = () => {
    if (!key.current && el.current) {
      const at = [...document.querySelectorAll("[data-kept]")].indexOf(
        el.current,
      );
      key.current = `${PREFIX}${pageKey()}#${at}${name}`;
    }
    return key.current;
  };
  useEffect(() => {
    listen();
    const k = keyOf();
    if (!returning || !k) return;
    try {
      const saved = sessionStorage.getItem(k);
      if (saved === null) return;
      const v = JSON.parse(saved) as T;
      if (JSON.stringify(v) === JSON.stringify(initial)) return;
      setValue(v);
      restoreScroll();
    } catch {}
    // Restores once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (v: T) => {
    setValue(v);
    try {
      const k = keyOf();
      if (k) sessionStorage.setItem(k, JSON.stringify(v));
    } catch {}
  };
  return [value, set];
}
