"use client";

import { useT } from "@/components/I18n";

/** Why a list's top pick is marked (lib/card-score.ts closeCall, research/confidence 2026-11-27). */
export const CLOSE_CALL_WHY =
  "The next pick is about as good: the gap is smaller than the noise in the games behind it. When a top pick led by this little, it was still on top next patch only about half the time.";

/** A "Close call" tag on a list's top pick (Nico 2026-11-27: show confidence, not just ranks). Tap or hover for why. */
export default function CloseCall() {
  const t = useT("champions");
  const why = t(CLOSE_CALL_WHY);
  return (
    <button type="button" className="aug-item-tag cp-close-tag" data-tip={why} aria-description={why}>
      {t("Close call")}
    </button>
  );
}
