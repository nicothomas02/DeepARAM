"use client";

import { useEffect, useState } from "react";
import { useT } from "./I18n";

// Notices when a new version of the site goes live while a tab is open (every 10 minutes, and when the
// tab comes back into view) and offers a refresh. Dismissing hides it until the next new version.

const EVERY = 10 * 60 * 1000;

const check = () =>
  fetch(`/data/version.json?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ built: string }>) : null))
    .then((v) => v?.built ?? null)
    .catch(() => null);

export default function UpdateToast() {
  const [fresh, setFresh] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    let first: string | null = null;
    let dismissed: string | null = null;
    let last = Date.now();
    const look = async () => {
      last = Date.now();
      const v = await check();
      if (!v) return;
      if (!first) first = v;
      else if (v !== first && v !== dismissed) setFresh(v);
    };
    look();
    const t = setInterval(look, EVERY);
    const onVisible = () => document.visibilityState === "visible" && Date.now() - last > 60_000 && look();
    const onDismiss = (e: Event) => (dismissed = (e as CustomEvent<string>).detail);
    document.addEventListener("visibilitychange", onVisible);
    addEventListener("deeparam-update-dismiss", onDismiss);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("deeparam-update-dismiss", onDismiss);
    };
  }, []);

  if (!fresh) return null;
  return (
    <div className="update-toast" role="status">
      <span>{t("A new version of DeepARAM is out.")}</span>
      <button type="button" className="btn" onClick={() => location.reload()}>
        {t("Refresh")}
      </button>
      <button
        type="button"
        className="update-close"
        aria-label={t("Dismiss")}
        onClick={() => {
          dispatchEvent(new CustomEvent("deeparam-update-dismiss", { detail: fresh }));
          setFresh(null);
        }}
      >
        ×
      </button>
    </div>
  );
}
