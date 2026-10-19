"use client";

import { useMemo, useState } from "react";
import { useNames, useT, type NameKind } from "./I18n";

// The PBE tab's change tracker: every champion, item and augment change on the test server, each tagged
// as a likely buff or nerf from which way its numbers moved (data/pbe/tracker.json, tools/datamine/tracker.py).

export type Tag = "buff" | "nerf" | "mixed" | "neutral" | "unclear" | "new" | "removed";
export type TrackerEntry = {
  kind: "champion" | "item" | "augment";
  name: string;
  /** Champion alias, item id or augment id, for the official name in the visitor's language. */
  id?: string | number;
  tag: Tag;
  icon?: string;
  tier?: string;
  set?: string;
  lines: { text: string; tag: Tag }[];
};

const LABEL: Record<Tag, string> = {
  buff: "Likely buff",
  nerf: "Likely nerf",
  mixed: "Mixed",
  new: "New",
  removed: "Removed",
  neutral: "No power change",
  unclear: "Unclear",
};
const TAGS = Object.keys(LABEL) as Tag[];
const KINDS = [
  ["all", "All"],
  ["champion", "Champions"],
  ["item", "Items"],
  ["augment", "Augments"],
] as const;
// Buffs and nerfs first, so the changes that matter most lead the list.
const ORDER: Record<Tag, number> = { buff: 0, nerf: 1, mixed: 2, new: 3, removed: 4, unclear: 5, neutral: 6 };
// Rows shown before "Show all", so the rest of the page stays close.
const FIRST = 18;

export default function ChangeTracker({ entries }: { entries: TrackerEntry[] }) {
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("all");
  const [tag, setTag] = useState<Tag | null>(null);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const t = useT("pbe");
  const td = useT("pbe-data");
  const names = useNames();
  const nameOf = (e: TrackerEntry) => (e.id === undefined ? e.name : names(`${e.kind}s` as NameKind, e.id, e.name));

  const ofKind = useMemo(() => entries.filter((e) => kind === "all" || e.kind === kind), [entries, kind]);
  const counts = useMemo(() => {
    const c = {} as Record<Tag, number>;
    for (const e of ofKind) c[e.tag] = (c[e.tag] ?? 0) + 1;
    return c;
  }, [ofKind]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ofKind
      .filter((e) => !tag || e.tag === tag)
      .filter((e) => !s || [e.name, nameOf(e), ...e.lines.flatMap((l) => [l.text, td(l.text)])].some((x) => x.toLowerCase().includes(s)))
      .sort((a, b) => ORDER[a.tag] - ORDER[b.tag] || nameOf(a).localeCompare(nameOf(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nameOf and td change with the language, which names and td already track
  }, [ofKind, tag, q, names, td]);
  const cut = !all && !tag && !q.trim() && shown.length > FIRST + 3;

  return (
    <div className="tracker">
      <div className="tracker-bar">
        <div className="seg" role="group" aria-label={t("Show")}>
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(label)}
            </button>
          ))}
        </div>
        <input className="table-search" type="search" placeholder={t("Search changes")} aria-label={t("Search changes")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tracker-tags" role="group" aria-label={t("Filter by tag")}>
        {TAGS.filter((x) => counts[x]).map((x) => (
          <button key={x} type="button" className={`tag tag-${x}`} aria-pressed={tag === x} onClick={() => setTag(tag === x ? null : x)}>
            {t(LABEL[x])} <b>{counts[x]}</b>
          </button>
        ))}
      </div>
      {shown.length ? (
        <ul className={`tracker-list${cut ? " is-cut" : ""}`}>
          {(cut ? shown.slice(0, FIRST) : shown).map((e) => (
            <li key={`${e.kind}-${e.name}`} className={`tracker-row is-${e.tag}`}>
              <div className="tracker-head">
                {e.icon ? <img src={e.icon} alt="" width={32} height={32} loading="lazy" /> : <span className="tracker-noicon" aria-hidden />}
                <span className="tracker-name">
                  <b>{nameOf(e)}</b>
                  <span className="sub">
                    {e.kind === "augment" ? `${t(e.tier ? `${e.tier[0].toUpperCase()}${e.tier.slice(1)} augment` : "Augment")}${e.set ? ` · ${e.set}` : ""}` : t(e.kind === "item" ? "Item" : "Champion")}
                  </span>
                </span>
                <span className={`tag tag-${e.tag}`}>{t(LABEL[e.tag])}</span>
              </div>
              <ul className="tracker-lines">
                {e.lines.map((l) => (
                  <li key={l.text} className={`is-${l.tag}`} title={t(LABEL[l.tag])}>
                    {td(l.text)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
      {cut && (
        <button type="button" className="btn ghost tracker-more" onClick={() => setAll(true)}>
          {t("Show all {n} changes", { n: shown.length })}
        </button>
      )}
      {shown.length ? null : (
        <p className="sub">{t("No changes match.")}</p>
      )}
    </div>
  );
}
