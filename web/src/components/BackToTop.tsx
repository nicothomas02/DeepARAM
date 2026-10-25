"use client";

import { useEffect, useState } from "react";
import { useT } from "./I18n";

// A "back to top" button that appears after scrolling down a couple of screens. Jumps instantly when
// motion is reduced. Sits above the phone tab bar.
export default function BackToTop() {
  const [show, setShow] = useState(false);
  const t = useT();
  useEffect(() => {
    const check = () => setShow(scrollY > innerHeight * 1.5);
    check();
    addEventListener("scroll", check, { passive: true });
    return () => removeEventListener("scroll", check);
  }, []);
  if (!show) return null;
  const reduced = () => document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <button
      type="button"
      className="back-to-top"
      aria-label={t("Back to top")}
      title={t("Back to top")}
      onClick={() => {
        scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
        document.getElementById("main")?.focus({ preventScroll: true });
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
