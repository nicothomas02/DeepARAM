"use client";

import { useEffect, useState } from "react";

// The visitor's recently played Mayhem games, newest first, kept in this browser (localStorage
// "deeparam-played"). My Stats writes it whenever this browser has synced games loaded; Home shows it.

export type Played = { champion: string; win: boolean; at: number };
const KEY = "deeparam-played";
const EVENT = "deeparam-played";

export function loadPlayed(): Played[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter((g) => g && typeof g.champion === "string" && /^[A-Za-z0-9_]+$/.test(g.champion) && typeof g.win === "boolean" && Number.isFinite(g.at))
      .sort((a, b) => b.at - a.at)
      .slice(0, 12);
  } catch {
    return [];
  }
}

export function usePlayed() {
  const [list, setList] = useState<Played[]>([]);
  useEffect(() => {
    const sync = () => setList(loadPlayed());
    sync();
    addEventListener(EVENT, sync);
    addEventListener("storage", sync);
    return () => {
      removeEventListener(EVENT, sync);
      removeEventListener("storage", sync);
    };
  }, []);
  return list;
}
