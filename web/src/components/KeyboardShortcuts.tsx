"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { switchTab } from "@/lib/subtab-nav";

// Site-wide keys, listed in a cheat sheet opened with "?". "/" and Ctrl+K (search) live in SearchPalette.
// "g" then a letter jumps to a page. Keys are ignored while typing in a field.

const GO: [string, string, string][] = [
  ["h", "/", "Home"],
  ["t", "/tier-list", "Tier List"],
  ["s", "/simulator", "Simulator"],
  ["k", "/kitchen", "The Kitchen"],
  ["p", "/pbe", "PBE"],
  ["r", "/patches", "Patches"],
  ["i", "/info", "About"],
];

const SHEET: { group: string; keys: [string[], string][] }[] = [
  {
    group: "Anywhere",
    keys: [
      [["/"], "Search"],
      [["Ctrl", "K"], "Search"],
      [["?"], "Show these shortcuts"],
      [["["], "Previous tab"],
      [["]"], "Next tab"],
      [["Esc"], "Close a panel or dialog"],
    ],
  },
  { group: "Go to", keys: GO.map(([k, , label]) => [["g", k], label]) },
];

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable);
};

export default function KeyboardShortcuts() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (document.querySelector("dialog[open]:not(.kbd-sheet)")) return;
      const k = e.key;
      if (pendingG) {
        clearTimeout(pendingG);
        pendingG = 0;
        const hit = GO.find(([key]) => key === k.toLowerCase());
        if (hit) {
          e.preventDefault();
          router.push(hit[1]);
        }
        return;
      }
      if (k === "?") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (k === "g") {
        pendingG = window.setTimeout(() => (pendingG = 0), 1200);
      } else if (k === "[" || k === "]") {
        e.preventDefault();
        switchTab(k === "]" ? 1 : -1);
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      clearTimeout(pendingG);
      removeEventListener("keydown", onKey);
    };
  }, [router]);

  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className="kbd-sheet"
      aria-labelledby="kbd-title"
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
    >
      <div className="kbd-inner">
        <div className="kbd-head">
          <h2 id="kbd-title">Keyboard shortcuts</h2>
          <button type="button" className="kbd-close" aria-label="Close" onClick={() => dialog.current?.close()}>
            ×
          </button>
        </div>
        {SHEET.map((s) => (
          <section key={s.group}>
            <h3>{s.group}</h3>
            <dl>
              {s.keys.map(([keys, label]) => (
                <div key={keys.join("+") + label}>
                  <dt>
                    {keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="kbd-then">{keys[0] === "g" ? "then" : "+"}</span>}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
