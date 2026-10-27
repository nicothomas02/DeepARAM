"use client";

import RowLink from "./RowLink";
import { useEffect, useMemo, useRef, useState } from "react";
import { KEPT, useKept } from "@/lib/kept";
import championNames from "@/data/champion-names.json";
import { setParams } from "@/lib/url-state";
import championIds from "@/data/champion-ids.json";
import { hintFor } from "@/lib/glossary";
import { useNames, useT } from "./I18n";
import { EmptyState } from "@/components/EmptyState";
import DeepScore from "./DeepScore";
import { useAdvanced } from "./Advanced";
import ArchetypeTags from "./ArchetypeTags";
import { openRankings, RANKINGS_ID } from "./HowRankings";
import type { TagInfo } from "@/lib/tag-info";

export type Column = {
  key: string;
  label: string;
  format?: "pct" | "pts" | "spread" | "num" | "int" | "sec" | "text" | "champion" | "champion-icon" | "augment" | "item" | "ability" | "tier" | "deepscore" | "tags";
  sortable?: boolean;
  /** For "augment" columns: the row key holding the augment id, for its icon; for "item" and "ability" columns, the
   *  icon's address. */
  iconKey?: string;
  /** The row key holding a page to open from this cell (an augment's own page, a build's replay). */
  hrefKey?: string;
  /** Sort by this row key instead (a tier letter sorts by its score). */
  sortKey?: string;
  /** Explains the column; shown on hover and to screen readers. */
  hint?: string;
  /** For "tags" columns: the colour and meaning of each tag (the cell holds them comma-separated). */
  tags?: TagInfo;
  /** Phones (globals.css): "hide" drops the column below 640px, "wide" only below 360px, so the main numbers fit
   *  without sideways scrolling. A table with any of these gets a sort menu there instead. */
  phone?: "hide" | "wide";
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
// Tables longer than this keep their column names in view while the page scrolls (useStickyHead).
const STICKY_ROWS = 12;

// A rate rounded for display; -0.0 shows as 0.0.
const tenths = (n: number) => (Math.round(n * 1000) / 10 || 0).toFixed(1);

function show(v: Row[string], format: Column["format"], pts: (n: string) => string) {
  // undefined: a column the row doesn't carry (an older cached copy of a table's data).
  if (v == null || v === "") return "–";
  const n = Number(v);
  switch (format) {
    case "pct":
      return `${tenths(n)}%`;
    case "pts":
      // Percentage points; the cell's ▲ or ▼ (cellClass) carries the sign.
      return pts(tenths(Math.abs(n)));
    case "spread":
      // A spread in percentage points: always positive, so no arrow or colour.
      return pts(tenths(n));
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
  if (!c.format || ["text", "champion", "champion-icon", "augment", "item", "ability", "tier", "tags"].includes(c.format)) return "";
  const n = Number(v);
  if (v === null || v === "" || Number.isNaN(n)) return "num";
  if (c.format === "pct" && /win/.test(c.key)) return n >= 0.52 ? "num wr-high" : n <= 0.48 ? "num wr-low" : "num";
  // A change that rounds to zero gets no arrow or colour.
  const shown = c.format === "pts" ? Math.round(n * 1000) : n;
  if (c.format === "pts" || /change|delta/.test(c.key)) return shown > 0 ? "num delta-up" : shown < 0 ? "num delta-down" : "num";
  return "num";
}

// Long tables keep their header row in view: it slides down under the site header while the table
// scrolls past (a transform, since the sideways-scrolling wrapper stops position: sticky working).
function useStickyHead(on: boolean) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const table = ref.current;
    const wrap = table?.parentElement;
    if (!on || !table || !wrap) return;
    // A table that fits its width (most on phones) lets the browser stick the header itself, which moves with the
    // scroll exactly; one that scrolls sideways needs the transform, which follows a frame behind.
    const canClip = typeof CSS !== "undefined" && CSS.supports("overflow", "clip");
    let raf = 0;
    const headerBottom = () => Math.max(0, document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0);
    const update = () => {
      raf = 0;
      const head = table.tHead;
      if (!head) return;
      const top = headerBottom();
      const box = table.getBoundingClientRect();
      if (wrap.hasAttribute("data-sticky")) {
        // The site header is shorter once the page scrolls on some screens.
        const px = `${top}px`;
        if (wrap.style.getPropertyValue("--sticky-top") !== px) wrap.style.setProperty("--sticky-top", px);
        table.toggleAttribute("data-stuck", box.top < top && box.bottom > top + head.offsetHeight);
        return;
      }
      const off = Math.round(Math.min(Math.max(0, top - box.top), box.height - head.offsetHeight * 2));
      table.style.setProperty("--head-off", `${Math.max(0, off)}px`);
      table.toggleAttribute("data-stuck", off > 0);
    };
    const fit = () => {
      wrap.toggleAttribute("data-sticky", false);
      const sticky = canClip && wrap.scrollWidth <= wrap.clientWidth + 1;
      wrap.toggleAttribute("data-sticky", sticky);
      if (sticky) table.style.removeProperty("--head-off");
      update();
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    fit();
    const seen = new ResizeObserver(() => fit());
    seen.observe(table);
    seen.observe(wrap);
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      seen.disconnect();
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", fit);
      table.style.removeProperty("--head-off");
      table.removeAttribute("data-stuck");
      wrap.removeAttribute("data-sticky");
      wrap.style.removeProperty("--sticky-top");
    };
  }, [on]);
  return ref;
}

