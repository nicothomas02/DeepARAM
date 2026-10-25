/* eslint-disable @next/next/no-img-element -- drawn into a PNG, not a page */
import { ImageResponse } from "next/og";
import championNames from "@/data/champion-names.json";
import shareBuilds from "@/data/share-builds.json";

// The link preview card for a shared build (/share/builds?champ=Jinx&items=…&augs=…): the champion, its items
// and its augments on the same card look as a Chef Special's share image. Items and augments are simulator
// keys or game ids; unknown ones are left out. 1200x630, cached a day.

const NAMES = championNames as Record<string, string>;
const DATA = shareBuilds as { champions: Record<string, string>; items: Record<string, { name: string; icon: string }>; augments: Record<string, { name: string; rarity: string }> };
const RARITY: Record<string, string> = { silver: "#b9c2ce", gold: "#e0b04a", prismatic: "linear-gradient(100deg, #9fe7ff, #c9b8ff 40%, #ffb8e0 70%, #ffe2a3)" };

const list = (v: string | null, max: number) => (v ?? "").split(/[,+]/).map((s) => s.trim()).filter(Boolean).slice(0, max);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// Pictures are fetched here and drawn from data URLs: the image renderer refuses to fetch from a local
// address itself, which is what the site's own address is in development and tests.
async function dataUrl(src: string): Promise<string | null> {
  try {
    const r = await fetch(src);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${r.headers.get("content-type") || "image/png"};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const champ = Object.keys(NAMES).find((k) => k.toLowerCase() === (q.get("champ") ?? "").toLowerCase()) ?? "";
  const items = list(q.get("items"), 6).map((k) => DATA.items[k]).filter(Boolean);
  const augs = list(q.get("augs"), 4).map((k) => DATA.augments[k]).filter(Boolean);
  const name = champ ? NAMES[champ] : "ARAM Mayhem";
  const title = clip((q.get("title") ?? "").replace(/\s+/g, " ").trim(), 44) || (champ ? `${name} build` : "An ARAM Mayhem build");
  const abs = (p: string) => new URL(p, url.origin).href;
  const [champImg, ...itemImgs] = await Promise.all([DATA.champions[champ] ? dataUrl(abs(DATA.champions[champ])) : null, ...items.map((it) => dataUrl(abs(it.icon)))]);

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#090b0f", color: "#e9edf2", padding: "52px 64px", position: "relative", fontSize: 28 }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, background: "linear-gradient(90deg, #e0b04a, #7a3b6e)" }} />
        <div style={{ display: "flex", color: "#e0b04a", fontSize: 24, letterSpacing: 3 }}>{q.get("to") === "kitchen" ? "THE KITCHEN · COMMUNITY BUILD" : "ARAM MAYHEM BUILD"}</div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 24 }}>
          {champImg && <img src={champImg} width={150} height={150} style={{ borderRadius: 24, border: "3px solid #4a2a44" }} alt="" />}
          <div style={{ display: "flex", flexDirection: "column", marginLeft: champImg ? 36 : 0, maxWidth: champImg ? 860 : 1072 }}>
            <div style={{ display: "flex", fontSize: title.length > 24 ? 52 : 68, lineHeight: 1.1 }}>{title}</div>
            <div style={{ display: "flex", color: "#9aa3af", fontSize: 34, marginTop: 12 }}>{q.get("title") ? name : "Simulated in DeepARAM"}</div>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 32 }}>
          {itemImgs.map((src, i) => src && <img key={i} src={src} width={92} height={92} style={{ borderRadius: 14, border: "2px solid #232a33", marginRight: 16 }} alt="" />)}
        </div>
        <div style={{ display: "flex", marginTop: 20, flexWrap: "wrap" }}>
          {augs.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", background: "#12161c", border: "1px solid #232a33", borderRadius: 14, padding: "12px 20px", marginRight: 14, fontSize: 26 }}>
              <div style={{ display: "flex", width: 16, height: 16, borderRadius: 8, background: RARITY[a.rarity] ?? "#9aa3af", marginRight: 12 }} />
              {clip(a.name, 26)}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "auto" }}>
          <div style={{ display: "flex", fontSize: 34 }}>DeepARAM</div>
          <div style={{ display: "flex", color: "#9aa3af", fontSize: 24 }}>deeparam.com</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
