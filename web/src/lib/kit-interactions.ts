import data from "@/data/kit-interactions.json";

// Champion and augment interactions that hinge on the champion's own kit (data/kit-interactions.json),
// written and checked by hand. A champion page shows one only while that champion's players take the
// augment, so every row stays practical on the live patch.

export type KitInteraction = { champion: string; augment: number; keys: string[]; text: string };

const ALL = (data as { interactions: KitInteraction[] }).interactions;

// Below this share of the champion's games an augment counts as not taken.
export const MIN_INTERACTION_PICK = 0.02;

export const allKitInteractions = (): KitInteraction[] => ALL;

/** The champion's interactions whose augment its players take, most taken first, with that pick rate. */
export function kitInteractions(
  alias: string,
  taken: { id: number; pickRate: number }[],
): (KitInteraction & { pickRate: number })[] {
  const pick = new Map(taken.map((a) => [a.id, a.pickRate]));
  const key = alias.toLowerCase();
  return ALL.filter((x) => x.champion.toLowerCase() === key && (pick.get(x.augment) ?? 0) >= MIN_INTERACTION_PICK)
    .map((x) => ({ ...x, pickRate: pick.get(x.augment) ?? 0 }))
    .sort((a, b) => b.pickRate - a.pickRate);
}
