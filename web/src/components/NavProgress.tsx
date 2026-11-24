"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// A thin bar at the top of the page while the next page loads (Nico, 2026-11-24: "loading animation if page is
// taking a while to load"). It only shows after a short delay (CSS, .nav-progress), so fast page changes never flash it.

const SKIP = /^\/(api|data|embed|assets|icons)\//;

export default function NavProgress() {
  const pathname = usePathname();
  const bar = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    delete bar.current?.dataset.on;
  };

  // The new page has rendered.
  useEffect(stop, [pathname]);

  useEffect(() => {
    const start = () => {
      if (!bar.current) return;
      bar.current.dataset.on = "";
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(stop, 15000); // never spin forever
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if ((e.target as Element | null)?.closest?.("[data-no-link]")) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
      const url = new URL(a.href);
      if (url.pathname === location.pathname || SKIP.test(url.pathname)) return;
      start();
    };
    const onPop = () => requestAnimationFrame(() => {
      // Back/forward: the address has already changed; usePathname catches up when the page renders.
      if (location.pathname !== pathname) start();
    });
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, [pathname]);

  return <div ref={bar} className="nav-progress" aria-hidden="true" />;
}
