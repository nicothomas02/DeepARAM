"use client";

import { useT } from "@/components/I18n";

// The name of an ability value Mayhem changes ("R1APRatio" → "R1 AP Ratio"), in the page's language.
// The champion tab already translates these words, so its dictionaries are reused.

export default function ChangeName({ name }: { name: string }) {
  const t = useT("/embed/champions/i18n");
  return t(
    name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
      .replace(/_/g, " "),
  );
}
