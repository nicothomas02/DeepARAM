"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { buzz, inApp } from "@/lib/haptics";

// Phone gestures. A sideways swipe that starts inside an element marked data-swipe-target goes to that
// element, as a "deeparam-swipe" event ({detail: {dir}}); elsewhere sideways swipes do nothing (they no
// longer switch tabs or pages).
// Pulling down at the top of a page refreshes it in
// place, with a tick when it's far enough and a buzz when the fresh page is in. It replaces the
// browser's own pull (turned off while this is on); the DeepARAM app has its native one, so not there.
// Touch screens only.

const MIN_X = 70;
const EDGE = 24; // leave the screen edges to the system's back and forward gestures

// Don't take swipes that start on something that scrolls or drags sideways itself.
function ownsSideways(el: Element | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.matches("input, select, textarea, canvas, iframe, video, [data-no-swipe], [draggable='true'], dialog")) return true;
    const ox = getComputedStyle(n).overflowX;
    if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

export default function SwipeGestures() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // The refreshed page is in: stop spinning (after a beat, so it reads as a refresh) and say so.
  useEffect(() => {
    if (pending || !refreshing) return;
    const t = setTimeout(() => {
      setRefreshing(false);
      buzz("done");
    }, 450);
    return () => clearTimeout(t);
  }, [pending, refreshing]);

  useEffect(() => {
    if (!matchMedia("(pointer: coarse)").matches) return;
    const pullable = !inApp();
    const root = document.documentElement;
    if (pullable) root.style.overscrollBehaviorY = "contain";
    let start: { x: number; y: number; t: number; sideways: boolean; top: boolean; owner: Element | null } | null = null;

    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) return (start = null);
      const p = e.touches[0];
      const target = e.target as Element;
      start = {
        x: p.clientX,
        y: p.clientY,
        t: performance.now(),
        owner: target.closest("[data-swipe-target]"),
        sideways: p.clientX > EDGE && p.clientX < innerWidth - EDGE && !ownsSideways(target),
        top: pullable && scrollY <= 0 && !target.closest("dialog, .sheet, [data-no-swipe]"),
      };
    };
    const move = (e: TouchEvent) => {
      if (!start?.top) return;
      const dy = e.touches[0].clientY - start.y;
      const dx = Math.abs(e.touches[0].clientX - start.x);
      if (dy <= 0 || dx > dy || scrollY > 0) {
        if (pullRef.current) setPull((pullRef.current = 0));
        return;
      }
      // Resist the further it goes, like the system's own; a tick when it is far enough to refresh.
      const next = Math.min(110, dy * 0.5);
      if (next >= 70 && pullRef.current < 70) buzz("tap");
      setPull((pullRef.current = next));
    };
    const up = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s) return;
      if (pullRef.current) {
        const go = pullRef.current >= 70;
        setPull((pullRef.current = 0));
        if (go) {
          setRefreshing(true);
          startTransition(() => router.refresh());
        }
        return;
      }
      const p = e.changedTouches[0];
      const dx = p.clientX - s.x;
      const dy = p.clientY - s.y;
      if (!s.owner?.isConnected || !s.sideways || performance.now() - s.t > 700 || Math.abs(dx) < MIN_X || Math.abs(dx) < Math.abs(dy) * 2) return;
      if (getSelection()?.toString()) return;
      const dir = dx < 0 ? 1 : -1;
      buzz("step");
      s.owner.dispatchEvent(new CustomEvent("deeparam-swipe", { detail: { dir } }));
    };

    addEventListener("touchstart", down, { passive: true });
    addEventListener("touchmove", move, { passive: true });
    addEventListener("touchend", up, { passive: true });
    const cancel = () => {
      start = null;
      setPull((pullRef.current = 0));
    };
    addEventListener("touchcancel", cancel);
    return () => {
      root.style.removeProperty("overscroll-behavior-y");
      removeEventListener("touchstart", down);
      removeEventListener("touchmove", move);
      removeEventListener("touchend", up);
      removeEventListener("touchcancel", cancel);
    };
  }, [router]);

  if (!pull && !refreshing) return null;
  const ready = pull >= 70 || refreshing;
  return (
    <div className="ptr" data-ready={ready || undefined} data-spin={refreshing || undefined} style={{ transform: `translate(-50%, ${refreshing ? 70 : pull}px)` }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: `rotate(${pull * 3}deg)` }}>
        <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />
      </svg>
    </div>
  );
}
