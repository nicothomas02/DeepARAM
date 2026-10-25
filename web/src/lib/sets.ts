import sets from "@/data/mayhem-sets.json";

// ARAM Mayhem's sets: the augment pool only changes when a new set starts, so patches group by set. Each set runs from
// its first patch (client version) until the next set's first patch. Launch had no set; 16.3 (26.3) started Set 1 with its
// pass, 16.12 (26.12) Set 2, 16.21 (26.21) Set 3. A new set is one line in src/data/mayhem-sets.json.

export type MayhemSet = { name: string; first: string };
export const SETS = sets as MayhemSet[];

const num = (p: string) => {
  const [a, b] = p.split(".").map(Number);
  return a * 100 + b;
};

/** The set a patch belongs to (the last set starting at or before it). */
export function setOf(patch: string): MayhemSet {
  return [...SETS].reverse().find((s) => num(s.first) <= num(patch)) ?? SETS[0];
}

/** Patches grouped by set, in the order given, keeping only sets that have patches. */
export function bySet(patches: string[]): { set: MayhemSet; patches: string[] }[] {
  const out: { set: MayhemSet; patches: string[] }[] = [];
  for (const p of patches) {
    const s = setOf(p);
    const last = out.at(-1);
    if (last?.set === s) last.patches.push(p);
    else out.push({ set: s, patches: [p] });
  }
  return out;
}
