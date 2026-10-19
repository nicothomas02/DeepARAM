import type { Metadata } from "next";
import Link from "next/link";
import Intro from "@/components/Intro";
import { pageMeta } from "@/lib/meta";
import { recap, recapPatches } from "@/lib/patches";
import { Name, T } from "@/components/I18n";

export const metadata: Metadata = pageMeta(
  "/patches",
  "ARAM Mayhem Patch Recaps",
  "Every ARAM Mayhem patch at a glance: augments added, removed and changed, and the champions that rose and fell most.",
);

const pts = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}`;

export default function PatchesPage() {
  const recaps = recapPatches()
    .map((p) => recap(p)!)
    .filter(Boolean);
  return (
    <>
      <Intro eyebrow={<T ns="patches">Patch Recaps</T>} title={<T ns="patches">What every patch changed.</T>}>
        <T ns="patches">Augment changes and the biggest champion risers and fallers, patch by patch.</T>
      </Intro>
      <div className="recap-index">
        {recaps.map((r, i) => (
          <Link key={r.patch} className="card recap-row" href={`/patches/${r.patch}`} data-accent={i === 0 ? "tier" : undefined}>
            <b className="recap-patch">
              {r.patch}
              {i === 0 && (
                <span className="chip">
                  <T ns="patches">Live</T>
                </span>
              )}
            </b>
            <span className="recap-meta">
              {r.hasAugmentHistory ? (
                <T
                  ns="patches"
                  v={{
                    added: r.added.length,
                    removed: r.removed.length,
                    changed: r.changed.length,
                  }}
                >
                  {"{added} added · {removed} removed · {changed} changed"}
                </T>
              ) : (
                <T ns="patches">Win rates only</T>
              )}
            </span>
            {r.up[0] && (
              <span className="recap-top">
                <small className="recap-top-label">
                  <T ns="patches">Rose the most</T>
                </small>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/icons/champions/${r.up[0].id}.webp`} alt="" width={22} height={22} loading="lazy" />
                <Name kind="champions" id={r.up[0].id}>
                  {r.up[0].name}
                </Name>{" "}
                <span className="delta-up">
                  <T ns="patches" v={{ n: pts(r.up[0].change) }}>
                    {"{n} pts"}
                  </T>
                </span>
              </span>
            )}
          </Link>
        ))}
      </div>
    </>
  );
}
