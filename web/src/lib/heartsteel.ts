import "server-only";
import { STICKERS, stickerValue, type Kinds, type OverlayChamp, type Picks } from "./engine/build-engine";
import { quickBuilds } from "./quick-build";
import { damageTypes } from "./damage-types";
import { augmentPicks } from "./augment-picks";

// The Tier List's HEARTSTEEL tab (?tab=heartsteel): in a HEARTSTEEL game, augment cards can carry a sticker from one
// of the six HEARTSTEEL members, each with a bonus (STICKERS, the game's own text). No match data records stickers, so
// every value here is estimated by the shared build engine's stickerValue (lib/engine/build-engine.ts, the same number
// both apps use): the bonus's stats priced at basic-item gold, counted only where the champion's usual build uses them,
// then turned into win-rate points (Nico approved rule-based estimates, 2026-11-24). Values are for an augment taken
// at level 1; per-level stickers (Ezreal, Sett) are worth a little less later in the game.

export const MEMBERS = Object.keys(STICKERS);
/** The members' champion ids, for icons and names ("K'Sante" is KSante). */
export const MEMBER_ID: Record<string, string> = { Aphelios: "Aphelios", Ezreal: "Ezreal", Kayn: "Kayn", "K'Sante": "KSante", Sett: "Sett", Yone: "Yone" };

export type StickerPick = { member: string; points: number; why: string };
export type HeartsteelRow = { champion: string; best: StickerPick; next: StickerPick | null };
export type StickerSummary = { member: string; bonus: string; average: number; bestFor: number };

let cache: { champions: HeartsteelRow[]; stickers: StickerSummary[] } | null = null;

export function heartsteel(): { champions: HeartsteelRow[]; stickers: StickerSummary[] } {
  if (cache) return cache;
  const kinds = damageTypes() as unknown as Kinds;
  const picks = augmentPicks() as unknown as Picks;
  const all = new Map<string, number[]>();
  const champions: HeartsteelRow[] = quickBuilds().flatMap((q) => {
    const champ = q as unknown as OverlayChamp;
    const vals = MEMBERS.flatMap((m) => {
      const v = stickerValue(m, champ, kinds, picks, 1);
      if (v) all.set(m, [...(all.get(m) ?? []), v.points]);
      return v ? [{ member: m, points: v.points, why: v.why }] : [];
    }).sort((a, b) => b.points - a.points);
    return vals.length ? [{ champion: q.id, best: vals[0], next: vals[1] ?? null }] : [];
  });
  const stickers = MEMBERS.map((m) => {
    const list = all.get(m) ?? [];
    return {
      member: m,
      bonus: STICKERS[m],
      average: list.length ? Math.round((list.reduce((t, x) => t + x, 0) / list.length) * 100) / 100 : 0,
      bestFor: champions.filter((c) => c.best.member === m).length,
    };
  }).sort((a, b) => b.average - a.average);
  cache = { champions, stickers };
  return cache;
}