// On phones a one-word label in two parts (DeepScore) may break between them, so its column needs no more room than its cells.
function breakable(label: string) {
  const parts = label.replace(/([a-z])([A-Z])/g, "$1\n$2").split("\n");
  return parts.length < 2 ? label : <span className="th-split">{parts.flatMap((p, i) => (i ? [<wbr key={i} />, p] : [p]))}</span>;
}

// Champion and augment icons come from the League client (web/scripts/fetch_icons.py).
// An ability as "Q · Orb of Deception": phones keep the icon and the key, the name only shows on wider screens.
function Ability({ src, text }: { src: string; text: string }) {
  const [slot, ...rest] = text.split(" · ");
  return (
    <span className="champ ability-cell" title={text}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" width={24} height={24} loading="lazy" />}
      <span className="nm">
        {slot}
        {rest.length > 0 && <span className="ability-name"> · {rest.join(" · ")}</span>}
      </span>
    </span>
  );
}

function Named({ src, name }: { src: string; name: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="champ">
      {!broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={24} height={24} loading="lazy" onError={() => setBroken(true)} />
      )}
      <span className="nm" title={name}>
        {name}
      </span>
    </span>
  );
}

// A champion's name opens its page.
function Champion({ id }: { id: string }) {
  const name = useNames()("champions", id, NAMES[id] ?? id.replace(/([a-z])([A-Z])/g, "$1 $2"));
  const named = <Named src={`/icons/champions/${id}.webp`} name={name} />;
  return id in championIds ? (
    <RowLink className="cell-link" href={`/champions/${id}`}>
      {named}
    </RowLink>
  ) : (
    named
  );
}

