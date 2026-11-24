"use client";

import { useEffect, useState } from "react";
import { signedIn } from "./account-sync";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { getParam } from "./url-state";

export const BRACKET_KEYS = ["all", "casual", "mid", "high"] as const;
export type BracketKey = (typeof BRACKET_KEYS)[number];

/**
 * The visitor's skill bracket (Tier List picker, champion pages): ?bracket= from a shared link, else the remembered
 * choice (settings, synced to the account), else All players, or Top 5% for the site owner (Nico 2026-11-23).
 * Setting it remembers it.
 */
export function useBracket(): [BracketKey, (b: BracketKey) => void] {
  const [bracket, setBracket] = useState<BracketKey>("all");
  useEffect(() => {
    const b = getParam("bracket");
    if (b && (BRACKET_KEYS as readonly string[]).includes(b)) return setBracket(b as BracketKey);
    const saved = loadSettings().bracket;
    if (saved !== "auto") return setBracket(saved);
    if (!signedIn()) return;
    let alive = true;
    fetch("/api/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => alive && a?.owner && setBracket("high"))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const choose = (b: BracketKey) => {
    setBracket(b);
    saveSettings({ bracket: b as Settings["bracket"] });
  };
  return [bracket, choose];
}
