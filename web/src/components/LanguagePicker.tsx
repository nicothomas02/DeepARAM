"use client";

import { LANGS } from "@/lib/i18n";
import { setLang, useLang, useT } from "./I18n";

/** The site's language, as a list of Riot's languages in their own names. In Settings. */
export default function LanguagePicker({ className }: { className?: string }) {
  const lang = useLang();
  const t = useT();
  return (
    <select className={className ?? "lang-picker"} value={lang} aria-label={t("Language")} onChange={(e) => setLang(e.target.value)}>
      {LANGS.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
