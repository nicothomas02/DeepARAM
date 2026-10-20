import "server-only";
import { readRepoJson } from "./repo-data";
import { STYLES, type Style } from "./augment-tiers";

// The game's own build tags for Mayhem augments (data/official/augment-build-tags.json, from the mode file's
// mBuildTags), mapped onto the site's build styles. Tags the site has no style for (and augments without
// tags) give null, so callers keep their own guess.
const TAG_STYLE: Record<string, Style> = {
  crit: "crit",
  attack_speed: "onhit",
  on_hit: "onhit",
  ap: "ap",
  ability_power: "ap",
  pen: "lethality",
  lethality: "lethality",
  tank: "tank",
  support: "enchanter",
  fighter: "fighter",
};

let cache: Record<string, string[]> | null = null;
const tags = () => (cache ??= readRepoJson<Record<string, string[]>>("data/official/augment-build-tags.json") ?? {});

export function officialStyles(id: number): Style[] | null {
  const styles = [...new Set((tags()[String(id)] ?? []).flatMap((t) => (TAG_STYLE[t] ? [TAG_STYLE[t]] : [])))];
  return styles.length ? styles : null;
}

/** The style names (English, as the Tier List's style filter writes them) for an augment's official tags. */
export const officialStyleLabels = (id: number) => (officialStyles(id) ?? []).map((s) => STYLES[s]);
