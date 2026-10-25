"use client";

import { useEffect, useRef, useState } from "react";

// The invisible "are you a person?" check (lib/bot-check.ts) for forms in the page. While the check is
// off on the server, `token()` returns "" and the server lets the form through.

type Turnstile = { render(el: HTMLElement, o: Record<string, unknown>): string; reset(id: string): void; remove(id: string): void };
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let script: Promise<void> | null = null;
function load(src: string) {
  script ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      script = null;
      reject(new Error("bot check didn't load"));
    };
    document.head.appendChild(s);
  });
  return script;
}

/** A box to place in the form, and the current token to send with it. */
export function useBotCheck() {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    let gone = false;
    (async () => {
      const cfg = (await fetch("/api/bot-check").then((r) => r.json()).catch(() => ({}))) as { siteKey?: string | null; script?: string };
      if (!cfg.siteKey || !cfg.script) return;
      await load(cfg.script).catch(() => {});
      if (gone || !box.current || !window.turnstile) return;
      widget.current = window.turnstile.render(box.current, {
        sitekey: cfg.siteKey,
        appearance: "interaction-only",
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(""),
      });
    })();
    return () => {
      gone = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, []);

  /** Each token works once; call after sending one. */
  const reset = () => {
    setToken("");
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  };

  return { box, token, reset };
}
