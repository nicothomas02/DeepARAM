"use client";

import { useEffect, useState } from "react";
import { THEME_COLORS, THEME_EVENT, THEME_KEY } from "@/lib/theme";
import { useT } from "./I18n";

// Light / Dark / System switch in the header. The choice is kept in localStorage and applied as
// <html data-theme> before paint (THEME_SCRIPT in layout.tsx); "system" removes the attribute.
// With nothing saved the site is dark, so "system" is saved as a choice of its own.
// Embedded tools follow through Embed, which listens for THEME_EVENT.

type Theme = "light" | "dark" | "system";

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  { value: "dark", label: "Dark", icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /> },
  {
    value: "system",
    label: "System",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
  },
];

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  // Browser chrome (the iOS status bar area, Android's toolbar) matches the page.
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light));
  window.dispatchEvent(new Event(THEME_EVENT));
}

export default function ThemeToggle({ labels = false }: { labels?: boolean }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const t = useT();

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {}
    const t: Theme = saved === "light" || saved === "system" ? saved : "dark";
    setTheme(t);
    apply(t);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => document.documentElement.dataset.theme || apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const pick = (t: Theme) => {
    setTheme(t);
    apply(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  };

  return (
    <div className="theme-toggle" role="group" aria-label={t("Theme")}>
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" aria-pressed={theme === o.value} aria-label={labels ? undefined : t(o.label)} title={t(o.label)} onClick={() => pick(o.value)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {o.icon}
          </svg>
          {labels && <span>{t(o.label)}</span>}
        </button>
      ))}
    </div>
  );
}
