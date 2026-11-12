"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { REMEMBERED, savedView } from "@/lib/url-state";

// A plain link to a remembered page (/tier-list, not /tier-list?tab=…) opens the view it was left in
// (lib/url-state.ts). Runs before the link's own handler, so every menu and tab bar gets it; when
// PageTransitions has already taken the click it applies the same view itself.
export default function ViewMemory() {
  const router = useRouter();
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      // A control inside a row link that handles its own click (data-no-link) doesn't open the link.
      if ((e.target as Element | null)?.closest?.("[data-no-link]")) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      const url = new URL(a.href);
      if (url.origin !== location.origin || url.search || !REMEMBERED.includes(url.pathname) || url.pathname === location.pathname) return;
      const view = savedView(url.pathname);
      if (!view) return;
      e.preventDefault();
      e.stopPropagation();
      router.push(url.pathname + view + url.hash);
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, [router]);
  return null;
}
