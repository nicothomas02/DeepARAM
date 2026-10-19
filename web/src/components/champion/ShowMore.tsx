"use client";

import { useState } from "react";
import { useT } from "@/components/I18n";

// A ranked list that shows its first `limit` rows (all of them when `limit` is null) and hides the rest
// behind a "Show all" button. Simple view (Settings > Page detail) cuts every list at 5 rows.

export const SIMPLE_LIMIT = 5;

export default function ShowMore({
  total,
  limit = 8,
  children,
}: {
  total: number;
  limit?: 5 | 8 | 10 | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = useT("champions");
  const max = limit ?? Infinity;
  const cls = ["cp-rows"];
  if (!open && total > max) cls.push(`cp-cut-${limit}`);
  if (!open && total > SIMPLE_LIMIT) cls.push("cp-cut-simple");
  return (
    <>
      <div className={cls.join(" ")}>{children}</div>
      {total > SIMPLE_LIMIT && (
        <button
          type="button"
          // Only Simple view cuts this list: Detailed view has nothing to open.
          className={total > max ? "cp-more" : "cp-more cp-more-simple"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? t("Show fewer") : t("Show all {n}", { n: total })}
        </button>
      )}
    </>
  );
}
