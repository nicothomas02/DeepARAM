"use client";

import LanguagePicker from "./LanguagePicker";
import { useT } from "./I18n";

/** The language list in the header, beside Settings, so it can be changed in one step (Nico, 2026-11-20). Phones keep
 *  it in Settings, where there is room. */
export default function HeaderLanguage() {
  const t = useT();
  return (
    <label className="header-lang" title={t("Language")}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
      <LanguagePicker className="header-lang-select" />
    </label>
  );
}
