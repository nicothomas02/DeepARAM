"use client";

import { useT } from "@/components/I18n";

// A "Simulated" tag with its reason as a translated tooltip (the page around it is a server component).
export default function SimTag({ title, ns = "champions" }: { title: string; ns?: string }) {
  const t = useT(ns);
  return (
    <span className="tag tag-mixed cp-upg-tag" title={t(title)}>
      {t("Simulated")}
    </span>
  );
}
