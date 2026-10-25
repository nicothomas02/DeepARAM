"use client";

import { useT } from "./I18n";

// "Skip to content" for keyboard users. Moves focus without adding #main to the address, since
// embedded tools read the page's #hash.
export default function SkipLink() {
  const t = useT();
  return (
    <a
      className="skip-link"
      href="#main"
      onClick={(e) => {
        const main = document.getElementById("main");
        if (!main) return;
        e.preventDefault();
        main.focus();
        main.scrollIntoView();
      }}
    >
      {t("Skip to content")}
    </a>
  );
}
