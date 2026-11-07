"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import { useMemo, useRef, useState } from "react";
import RowLink from "@/components/RowLink";
import { useNames, useT } from "@/components/I18n";
import { KEPT, useKept } from "@/lib/kept";
import type { SynName, SynRow, SynTab } from "@/lib/synergies";
import "./synergies.css";

// Synergies on champion and augment pages (lib/synergies.ts): one table per kind of pairing (augments, items, full
// builds, augment combos, champions), best score first. The score is win rate points over the champion's usual
// choice, leaning on the estimate for choices with few games. Search by name, hide choices with few games (on by
// default), re-sort by score, pick rate or games, ten rows at a time.

const NS = "synergies";
const PAGE = 10;
type SortKey = "score" | "pick" | "games";

const pts = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)}`;
const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`;
const count = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

const iconSrc = (n: SynName) =>
  n.kind === "augments" ? `/icons/augments/${n.id}.webp` : n.kind === "champions" ? `/icons/champions/${n.id}.webp` : (n.icon ?? "");

export default function Synergies({ tabs, few, subject }: { tabs: SynTab[]; few: number; subject: SynName }) {
  const t = useT(NS);
  const tt = useT("tables");
  const names = useNames();
  const box = useRef<HTMLDivElement>(null);
  const [tabId, setTab] = useKept(tabs[0]?.id ?? "", box, "tab");
  const tab = tabs.find((x) => x.id === tabId) ?? tabs[0];
  const [hideFew, setHideFew] = useKept(true, box, "few");
  const [sort, setSort] = useKept<{ key: SortKey; desc: boolean }>({ key: "score", desc: true }, box, "sort");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const label = (r: SynRow) => r.names.map((n) => names(n.kind, n.id, n.name)).join(" + ");
  const share = !!tab?.share;
  const key: SortKey = share ? "pick" : sort.key;
  const rows = useMemo(() => {
    if (!tab) return [];
    const needle = q.trim().toLowerCase();
    return tab.rows
      .filter((r) => share || !hideFew || (r.games ?? Infinity) >= few)
      .filter((r) => !needle || label(r).toLowerCase().includes(needle))
      .sort((a, b) => ((a[key] ?? -Infinity) - (b[key] ?? -Infinity)) * (sort.desc || share ? -1 : 1));
    // label depends on the language's names, which `names` tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, hideFew, key, sort.desc, few, share, names]);
  if (!tab) return null;
  const fewCount = share ? 0 : tab.rows.filter((r) => (r.games ?? Infinity) < few).length;
  const best = !share && sort.key === "score" && sort.desc && !q ? rows[0] : undefined;
  const head = (k: SortKey, text: string) => (
    <span>
      <button
        type="button"
        className="syn-sort"
        aria-pressed={key === k}
        disabled={share}
        onClick={() => {
          setSort(sort.key === k ? { key: k, desc: !sort.desc } : { key: k, desc: true });
          setShown(PAGE);
        }}
      >
        {t(text)}
        <span aria-hidden="true">{key === k && !share ? (sort.desc ? " ↓" : " ↑") : ""}</span>
      </button>
    </span>
  );
  return (
    <div className="syn" ref={box} {...KEPT}>
      <div className="syn-bar">
        {tabs.length > 1 && (
          <div className="syn-seg" role="group" aria-label={t("Synergy type")}>
            {tabs.map((x) => (
              <button
                key={x.id}
                type="button"
                aria-pressed={x.id === tab.id}
                onClick={() => {
                  setTab(x.id);
                  setShown(PAGE);
                }}
              >
                {t(x.label)} <span className="syn-n">{x.rows.length}</span>
              </button>
            ))}
          </div>
        )}
        <input
          className="syn-search"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShown(PAGE);
          }}
          placeholder={t("Search")}
          aria-label={t("Search")}
        />
        {fewCount > 0 && (
          <label className="syn-few">
            <input
              type="checkbox"
              checked={hideFew}
              onChange={(e) => {
                setHideFew(e.target.checked);
                setShown(PAGE);
              }}
            />{" "}
            {t("Hide few games ({n})", { n: fewCount })}
          </label>
        )}
      </div>
      {best && best.score !== undefined && best.score > 0.0005 && (
        <p className="syn-callout">
          {t("Best fit for {subject}: {name}, {n} pts.", { subject: names(subject.kind, subject.id, subject.name), name: best.names.length > 2 ? t("this build") : label(best), n: pts(best.score) })}
        </p>
      )}
      <div className="syn-th" data-share={share || undefined}>
        <span>{t("Rank")}</span>
        <span>{t(tab.what)}</span>
        {share ? (
          <span>{t("Built by")}</span>
        ) : (
          <>
            {head("score", "Score")}
            {head("pick", "Pick rate")}
            {head("games", "Games")}
          </>
        )}
      </div>
      <div className="syn-rows">
        {rows.slice(0, shown).map((r, i) => {
          // A full build's six names don't fit: its icons carry the names (hover or screen readers) instead.
          const many = r.names.length > 2;
          // Pairs stack their icons over the names on phones, so the names keep the row's width.
          const cls = many ? "syn-what syn-many" : r.names.length === 2 ? "syn-what syn-pair" : "syn-what";
          const body = (
            <>
              <span className="syn-icons">
                {r.names.map((n, k) => (
                  <span key={k} className="syn-icon-wrap">
                    {k > 0 && n.kind === "augments" && (
                      <span className="syn-plus" aria-hidden="true">
                        +
                      </span>
                    )}
                    <img
                      className={n.kind === "augments" ? "syn-icon round" : "syn-icon"}
                      src={iconSrc(n)}
                      alt={many ? names(r.names[k].kind, r.names[k].id, r.names[k].name) : ""}
                      title={many ? names(r.names[k].kind, r.names[k].id, r.names[k].name) : undefined}
                      width={32}
                      height={32}
                      loading="lazy"
                    />
                  </span>
                ))}
              </span>
              <span className="syn-text">
                {!many && <span className="syn-name">{label(r)}</span>}
                <span className="syn-tags">
                  {r.slot && <span className="syn-pill">{t(r.slot)}</span>}
                  {!share && r.games !== undefined && r.games < few && <span className="syn-pill syn-few-tag">{t("Few games")}</span>}
                  {r.expected && !share && (
                    <span className="syn-pill" title={t("Leans on the estimate: few games of its own, or no game data for the pair.")}>
                      {t("Expected")}
                    </span>
                  )}
                  {r.sim === "agrees" && <span className="syn-pill syn-sim">{t("Simulator agrees")}</span>}
                  {r.sim === "disagrees" && (
                    <span className="syn-pill" title={t("Real games show it winning, but the Simulator's fight rates it lower.")}>
                      {t("Simulator disagrees")}
                    </span>
                  )}
                  {r.caution && (
                    <span className="syn-pill syn-caution" title={t("The bug finder found something untested about this combination.")}>
                      {t("Caution")}
                    </span>
                  )}
                </span>
              </span>
            </>
          );
          return (
            <div key={`${r.slot ?? ""}${r.names.map((n) => n.id).join("-")}`} className="syn-row" data-share={share || undefined}>
              <span className="syn-rk">#{i + 1}</span>
              {r.href ? (
                <RowLink className={cls} href={r.href}>
                  {body}
                </RowLink>
              ) : (
                <div className={cls}>{body}</div>
              )}
              {share ? (
                <span className="syn-cell">
                  <b>{pct(r.pick)}</b>
                </span>
              ) : (
                <>
                  <span className="syn-cell">
                    <b className={r.score === undefined ? "" : r.score > 0.0005 ? "delta-up" : r.score < -0.0005 ? "delta-down" : ""}>
                      {r.score === undefined ? "–" : tt("{n} pts", { n: pts(r.score) })}
                    </b>
                  </span>
                  <span className="syn-cell">
                    <b>{pct(r.pick)}</b>
                  </span>
                  <span className="syn-cell">
                    <b>{r.games === undefined ? "–" : count(r.games)}</b>
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
      {rows.length === 0 && <p className="syn-note">{t("Nothing matches.")}</p>}
      {rows.length > shown && (
        <button type="button" className="syn-more" onClick={() => setShown(shown + PAGE)}>
          {t("Show {n} more", { n: Math.min(PAGE, rows.length - shown) })}
        </button>
      )}
      <p className="syn-note">{t(tab.note)}</p>
    </div>
  );
}
