"use client";

import { useEffect, useRef } from "react";
import { KEPT, useKept } from "@/lib/kept";
import { flushSync } from "react-dom";
import { useT } from "@/components/I18n";

// Bulky secondary panels that Simple view (Settings > Page detail) tucks behind a "Show more" button;
// Detailed view always shows them and never shows the button. A fold opens by itself when a section
// link (SectionRail) or the address's #anchor points at its section or at anything inside it.

export const FOLD_EVENT = "cp-fold-open";

export default function Fold({
  section,
  titles,
  children,
}: {
  /** The section link (SectionRail id) that opens this fold. */
  section?: string;
  /** The hidden panels' titles, named on the button. */
  titles: string[];
  children: React.ReactNode;
}) {
  const t = useT("champions");
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useKept(false, ref);
  useEffect(() => {
    const wants = (id: string) =>
      !!id &&
      (id === section ||
        !!ref.current?.querySelector(`[id="${CSS.escape(id)}"]`));
    const onOpen = (e: Event) => {
      if (wants((e as CustomEvent<string>).detail))
        flushSync(() => setOpen(true));
    };
    const onHash = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!wants(id)) return;
      flushSync(() => setOpen(true));
      document.getElementById(id)?.scrollIntoView();
    };
    // Arriving with an #anchor: open now, then scroll once the panels are laid out.
    const first = decodeURIComponent(location.hash.slice(1));
    if (wants(first)) {
      setOpen(true);
      requestAnimationFrame(() =>
        document.getElementById(first)?.scrollIntoView(),
      );
    }
    window.addEventListener(FOLD_EVENT, onOpen);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener(FOLD_EVENT, onOpen);
      window.removeEventListener("hashchange", onHash);
    };
  }, [section]);
  return (
    <div className="cp-fold" ref={ref} {...KEPT} data-open={open || undefined}>
      <div className="cp-fold-body">{children}</div>
      <button
        type="button"
        className="cp-more cp-more-simple cp-fold-btn"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? t("Show fewer") : t("Show more")}
        {!open && <small>{titles.map((x) => t(x)).join(" · ")}</small>}
      </button>
    </div>
  );
}
