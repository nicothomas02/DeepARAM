"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { foldName } from "@/lib/fold";
import { closestPages } from "@/lib/search-rank";
import { useNames, useT } from "./I18n";
import type { SearchItem } from "./SearchPalette";

// On the not-found page: the champions, augments and items whose names come closest to the last part of the
// address, so a typo like /champions/ahrii or /items/infinty-edge is one tap from the right page.

export default function NotFoundSuggestions() {
  const t = useT();
  const names = useNames();
  const [found, setFound] = useState<SearchItem[]>([]);
  useEffect(() => {
    let typed = location.pathname.split("/").filter(Boolean).pop() ?? "";
    try {
      typed = decodeURIComponent(typed);
    } catch {}
    if (foldName(typed).length < 2) return;
    fetch("/data/search.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((all: SearchItem[]) => setFound(closestPages(all, typed)))
      .catch(() => {});
  }, []);
  if (!found.length) return null;
  return (
    <div className="nf-suggest">
      <p className="eyebrow">{t("Did you mean")}</p>
      <ul>
        {found.map((it) => (
          <li key={it.href}>
            <Link href={it.href} className="btn ghost">
              {it.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.icon} alt="" width={22} height={22} />
              )}
              {it.ref ? names(it.ref[0], it.ref[1], it.name) : it.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
