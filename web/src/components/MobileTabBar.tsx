"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { useT } from "./I18n";

type Tab = { href: string; label: string; group?: string };

// Bottom tab bar for phones and tablets. It is only shown when the inline script in the
// layout marks the page as running on iOS or Android (html[data-device="mobile"]).
const PRIMARY = ["/tier-list", "/simulator", "/kitchen"];
// Each tab tints in its section's colour when active, like iOS tab bars.
const ACCENT: Record<string, string> = { "/tier-list": "tier", "/simulator": "sim", "/kitchen": "lab", more: "info" };

const ICONS: Record<string, React.ReactNode> = {
  "/": <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  "/tier-list": <path d="M5 19V11M10 19V6M15 19v-9M20 19V4" />,
  "/info": <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6" />,
  "/simulator": <path d="M13 3 5 13h6l-1 8 8-10h-6z" />,
  // A cooking pot.
  "/kitchen": <path d="M4 10h16M5 10v7a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-7M2.5 10H4M20 10h1.5M9 6.5c0-1 .8-1.5.8-2.5M12.5 6.5c0-1 .8-1.5.8-2.5" />,
  "/pbe": <path d="M9 4h6M10 4v5l-5 9a1.5 1.5 0 0 0 1.3 2h11.4A1.5 1.5 0 0 0 19 18l-5-9V4" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </>
  ),
};

function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name] ?? ICONS.more}
    </svg>
  );
}

export default function MobileTabBar({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const tr = useT();
  useEffect(() => setOpen(false), [pathname]);

  // Slide the bar away while scrolling down and bring it back on any scroll up, the way Safari's own
  // bottom bar collapses, so the two bars don't stack on top of the page while reading.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const nearBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 24;
      if (y < 64 || nearBottom) setHidden(false);
      else if (y - last > 8) setHidden(true);
      else if (last - y > 8) setHidden(false);
      else return;
      last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => setHidden(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const primary = [{ href: "/", label: "Home" }, ...tabs.filter((t) => PRIMARY.includes(t.href))];
  const rest = tabs.filter((t) => !PRIMARY.includes(t.href));
  const moreActive = rest.some((t) => isActive(t.href));

  return (
    <>
      {open && <button type="button" className="sheet-scrim" aria-label={tr("Close menu")} onClick={() => setOpen(false)} />}
      <div className="sheet" hidden={!open} id="more-sheet">
        {rest.map((t, i) => (
          <Fragment key={t.href}>
            {t.group && t.group !== rest[i - 1]?.group && <p className="sheet-group">{tr(t.group)}</p>}
            <Link href={t.href} aria-current={isActive(t.href) ? "page" : undefined}>
              {tr(t.label)}
              <span aria-hidden="true">→</span>
            </Link>
          </Fragment>
        ))}
      </div>
      <nav className="tabbar" aria-label={tr("Sections")} data-hidden={hidden && !open ? "" : undefined}>
        {primary.map((t) => (
          <Link key={t.href} href={t.href} data-accent={ACCENT[t.href]} aria-current={isActive(t.href) ? "page" : undefined}>
            <Icon name={t.href} />
            <span>{tr(t.label)}</span>
          </Link>
        ))}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="more-sheet"
          data-accent={ACCENT.more}
          aria-current={moreActive || open ? "page" : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="more" />
          <span>{tr("More")}</span>
        </button>
      </nav>
    </>
  );
}
