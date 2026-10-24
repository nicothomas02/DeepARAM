"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { loadSettings } from "@/lib/settings";

// Whether the tier list's tables show every stat the data has. Each table with extra columns has its own
// "Show more stats" button (DataTable); the choice is shared by the page's tables, starts on when
// Settings > Page detail is "Detailed", and is remembered in this browser (Settings > Remember my views).

const Ctx = createContext<{
  advanced: boolean;
  setAdvanced: (v: boolean) => void;
}>({ advanced: false, setAdvanced: () => {} });

export const useAdvanced = () => useContext(Ctx).advanced;

const KEY = "deeparam-view-advanced";

export function AdvancedProvider({ children }: { children: React.ReactNode }) {
  const [advanced, setState] = useState(false);
  useEffect(() => {
    try {
      const s = loadSettings();
      const saved = s.remember ? localStorage.getItem(KEY) : null;
      if (saved === "1" || (saved === null && s.view === "detailed")) setState(true);
    } catch {}
  }, []);
  const setAdvanced = (v: boolean) => {
    setState(v);
    try {
      if (loadSettings().remember) localStorage.setItem(KEY, v ? "1" : "0");
    } catch {}
  };
  return <Ctx.Provider value={{ advanced, setAdvanced }}>{children}</Ctx.Provider>;
}
