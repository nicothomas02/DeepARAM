"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { savedView } from "@/lib/url-state";

// Smooth page changes: every in-site link click runs inside a View Transition, so pages cross-fade
// and a champion's icon (or the Tier List panel's splash) morphs into the champion page's hero.
// Skipped where the browser lacks View Transitions or motion is reduced (OS setting or gear menu).

type VT = { ready: Promise<void>; finished: Promise<void> };
type Doc = Document & { startViewTransition?: (cb: () => Promise<void>) => VT };

const reduced = () => document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function PageTransitions() {
  const router = useRouter();
  const pathname = usePathname();
  const done = useRef<(() => void) | null>(null);

  // The new page has rendered: let the transition capture it.
  useEffect(() => {
    const finish = done.current;
    done.current = null;
    if (finish) requestAnimationFrame(() => finish());
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const doc = document as Doc;
      if (!doc.startViewTransition || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
      const url = new URL(a.href);
      if (url.pathname === location.pathname || /^\/(api|data|embed|assets|icons)\//.test(url.pathname) || reduced()) return;
      e.preventDefault();

      // The champion being opened, if any: its icon in the link, or the open panel's splash.
      const champ = url.pathname.match(/^\/champions\/([^/]+)$/)?.[1];
      const named: HTMLElement[] = [];
      const name = (el: Element | null | undefined, n: string) => {
        if (!(el instanceof HTMLElement)) return;
        el.style.setProperty("view-transition-name", n);
        named.push(el);
      };
      if (champ) {
        name(a.querySelector(`img[src*="/icons/champions/${champ}."]`), "champ-icon");
        if (!named.length) name(a.closest("dialog")?.querySelector(".champ-splash"), "champ-hero");
      }

      // A plain link to a remembered page opens its saved view (lib/url-state.ts, ViewMemory).
      const target = url.pathname + (url.search || savedView(url.pathname)) + url.hash;
      const vt = doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            named.forEach((el) => el.style.removeProperty("view-transition-name"));
            done.current = resolve;
            a.closest("dialog")?.close();
            router.push(target);
            setTimeout(resolve, 1200); // never hold the page if the route doesn't change
          }),
      );
      // The browser drops the animation when the tab is hidden or the window resizes mid-change. The
      // page still changes; only the animation is skipped, so that isn't an error.
      vt.ready.catch(() => {});
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
