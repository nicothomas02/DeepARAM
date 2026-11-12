"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "./I18n";
import { getParam, setParams } from "@/lib/url-state";
import { patchName } from "@/lib/patch-name";

// The stat range switch on champion, augment and item pages (lib/stat-ranges.ts): live patch, last patch,
// this set or all time. The server renders every range's numbers; RangeView shows the picked one. Pages
// open on the live patch; ?range= in a shared link opens another, and the pick carries over to the next
// stat page opened in the same tab.

type RangeKey = "live" | "prev" | "set" | "all";
type RangeOption = { key: RangeKey; label: string; patches: string[] };

const KEYS: RangeKey[] = ["live", "prev", "set", "all"];
const STORE = "deeparam-stat-range";

let current: RangeKey = "live";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => current;
const serverSnapshot = (): RangeKey => "live";

function pick(key: RangeKey) {
  current = key;
  try {
    sessionStorage.setItem(STORE, key);
  } catch {}
  listeners.forEach((fn) => fn());
}

const isKey = (v: string | null): v is RangeKey => KEYS.includes(v as RangeKey);

function useRange(): RangeKey {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** The range buttons, with the patches the picked range covers. */
export function RangePicker({ ranges }: { ranges: RangeOption[] }) {
  const t = useT();
  const range = useRange();
  useEffect(() => {
    const fromUrl = getParam("range");
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(STORE);
    } catch {}
    const start = isKey(fromUrl) ? fromUrl : isKey(stored) ? stored : "live";
    if (start !== current) pick(start);
    // A pick carried over from another page goes in the address too, so a copied link shows the same numbers.
    if (start !== "live" && !isKey(fromUrl) && ranges.some((r) => r.key === start)) setParams({ range: start });
    // Only on arrival: later picks set the address themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (ranges.length < 2) return null;
  const shown = ranges.find((r) => r.key === range) ?? ranges[0];
  const first = patchName(shown.patches[0]);
  const last = patchName(shown.patches[shown.patches.length - 1]);
  return (
    <div className="stat-range">
      <div className="seg" role="group" aria-label={t("Stats over")}>
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={r.key === shown.key}
            onClick={() => {
              pick(r.key);
              setParams({ range: r.key === "live" ? null : r.key });
            }}
          >
            {t(r.label)}
          </button>
        ))}
      </div>
      <small className="stat-range-span">
        {first === last ? t("Patch {patch}", { patch: first }) : t("Patches {a} to {b}", { a: first, b: last })}
        {shown.key !== "live" && <> · {t("The rest of the page stays on the live patch.")}</>}
      </small>
    </div>
  );
}

/** Shows the picked range's view, or the live patch's when this page has no view for it. */
export function RangeView({ views }: { views: Partial<Record<RangeKey, ReactNode>> }) {
  const range = useRange();
  return <>{views[range] ?? views.live ?? null}</>;
}
