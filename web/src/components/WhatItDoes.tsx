"use client";

import { useT } from "./I18n";
import type { Effect } from "@/lib/mechanisms";
import { whatItDoesText } from "@/lib/mechanism-text";

/** The "What it does" line as a note (item pages); augment pages put it in the DeepScore hover. */
export default function WhatItDoes({ effects }: { effects: Effect[] }) {
  const t = useT("tables");
  if (!effects.length) return null;
  return <p className="table-note what-it-does">{whatItDoesText(t, effects)}</p>;
}
