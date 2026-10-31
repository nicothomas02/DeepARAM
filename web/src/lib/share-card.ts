"use client";

// Draws a 1200×630 share image (the size social sites preview) on a canvas, from the site's own
// colours and fonts and same-origin images, and returns it as a PNG.

export type CardSpec = {
  title: string;
  subtitle?: string;
  /** Wide background art (a splash), faded under the text. */
  art?: string;
  /** Square icon beside the title. */
  icon?: string;
  badge?: { text: string; color: string; ink: string };
  stats: { label: string; value: string; tone?: "good" | "bad" }[];
  /** Small icons along the bottom (augments, items), with a label above them. */
  row?: { label: string; icons: string[] };
  url: string;
};

const W = 1200;
const H = 630;

const img = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    i.decoding = "async";
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });

// "#rrggbb" plus an alpha byte; other colour formats are used as they are.
const alpha = (c: string, a: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export async function drawCard(spec: CardSpec): Promise<Blob | null> {
  await document.fonts?.ready;
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
  const bg = v("--bg", "#090b0f");
  const fg = v("--fg", "#e8edf3");
  const muted = v("--muted", "#8b95a5");
  const line = v("--line", "#222a36");
  const surface = v("--surface", "#11151c");
  const accent = v("--accent", "#5cc0ff");
  const good = v("--good", "#3ccf91");
  const bad = v("--bad", "#f06a6a");
  const display = getComputedStyle(document.querySelector("h1") ?? document.body).fontFamily;
  const sans = getComputedStyle(document.body).fontFamily;

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const [art, icon, ...rowIcons] = await Promise.all([spec.art ? img(spec.art) : null, spec.icon ? img(spec.icon) : null, ...(spec.row?.icons ?? []).map(img)]);

  // Art on the right, fading into the background toward the text.
  if (art) {
    const h = H;
    const w = (art.width / art.height) * h;
    ctx.globalAlpha = 0.75;
    ctx.drawImage(art, W - w + w * 0.12, 0, w, h);
    ctx.globalAlpha = 1;
    const fade = ctx.createLinearGradient(0, 0, W, 0);
    fade.addColorStop(0.3, bg);
    fade.addColorStop(0.75, alpha(bg, "00"));
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, H);
    const bottom = ctx.createLinearGradient(0, H * 0.55, 0, H);
    bottom.addColorStop(0, alpha(bg, "00"));
    bottom.addColorStop(1, bg);
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 0, W, H);
  } else {
    const glow = ctx.createRadialGradient(W * 0.85, H * 0.2, 0, W * 0.85, H * 0.2, W * 0.6);
    glow.addColorStop(0, alpha(accent, "33"));
    glow.addColorStop(1, alpha(bg, "00"));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  // Accent bar along the top.
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 6);

  const x = 64;
  let y = 84;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = accent;
  ctx.font = `600 22px ${sans}`;
  ctx.fillText("DeepARAM · ARAM Mayhem", x, y);

  y = 150;
  let tx = x;
  if (icon) {
    ctx.save();
    roundRect(ctx, x, y, 112, 112, 22);
    ctx.clip();
    ctx.drawImage(icon, x, y, 112, 112);
    ctx.restore();
    tx = x + 136;
  }
  ctx.fillStyle = fg;
  let size = 76;
  ctx.font = `700 ${size}px ${display}`;
  while (ctx.measureText(spec.title).width > 640 && size > 40) ctx.font = `700 ${(size -= 4)}px ${display}`;
  ctx.fillText(spec.title, tx, y + 70);
  if (spec.subtitle) {
    ctx.fillStyle = muted;
    ctx.font = `400 28px ${sans}`;
    ctx.fillText(spec.subtitle, tx, y + 110);
  }

  // Stat tiles.
  y = 320;
  let sx = x;
  const tiles = [...(spec.badge ? [{ label: "Tier", value: spec.badge.text, badge: spec.badge }] : []), ...spec.stats];
  for (const t of tiles) {
    ctx.font = `700 46px ${display}`;
    const valueW = ctx.measureText(t.value).width;
    ctx.font = `500 20px ${sans}`;
    const w = Math.max(170, valueW + 48, ctx.measureText(t.label.toUpperCase()).width + 48);
    roundRect(ctx, sx, y, w, 116, 18);
    ctx.fillStyle = alpha(surface, "e6");
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.font = `500 20px ${sans}`;
    ctx.fillText(t.label.toUpperCase(), sx + 24, y + 38);
    if ("badge" in t && t.badge) {
      roundRect(ctx, sx + 24, y + 52, 52, 48, 12);
      ctx.fillStyle = t.badge.color;
      ctx.fill();
      ctx.fillStyle = t.badge.ink;
      ctx.font = `700 32px ${display}`;
      ctx.textAlign = "center";
      ctx.fillText(t.value, sx + 50, y + 88);
      ctx.textAlign = "left";
    } else {
      const tone = "tone" in t ? t.tone : undefined;
      ctx.fillStyle = tone === "good" ? good : tone === "bad" ? bad : fg;
      ctx.font = `700 46px ${display}`;
      ctx.fillText(t.value, sx + 24, y + 94);
    }
    sx += w + 18;
  }

  // Icon row.
  if (spec.row && rowIcons.some(Boolean)) {
    y = 482;
    ctx.fillStyle = muted;
    ctx.font = `500 20px ${sans}`;
    ctx.fillText(spec.row.label.toUpperCase(), x, y);
    let ix = x;
    for (const r of rowIcons) {
      if (!r) continue;
      ctx.save();
      roundRect(ctx, ix, y + 16, 64, 64, 12);
      ctx.clip();
      ctx.drawImage(r, ix, y + 16, 64, 64);
      ctx.restore();
      ix += 76;
    }
  }

  ctx.fillStyle = muted;
  ctx.font = `500 22px ${sans}`;
  ctx.textAlign = "right";
  ctx.fillText(spec.url.replace(/^https?:\/\//, "").replace(/[?#].*$/, ""), W - 56, H - 44);
  ctx.textAlign = "left";

  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}
