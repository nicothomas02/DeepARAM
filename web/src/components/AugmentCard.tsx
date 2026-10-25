/* eslint-disable @next/next/no-img-element -- small static card art and icons, no resizing needed */
/* An augment drawn like the in-game offer card: holo card face, the tier's swirl
   behind the icon, and the tier's ability frame. Art lives in public/augment-card. */

import { localAsset } from "@/lib/assets";

type Tier = "silver" | "gold" | "prismatic";

const tierOf = (t?: string): Tier => (t === "silver" || t === "prismatic" ? t : "gold");

export default function AugmentCard({
  name,
  tier,
  icon,
  set,
  children,
  removed,
  compact,
}: {
  name: React.ReactNode;
  tier?: string;
  icon?: string;
  set?: string;
  children?: React.ReactNode;
  removed?: boolean;
  compact?: boolean;
}) {
  const t = tierOf(tier);
  return (
    <article className={`aug-card aug-${t}${removed ? " aug-removed" : ""}${compact ? " aug-compact" : ""}`}>
      <div className="aug-art" aria-hidden>
        <img className="aug-back" src={`/augment-card/back-${t}.png`} alt="" />
        <img className="aug-icon" src={localAsset(icon) ?? `/augment-card/generic-${t}.png`} alt="" loading="lazy" />
        <img className="aug-frame" src={`/augment-card/frame-${t}.png`} alt="" />
      </div>
      <div className="aug-text">
        <h4>{name}</h4>
        {set && <span className="aug-set">{set}</span>}
        {children && <div className="aug-desc">{children}</div>}
      </div>
    </article>
  );
}
