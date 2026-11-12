import { T } from "./I18n";
import { halfWidth, sampleLevel, wilson } from "@/lib/stats";

// A number with how far it can be trusted (lib/stats.ts). Usable from server and client components.
//   Simple view:   the number, plus a quiet "Few games" tag when the 95% range is wider than ±5 pts, or
//                  "Too few games" (number dimmed) under 10 games.
//   Detailed view: adds the 95% range as "±0.4" (html[data-view=detailed], globals.css .wr-ci).
// Without a game count it's just the number.

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

/** Wraps any rate-like value (a win rate, a win rate boost) with its range and low-sample tag; `p` is the win
 *  rate behind it (0.5 when unknown, the widest case). */
export function Sampled({ n, p = 0.5, children }: { n?: number | null; p?: number; children: React.ReactNode }) {
  if (n == null || !Number.isFinite(n)) return <>{children}</>;
  const level = sampleLevel(n, p);
  const pm = halfWidth(p, n) * 100;
  return (
    <span className="wr" data-sample={level}>
      {children}
      <span className="wr-ci">±{pm < 0.1 ? "0.1" : pm.toFixed(pm < 10 ? 1 : 0)}</span>
      {level !== "ok" && (
        <span className="wr-few">
          <T ns="tables">{level === "none" ? "Too few games" : "Few games"}</T>
        </span>
      )}
    </span>
  );
}

/** A win rate, "52.3%", with its range on hover and in Detailed view. */
export default function WinRate({ p, n, digits = 1 }: { p: number; n?: number | null; digits?: number }) {
  const text = pct(p, digits);
  if (n == null || !Number.isFinite(n)) return <>{text}</>;
  const [lo, hi] = wilson(p, n);
  return (
    <Sampled n={n} p={p}>
      <span title={`95%: ${pct(lo)} – ${pct(hi)}`}>{text}</span>
    </Sampled>
  );
}
