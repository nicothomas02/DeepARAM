"use client";

import RowLink from "@/components/RowLink";
import { useT } from "./I18n";
import { tagStyle, type TagInfo } from "@/lib/tag-info";

// A champion's archetype tags as colour-coded chips: Riot's class (filled), subclass (outlined) and
// playstyle (dot). Hovering or focusing one shows what it means; with `link`, each opens the tier list
// filtered to that tag. Tag names and meanings are translated in the "tags" namespace.

export default function ArchetypeTags({ names, info, link, compact }: { names: string[]; info: TagInfo; link?: boolean; compact?: boolean }) {
  const tr = useT("tags");
  const shown = names.filter((n) => info[n]);
  if (!shown.length) return null;
  return (
    <span className={compact ? "arch-tags compact" : "arch-tags"}>
      {shown.map((n) => {
        const t = info[n];
        const props = {
          className: "arch-tag",
          "data-kind": t.kind,
          "data-tip": tr(t.meaning),
          "aria-label": `${tr(n)}: ${tr(t.meaning)}`,
          style: tagStyle(t.color),
        };
        return link ? (
          <RowLink key={n} href={`/tier-list?tag=${encodeURIComponent(n)}`} {...props}>
            {tr(n)}
          </RowLink>
        ) : (
          <span key={n} tabIndex={0} {...props}>
            {tr(n)}
          </span>
        );
      })}
    </span>
  );
}
