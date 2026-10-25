"use client";

import { useT } from "./I18n";

// A DeepScore badge: the 0-100 rating in a ring that fills and shifts colour with the score (red at the
// bottom, through green at average, to violet at the top). Hovering, focusing or tapping it shows how
// DeepScore works (lib/deepscore.ts). `static` drops the button, for use inside a link.

// The ring colour (globals.css .deepscore) as "r g b", for browsers without oklch() or color-mix().
function ringRgb(value: number): string {
  const h = ((25 + value * 2.4) * Math.PI) / 180;
  const [L, a, b] = [0.72, 0.17 * Math.cos(h), 0.17 * Math.sin(h)];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)))).join(" ");
}

export default function DeepScore({ value, help, static: still }: { value: number; help?: string; static?: boolean }) {
  const t = useT("tables");
  const style = {
    "--ds": value,
    "--ds-c-rgb": ringRgb(value),
  } as React.CSSProperties;
  const label = t("DeepScore {n}", { n: value });
  if (still || !help) {
    return (
      <span className="deepscore" style={style} aria-label={label}>
        {value}
      </span>
    );
  }
  return (
    <button type="button" className="deepscore" style={style} data-tip={t(help)} aria-label={label} aria-description={t(help)}>
      {value}
    </button>
  );
}
