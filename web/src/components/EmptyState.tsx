"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "./I18n";

// A friendly box for "nothing here" and "didn't load": what happened, and what to do about it.

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty-state" role="status">
      <svg
        viewBox="0 0 24 24"
        width="28"
        height="28"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5M8.5 11h5" />
      </svg>
      <div>
        <b>{title}</b>
        {children && <p>{children}</p>}
        {action && <div className="empty-actions">{action}</div>}
      </div>
    </div>
  );
}

/** For data that failed to load: says so, notices being offline, and offers to try again. */
export function LoadError({ what, retry }: { what: string; retry?: () => void }) {
  const [offline, setOffline] = useState(false);
  const t = useT("tables");
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    addEventListener("online", sync);
    addEventListener("offline", sync);
    return () => {
      removeEventListener("online", sync);
      removeEventListener("offline", sync);
    };
  }, []);
  return (
    <div className="empty-state" data-kind="error" role="alert">
      <svg
        viewBox="0 0 24 24"
        width="28"
        height="28"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3 2 20h20L12 3z" />
        <path d="M12 10v4M12 17.5v.01" />
      </svg>
      <div>
        <b>{offline ? t("You're offline.") : t("{what} didn't load.", { what })}</b>
        <p>
          {offline
            ? t("It will load once you're back online. Pages you opened recently still work.")
            : t("It's usually a brief hiccup. Trying again normally fixes it.")}
        </p>
        <div className="empty-actions">
          <button type="button" className="btn" onClick={retry ?? (() => location.reload())}>
            {t("Try again")}
          </button>
          {offline && (
            <Link className="btn ghost" href="/offline">
              {t("Saved pages")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
