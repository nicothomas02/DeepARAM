"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Home is a saved page: a browser can show a copy from an earlier day (a restored tab, the back button,
// an installed app resumed), while The Kitchen loads the special fresh. This checks the current special
// on load and whenever the page comes back into view, and reloads Home's data when it has changed.
export const latestSpecial = () =>
  fetch(`/data/chef-special.json?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ id: string | null }>) : null))
    .then((v) => v?.id ?? null)
    .catch(() => null);

export default function FreshChefSpecial({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => {
    let busy = false;
    const look = async () => {
      if (busy) return;
      busy = true;
      const latest = await latestSpecial();
      busy = false;
      if (latest && latest !== id) router.refresh();
    };
    look();
    const onVisible = () => document.visibilityState === "visible" && look();
    const onShow = (e: PageTransitionEvent) => e.persisted && look();
    document.addEventListener("visibilitychange", onVisible);
    addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("pageshow", onShow);
    };
  }, [id, router]);
  return null;
}
