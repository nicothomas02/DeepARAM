"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import championNames from "@/data/champion-names.json";
import { setParams } from "@/lib/url-state";
import { useAdvanced } from "./Advanced";
import championIds from "@/data/champion-ids.json";
import { hintFor } from "@/lib/glossary";
import { useNames, useT } from "./I18n";
import { EmptyState } from "@/components/EmptyState";
import DeepScore from "./DeepScore";
import ArchetypeTags from "./ArchetypeTags";
import type { TagInfo } from "@/lib/tag-info";

export type Column = {
  key: string;
  label: string;
  format?: "pct" | "num" | "int" | "sec" | "text" | "champion" | "augment" | "tier" | "deepscore" | "tags";
  sortable?: boolean;
  /** For "augment" columns: the row key holding the augment id, for its icon. */
  iconKey?: string;
  /** The row key holding a page to open from this cell (an augment's own page, a build's replay). */
  hrefKey?: string;
  /** Sort by this row key instead (a tier letter sorts by its score). */
  sortKey?: string;
  /** Explains the column; shown on hover and to screen readers. */
  hint?: string;
  /** For "tags" columns: the colour and meaning of each tag (the cell holds them comma-separated). */
  tags?: TagInfo;
};

export type Row = Record<string, string | number | null>;

const NAMES = championNames as Record<string, string>;

// Search matches champion ids ("MonkeyKing"), display names ("Wukong") and names in the page's language alike.
function searchText(v: Row[string], local: (id: string, en: string) => string) {
  const raw = String(v ?? "");
  const names = raw.split(" ").map((w) => {
    const en = NAMES[w] ?? w.replace(/([a-z])([A-Z])/g, "$1 $2");
    return `${en} ${local(w, en)}`;
  });
  return `${raw} ${names.join(" ")}`.toLowerCase();
}

const PAGE = 50;

function show(v: Row[string], format: Column["format"]) {
  // undefined: a column the row doesn't carry (an older cached copy of a table's data).
  if (v == null || v === "") return "–";
  const n = Number(v);
  switch (format) {
    case "pct":
      return `${(n * 100).toFixed(1)}%`;
    case "num":
      return n.toFixed(1);
    case "int":
      // A fixed locale: the browser's own would differ from the server render and break hydration.
      return Math.round(n).toLocaleString("en-US");
    case "sec":
      return `${Math.round(n)}s`;
    default:
      return String(v);
  }
}

// A tier letter. When the row carries the previous patch's tier (<key>_was) and it differs, the chip
// slides in from the old letter, up or down (globals.css: on a new patch's first visit).
const ORDER = ["S", "A", "B", "C", "D"];
function TierChip({ tier, was }: { tier: string; was: Row[string] | undefined }) {
  const t = useT("tables");
  const old = typeof was === "string" && was !== tier && ORDER.includes(was) ? was : null;
  return (
    <span
      key={`${old}-${tier}`}
      className={`chip tier-${tier.toLowerCase()}`}
      data-was={old ?? undefined}
      data-dir={old ? (ORDER.indexOf(tier) < ORDER.indexOf(old) ? "up" : "down") : undefined}
      title={old ? t("{tier} last patch", { tier: old }) : undefined}
    >
      {tier}
    </span>
  );
}

// Numbers get a colour where it means something: win rates above or below an even 50%, and changes up or down.
function cellClass(c: Column, v: Row[string]) {
  if (!c.format || ["text", "champion", "augment", "tier", "tags"].includes(c.format)) return "";
  const n = Number(v);
  if (v === null || v === "" || Number.isNaN(n)) return "num";
  if (c.format === "pct" && /win/.test(c.key)) return n >= 0.52 ? "num wr-high" : n <= 0.48 ? "num wr-low" : "num";
  if (/change|delta/.test(c.key)) return n > 0 ? "num delta-up" : n < 0 ? "num delta-down" : "num";
  return "num";
}

// Champion and augment icons come from the League client (web/scripts/fetch_icons.py).
function Named({ src, name }: { src: string; name: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="champ">
      {!broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={24} height={24} loading="lazy" onError={() => setBroken(true)} />
      )}
      {name}
    </span>
  );
}

// A champion's name opens its page.
function Champion({ id }: { id: string }) {
  const name = useNames()("champions", id, NAMES[id] ?? id.replace(/([a-z])([A-Z])/g, "$1 $2"));
  const named = <Named src={`/icons/champions/${id}.webp`} name={name} />;
  return id in championIds ? (
    <Link className="cell-link" href={`/champions/${id}`}>
      {named}
    </Link>
  ) : (
    named
  );
}

