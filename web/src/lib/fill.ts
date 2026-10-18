import "server-only";
import championIds from "@/data/champion-ids.json";
import { official } from "./dd-swap";
import { livePatch } from "./highlights";
import { readRepoJson } from "./repo-data";
import type { Rated } from "./champion-page";

// TEMPORARY fill for the two things the main stats feed lacks: summoner spells and game counts
// (data/fill/README.md). Shown only while data/fill/config.json is switched on and the file is for the
// live patch. To remove: delete data/fill/, this file and its imports.

type FillFile = {
  patch: string;
  champions: Record<string, { games: number; spells: { ids: number[]; games: number; pick_rate: number; win_rate: number }[] }>;
};
type ClientSpell = { id: number; name: string; iconPath: string };

export type SpellRow = Rated & { spells: { id: number; name: string; icon: string }[]; games: number };

const IDS = championIds as Record<string, number>;
const CLIENT = "public/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default";

let cached: FillFile | null | undefined;
function data(): FillFile | null {
  if (cached === undefined) {
    const on = readRepoJson<{ enabled?: boolean }>("data/fill/config.json")?.enabled === true;
    const file = on ? readRepoJson<FillFile>("data/fill/spells_games.json") : null;
    cached = file && file.patch === livePatch() ? file : null;
  }
  return cached;
}

let spellInfo: Map<number, { name: string; icon: string }> | undefined;
/** A summoner spell's name and icon by id. */
export function spell(id: number) {
  if (!spellInfo) {
    spellInfo = new Map(
      (readRepoJson<ClientSpell[]>(`web/${CLIENT}/v1/summoner-spells.json`) ?? []).map((s) => [
        s.id,
        {
          name: s.name,
          // The client path, lowercased under the mirrored game-data folder, then its official copy.
          icon: official(`/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/${s.iconPath.replace("/lol-game-data/assets/", "").toLowerCase()}`),
        },
      ]),
    );
  }
  return spellInfo.get(id);
}

/** Live-patch game count per champion alias, or null when the fill is off. */
export function fillGames(): Record<string, number> | null {
  const d = data();
  if (!d) return null;
  return Object.fromEntries(
    Object.entries(IDS).flatMap(([alias, id]) => (d.champions[id]?.games ? [[alias, d.champions[id].games]] : [])),
  );
}

/** A champion's live-patch spell pairs, most common first; empty when the fill is off. */
export function fillSpells(alias: string, base: number): SpellRow[] {
  const c = data()?.champions[IDS[alias]];
  if (!c) return [];
  return c.spells.flatMap((s) => {
    const spells = s.ids.map((id) => (spell(id) ? { id, ...spell(id)! } : null));
    if (spells.some((x) => !x)) return [];
    return [{ spells: spells as SpellRow["spells"], games: s.games, winRate: s.win_rate, pickRate: s.pick_rate, lift: s.win_rate - base }];
  });
}
