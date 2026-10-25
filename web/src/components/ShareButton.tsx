"use client";

import { useState } from "react";
import { buzz } from "@/lib/haptics";
import { useT } from "./I18n";

// A "Share" button for a link: the phone's share sheet where there is one, else it copies the link.
// `url` defaults to this page's address (pages keep their state in the query); a function is read on
// the tap, for pages whose address changes as you use them. Used by build cards
// and The Lab's Chef Special cards, so both look and read the same.

export default function ShareButton({ url, title, text, label = "Share" }: { url?: string | (() => string); title?: string; text?: string; label?: string }) {
  const t = useT();
  const [note, setNote] = useState("");

  const share = async () => {
    const link = new URL((typeof url === "function" ? url() : url) ?? location.href, location.origin).href;
    const coarse = matchMedia("(pointer: coarse)").matches;
    if (coarse && navigator.share) {
      try {
        await navigator.share({ url: link, title, text });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      buzz("done");
      setNote(t("Link copied"));
    } catch {
      window.prompt(t("Copy this link"), link);
    }
    setTimeout(() => setNote(""), 2500);
  };

  return (
    <button type="button" className="share-btn" onClick={share}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
      </svg>
      <span aria-live="polite">{note || t(label)}</span>
    </button>
  );
}