// Sortable, searchable table. Rows are shown a page at a time.
export default function DataTable({
  columns: standardColumns,
  advancedColumns,
  rows,
  initialSort,
  searchKey,
  searchLabel = "Search",
  urlTab,
}: {
  columns: Column[];
  /** Columns for the tier list's Advanced view; the standard columns are used when absent. */
  advancedColumns?: Column[];
  rows: Row[];
  initialSort: { key: string; desc: boolean };
  searchKey?: string;
  searchLabel?: string;
  // Fill the search and sort from ?q= and ?sort= when the page's ?tab= names this table's tab
  // ("" = the default tab), and keep them there as they change so the address can be shared.
  urlTab?: string;
}) {
  const columns = useAdvanced() && advancedColumns ? advancedColumns : standardColumns;
  // Column labels, hints and the table's own wording live in the "tables" namespace.
  const t = useT("tables");
  const names = useNames();
  const hint = (c: Column) => {
    const h = hintFor(c.label, c.hint);
    return h && t(h);
  };
  const [sort, setSort] = useState(initialSort);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  // Read once on load; the columns' keys say which ?sort= values are real.
  const allColumns = useRef([...standardColumns, ...(advancedColumns ?? [])]);
  useEffect(() => {
    if (urlTab === undefined) return;
    const p = new URLSearchParams(location.search);
    if ((p.get("tab") ?? "") !== urlTab) return;
    const q = p.get("q");
    if (q) setQuery(q);
    const s = p.get("sort")?.match(/^(\w+)\.(asc|desc)$/);
    if (s && allColumns.current.some((c) => c.sortable !== false && (c.sortKey ?? c.key) === s[1])) setSort({ key: s[1], desc: s[2] === "desc" });
  }, [urlTab]);
  const share = (values: Record<string, string | null>) => urlTab !== undefined && setParams(values);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const local = (id: string, en: string) => names("champions", id, en);
    const filtered =
      q && searchKey
        ? rows.filter((r) => `${searchText(r[searchKey], local)} ${r.id === undefined ? "" : names("augments", String(r.id), "")}`.toLowerCase().includes(q))
        : rows;
    const dir = sort.desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      // Missing values (a champion new this patch has no change) stay at the bottom either way.
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x ?? "").localeCompare(String(y ?? "")) * dir;
    });
  }, [rows, sort, query, searchKey, names]);

  const toggle = (key: string) => {
    const next = sort.key === key ? { key, desc: !sort.desc } : { key, desc: key !== searchKey };
    setSort(next);
    share({ sort: `${next.key}.${next.desc ? "desc" : "asc"}` });
  };

  return (
    <div className="data-table">
      {searchKey && (
        <input
          className="table-search"
          type="search"
          placeholder={t(searchLabel)}
          aria-label={t(searchLabel)}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
            share({ q: e.target.value.trim() || null });
          }}
        />
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.format && !["text", "champion", "augment", "tier", "tags"].includes(c.format) ? "num" : ""}
                  aria-sort={c.sortable !== false && sort.key === (c.sortKey ?? c.key) ? (sort.desc ? "descending" : "ascending") : undefined}
                >
                  {c.sortable === false ? (
                    t(c.label)
                  ) : (
                    <button type="button" onClick={() => toggle(c.sortKey ?? c.key)} data-tip={hint(c)} aria-description={hint(c)}>
                      {t(c.label)}
                      {hint(c) && (
                        <span className="col-hint" aria-hidden="true">
                          ?
                        </span>
                      )}
                      <span className="sort-mark">{sort.key === (c.sortKey ?? c.key) ? (sort.desc ? "↓" : "↑") : ""}</span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, shown).map((r, i) => (
              <tr key={i}>
                <td className="num muted-cell">{i + 1}</td>
                {columns.map((c) => (
                  <td key={c.key} className={cellClass(c, r[c.key])}>
                    {c.format === "champion" ? (
                      <Champion id={String(r[c.key])} />
                    ) : c.format === "augment" ? (
                      c.hrefKey && r[c.hrefKey] ? (
                        <Link className="cell-link" href={String(r[c.hrefKey])}>
                          <Named
                            src={`/icons/augments/${r[c.iconKey ?? "id"]}.webp`}
                            name={names("augments", String(r[c.iconKey ?? "id"]), String(r[c.key] ?? ""))}
                          />
                        </Link>
                      ) : (
                        <Named
                          src={`/icons/augments/${r[c.iconKey ?? "id"]}.webp`}
                          name={names("augments", String(r[c.iconKey ?? "id"]), String(r[c.key] ?? ""))}
                        />
                      )
                    ) : c.hrefKey && r[c.hrefKey] ? (
                      <a className="cell-link" href={String(r[c.hrefKey])}>
                        {show(r[c.key], c.format)}
                      </a>
                    ) : c.format === "deepscore" && typeof r[c.key] === "number" ? (
                      <DeepScore value={r[c.key] as number} help={c.hint} />
                    ) : c.format === "tags" && c.tags ? (
                      <ArchetypeTags names={String(r[c.key] ?? "").split(",")} info={c.tags} compact />
                    ) : c.format === "tier" && r[c.key] ? (
                      <TierChip tier={String(r[c.key])} was={r[`${c.key}_was`]} />
                    ) : (
                      show(r[c.key], c.format)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 &&
        (query.trim() ? (
          <EmptyState
            title={t("Nothing matches “{q}”.", { q: query.trim() })}
            action={
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setQuery("");
                  share({ q: null });
                }}
              >
                {t("Clear search")}
              </button>
            }
          >
            {t("Check the spelling, or search for part of the name.")}
          </EmptyState>
        ) : (
          <EmptyState title={t("Nothing to show here yet.")}>{t("There's no data for this view on the chosen patches.")}</EmptyState>
        ))}
      {(() => {
        const terms = columns.flatMap((c) => {
          const h = hint(c);
          return h ? [[t(c.label), h] as const] : [];
        });
        return terms.length ? (
          <details className="table-glossary">
            <summary>{t("What do these columns mean?")}</summary>
            <dl>
              {terms.map(([t, h]) => (
                <div key={t}>
                  <dt>{t}</dt>
                  <dd>{h}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null;
      })()}
      {sorted.length > shown && (
        <button type="button" className="show-more" onClick={() => setShown((n) => n + PAGE * 2)}>
          {t("Show more ({n} left)", { n: sorted.length - shown })}
        </button>
      )}
    </div>
  );
}
