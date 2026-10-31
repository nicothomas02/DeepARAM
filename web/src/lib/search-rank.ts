import { foldName } from "./fold";
import type { SearchItem } from "@/components/SearchPalette";

// With a query, champions come first, then augments, items and pages; inside each group a name equal to the
// query comes first, then names starting with it, then names with a word starting with it, then the rest.
const GROUP_ORDER: Record<string, number> = { Champions: 0, Augments: 1, Items: 2, Pages: 3 };
const groupRank = (g: string) => GROUP_ORDER[g] ?? 4;
function matchRank(name: string, q: string, f: string) {
  const n = name.toLowerCase();
  const fn = foldName(name);
  if (n === q || (f !== "" && fn === f)) return 0;
  if (n.startsWith(q) || (f !== "" && fn.startsWith(f))) return 1;
  if (n.split(/[\s'’.&:!,-]+/).some((w) => w.startsWith(q))) return 2;
  if (n.includes(q) || (f !== "" && fn.includes(f))) return 3;
  return -1;
}

/** The entries matching `query`, ranked. "kaisa" finds Kai'Sa, "monkey king" finds Wukong (by its page address)
 * and 阿狸 finds Ahri (by `alt`); a query that is only punctuation still matches as typed. `local` gives an entry's
 * name in the page's language. */
export function rankSearch(items: SearchItem[], query: string, local: (i: SearchItem) => string = (i) => i.name) {
  const q = query.trim().toLowerCase();
  const f = foldName(q);
  const ranked: { it: SearchItem; g: number; m: number; i: number }[] = [];
  items.forEach((it, i) => {
    const names = [it.name, local(it)];
    if (it.ref?.[0] === "champions") names.push(it.href.split("/").pop() ?? "", ...(it.alt ?? []));
    const ms = names.map((n) => matchRank(n, q, f)).filter((m) => m >= 0);
    if (ms.length) ranked.push({ it, g: groupRank(it.group), m: Math.min(...ms), i });
  });
  return ranked.sort((a, b) => a.g - b.g || a.m - b.m || a.i - b.i).map((r) => r.it);
}

// The not-found page's suggestions (components/NotFoundSuggestions.tsx).

/** Edit distance between two short strings, capped at `max` + 1 so long names stay cheap. */
function distance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Up to `n` entries whose name (or champion page name) is close to `typed`, closest first. */
export function closestPages(items: SearchItem[], typed: string, n = 3): SearchItem[] {
  const q = foldName(typed);
  if (q.length < 2) return [];
  const max = Math.max(1, Math.floor(q.length / 3));
  const scored: { it: SearchItem; d: number }[] = [];
  for (const it of items) {
    if (it.group === "Pages") continue;
    const keys = [it.name, it.href.split("/").pop() ?? ""].map(foldName);
    let d = Math.min(...keys.map((k) => distance(q, k, max)));
    if (d > max && keys.some((k) => k.startsWith(q) || (q.length >= 4 && k.includes(q)))) d = max;
    if (d <= max) scored.push({ it, d });
  }
  return scored
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((s) => s.it);
}