// Just the champion's icon, named for screen readers and on hover; it opens their page too.
function ChampionIcon({ id }: { id: string }) {
  const name = useNames()("champions", id, NAMES[id] ?? id.replace(/([a-z])([A-Z])/g, "$1 $2"));
  // eslint-disable-next-line @next/next/no-img-element
  const icon = <img className="champ-icon" src={`/icons/champions/${id}.webp`} alt={name} title={name} width={28} height={28} loading="lazy" />;
  return id in championIds ? (
    <RowLink className="cell-link" href={`/champions/${id}`}>
      {icon}
    </RowLink>
  ) : (
    icon
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
  // Every stat in one table: the advanced columns, when given, are the table's columns (Nico 2026-10-20).
  // On phones the extra ones drop out so the main numbers fit, unless Settings > Page detail is "Detailed".
  const detailed = useAdvanced();
  const columns = useMemo(() => {
    if (!advancedColumns) return standardColumns;
    // A column in the standard set keeps its phone setting from there.
    const standard = new Map(standardColumns.map((c) => [c.key, c]));
    return advancedColumns.map((c) => {
      const std = standard.get(c.key);
      if (std) return { ...c, phone: std.phone ?? c.phone };
      return detailed ? c : { ...c, phone: c.phone ?? ("hide" as const) };
    });
  }, [advancedColumns, standardColumns, detailed]);
  // The first champion or augment column stays pinned on phones while the table scrolls sideways.
  const pin = columns.find((c) => c.format === "champion" || c.format === "augment" || c.format === "item")?.key;
  // Column labels, hints and the table's own wording live in the "tables" namespace.
  const t = useT("tables");
  const pts = (n: string) => t("{n} pts", { n });
  const names = useNames();
  const hint = (c: Column) => {
    const h = hintFor(c.label, c.hint);
    return h && t(h);
  };
  const [sort, setSort] = useState(initialSort);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useKept(PAGE, box);
  // The column hints link to the "How rankings work" panel when the page has one (HowRankings.tsx).
  const [hasRankings, setHasRankings] = useState(false);
  useEffect(() => setHasRankings(!!document.getElementById(RANKINGS_ID)), []);

  // Read once on load; the columns' keys say which ?sort= values are real.
  const allColumns = useRef([...standardColumns, ...(advancedColumns ?? [])]);
  useEffect(() => {
    if (urlTab === undefined) return;
    const p = new URLSearchParams(location.search);
    // Duos sit inside the Champions tab (?cview=duos), which is also the page's first tab.
    const tab = p.get("cview") === "duos" ? "duos" : p.get("tab") === "champions" ? "" : (p.get("tab") ?? "");
    if (tab !== urlTab) return;
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

  const tableRef = useStickyHead(Math.min(sorted.length, shown) > STICKY_ROWS);
  const cls = (c: Column, base: string) =>
    [base, c.key === pin && "pin", c.phone && `ph-${c.phone}`, c.format === "augment" && "aug-col"].filter(Boolean).join(" ");

  // Phones: a table that trims columns (Column.phone) fits the screen, and a tap anywhere on a row opens the
  // row's page when the row has just one. Column headers sort, both ways, on every screen.
  const fit = columns.some((c) => c.phone);
  const rowLink = fit && columns.filter((c) => c.format === "champion" || c.format === "augment" || c.format === "item").length === 1;
  const openRow = (e: React.MouseEvent<HTMLTableSectionElement>) => {
    const target = e.target as Element;
    if (!rowLink || target.closest("a, button") || !matchMedia("(max-width: 640px)").matches) return;
    target.closest("tr")?.querySelector<HTMLAnchorElement>("td.pin a")?.click();
  };
  const search = searchKey && (
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
  );

  return (
    <div className={fit ? "data-table fit" : "data-table"} ref={box} {...KEPT}>
      {fit ? <div className="table-tools">{search}</div> : search}
      <div className="table-scroll">
        <table ref={tableRef}>
          <thead>
            <tr>
              <th className="num rank-col">#</th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cls(c, c.format && !["text", "champion", "champion-icon", "augment", "item", "ability", "tier", "tags"].includes(c.format) ? "num" : "")}
                  aria-sort={c.sortable !== false && sort.key === (c.sortKey ?? c.key) ? (sort.desc ? "descending" : "ascending") : undefined}
                >
                  {c.sortable === false ? (
                    breakable(t(c.label))
                  ) : (
                    <button type="button" onClick={() => toggle(c.sortKey ?? c.key)} data-tip={hint(c)} aria-description={hint(c)}>
                      {breakable(t(c.label))}
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
          <tbody onClick={openRow}>
            {sorted.slice(0, shown).map((r, i) => (
              <tr key={i}>
                <td className="num muted-cell rank-col">{i + 1}</td>
                {columns.map((c) => (
                  <td key={c.key} className={cls(c, cellClass(c, r[c.key]))}>
                    {c.format === "champion" ? (
                      <Champion id={String(r[c.key])} />
                    ) : c.format === "champion-icon" ? (
                      r[c.key] ? <ChampionIcon id={String(r[c.key])} /> : "–"
                    ) : c.format === "item" ? (
                      // The row carries the item's name in the page's language already; items without a page aren't links.
                      r[c.hrefKey ?? "href"] ? (
                        <RowLink className="cell-link" href={String(r[c.hrefKey ?? "href"])}>
                          <Named src={String(r[c.iconKey ?? "icon"] ?? "")} name={String(r[c.key] ?? "")} />
                        </RowLink>
                      ) : (
                        <Named src={String(r[c.iconKey ?? "icon"] ?? "")} name={String(r[c.key] ?? "")} />
                      )
                    ) : c.format === "ability" ? (
                      r[c.key] ? <Ability src={String(r[c.iconKey ?? "icon"] ?? "")} text={String(r[c.key])} /> : "–"
                    ) : c.format === "augment" ? (
                      c.hrefKey && r[c.hrefKey] ? (
                        <RowLink className="cell-link" href={String(r[c.hrefKey])}>
                          <Named
                            src={`/icons/augments/${r[c.iconKey ?? "id"]}.webp`}
                            name={names("augments", String(r[c.iconKey ?? "id"]), String(r[c.key] ?? ""))}
                          />
                        </RowLink>
                      ) : (
                        <Named
                          src={`/icons/augments/${r[c.iconKey ?? "id"]}.webp`}
                          name={names("augments", String(r[c.iconKey ?? "id"]), String(r[c.key] ?? ""))}
                        />
                      )
                    ) : c.hrefKey && r[c.hrefKey] ? (
                      <a className="cell-link" href={String(r[c.hrefKey])}>
                        {show(r[c.key], c.format, pts)}
                      </a>
                    ) : c.format === "deepscore" && typeof r[c.key] === "number" ? (
                      <DeepScore value={r[c.key] as number} help={c.hint} />
                    ) : c.format === "tags" && c.tags ? (
                      <ArchetypeTags names={String(r[c.key] ?? "").split(",")} info={c.tags} compact />
                    ) : c.format === "tier" && r[c.key] ? (
                      <TierChip tier={String(r[c.key])} was={r[`${c.key}_was`]} />
                    ) : (
                      show(r[c.key], c.format, pts)
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
            {hasRankings && (
              <a className="rankings-link" href={`#${RANKINGS_ID}`} onClick={openRankings}>
                {t("How rankings work")} →
              </a>
            )}
          </details>
        ) : null;
      })()}
      {sorted.length > shown && (
        <button type="button" className="show-more" onClick={() => setShown(sorted.length)}>
          {t("Show more ({n} left)", { n: sorted.length - shown })}
        </button>
      )}
    </div>
  );
}
