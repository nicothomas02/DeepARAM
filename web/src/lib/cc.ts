import "server-only";
import { readRepoJson } from "./repo-data";

// Each champion's crowd control from the champion files (data/official/champion-cc.json, mAbilitySlotCC per
// ability). "hard" is a stun, root, knock-up, taunt, fear, charm, sleep or suppression on any ability.
type CC = { slots?: Record<string, string | null>; hard: boolean };

let cache: Record<string, CC> | null = null;
const data = () => (cache ??= readRepoJson<Record<string, CC>>("data/official/champion-cc.json") ?? {});

/** Whether the champion has hard crowd control; null when the data doesn't cover it. */
export const hasHardCC = (alias: string): boolean | null => data()[alias]?.hard ?? null;

/** True only when the data covers both champions and neither has hard crowd control. */
export const pairLacksHardCC = (a: string, b: string) => hasHardCC(a) === false && hasHardCC(b) === false;
