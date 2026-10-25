"use client";

import { useRef } from "react";
import { useT } from "./I18n";
import { KEPT, useKept } from "@/lib/kept";

// A long list on the PBE page: on phones it shows the first few entries and a "Show all" button (CSS:
// .phone-more), so the page isn't tens of thousands of pixels tall. Wider screens show everything, no button.
export default function PhoneMore({ count, children }: { count: number; children: React.ReactNode }) {
  const t = useT("pbe");
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useKept(false, box);
  return (
    <div className="phone-more" ref={box} {...KEPT} data-open={open || undefined}>
      {children}
      {count > 4 && (
        <button type="button" className="btn ghost phone-more-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t("Show less") : t("Show all ({n})", { n: count })}
        </button>
      )}
    </div>
  );
}
