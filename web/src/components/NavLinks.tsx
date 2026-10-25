"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavItem } from "@/lib/tabs";
import { useT } from "./I18n";

// Each tab has its own accent colour (globals.css, [data-accent]).
const ACCENT: Record<string, string> = { "/tier-list": "tier", "/simulator": "sim", "/pbe": "pbe", "/info": "info", "/kitchen": "lab" };

export default function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const t = useT();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  return (
    <nav className="nav">
      {items.map((it) =>
        it.children ? (
          <NavMenu key={it.href} item={it} current={it.children.some((c) => active(c.href))} pathname={pathname} />
        ) : (
          <Link key={it.href} href={it.href} data-accent={ACCENT[it.href]} aria-current={active(it.href) ? "page" : undefined}>
            {t(it.label)}
          </Link>
        ),
      )}
    </nav>
  );
}

// A tab that opens a list of pages (More). The nav scrolls sideways on narrow screens, so the
// list is placed with fixed coordinates under the button instead of inside the nav.
function NavMenu({ item, current, pathname }: { item: NavItem; current: boolean; pathname: string }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => setAt(null), [pathname]);
  useEffect(() => {
    if (!at) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) setAt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (setAt(null), btn.current?.focus());
    const close = () => setAt(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
    };
  }, [at]);

  const toggle = () => {
    if (at) return setAt(null);
    const r = btn.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 328)) });
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="nav-menu-btn"
        aria-expanded={Boolean(at)}
        aria-haspopup="true"
        aria-current={current ? "page" : undefined}
        onClick={toggle}
      >
        {t(item.label)}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {at && (
        <div ref={menu} className="nav-menu" style={at}>
          {item.children!.map((c) => (
            <Link key={c.href} href={c.href} data-accent={ACCENT[c.href]} aria-current={pathname === c.href ? "page" : undefined}>
              <b>{t(c.label)}</b>
              {c.body && <span>{t(c.body)}</span>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
