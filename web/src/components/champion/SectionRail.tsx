"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18n";
import { FOLD_EVENT } from "./Fold";

// The champion page's section links: a column beside the tables on wide screens, a sticky strip on
// narrow ones. The section you're reading is highlighted, and a link opens its section's folded panels
// (Fold.tsx) before the browser jumps there.

export default function SectionRail({
  spots,
}: {
  spots: { id: string; label: string }[];
}) {
  const t = useT("champions");
  const [active, setActive] = useState(spots[0]?.id ?? "");
  useEffect(() => {
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting)
            visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        const first = spots.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-90px 0px -60% 0px" },
    );
    for (const s of spots) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [spots]);
  return (
    <nav className="cp-rail" aria-label={t("Sections")}>
      {spots.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={() =>
            window.dispatchEvent(new CustomEvent(FOLD_EVENT, { detail: s.id }))
          }
          aria-current={active === s.id ? "true" : undefined}
        >
          {t(s.label)}
        </a>
      ))}
    </nav>
  );
}
