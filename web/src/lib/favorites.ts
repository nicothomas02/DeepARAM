"use client";

import { useSyncExternalStore } from "react";

// Starred champions, saved in this browser's localStorage. They pin to the top of the Tier List
// and show in a card on the home page. Every change fires FAVORITES_EVENT; other tabs get "storage".

const KEY = "deeparam-favorites";
export const FAVORITES_EVENT = "deeparam-favorites";
const EVENT = FAVORITES_EVENT;
const EMPTY: string[] = [];

let cached: { raw: string | null; list: string[] } = { raw: null, list: EMPTY };
function read(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (raw === cached.raw) return cached.list;
  let list = EMPTY;
  try {
    const v = JSON.parse(raw || "[]");
    if (Array.isArray(v)) list = v.filter((x): x is string => typeof x === "string");
  } catch {}
  cached = { raw, list };
  return list;
}

function subscribe(fn: () => void) {
  const onStorage = (e: StorageEvent) => e.key === KEY && fn();
  addEventListener(EVENT, fn);
  addEventListener("storage", onStorage);
  return () => {
    removeEventListener(EVENT, fn);
    removeEventListener("storage", onStorage);
  };
}

export function toggleFavorite(id: string) {
  const list = read();
  setFavorites(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
}

/** Replaces the whole list (an account sync brings the saved one). */
export function setFavorites(next: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  dispatchEvent(new Event(EVENT));
}

export const readFavorites = read;

/** Starred champion ids, oldest first. Empty on the server and before hydration. */
export const useFavorites = () => useSyncExternalStore(subscribe, read, () => EMPTY);
