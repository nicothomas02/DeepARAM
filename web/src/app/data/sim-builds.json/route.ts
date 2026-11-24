import { quickBuilds } from "@/lib/quick-build";

// The Simulator's "Recommended build" button: each champion's champion-page card build from the shared build engine
// (the top build style by DeepScore: its full item path, boots included, and its best augments by DeepScore), as item
// and augment ids the simulator maps to its own. Loaded only when a visitor presses the button. Built once per deploy.
export const dynamic = "force-static";

const RARITY_ORDER = ["prismatic", "gold", "silver"] as const;

export function GET() {
  const champions: Record<string, { items: number[]; augments: number[] }> = {};
  for (const q of quickBuilds()) {
    const ids = (list: { id?: number }[]) => list.flatMap((x) => (x.id !== undefined ? [x.id] : []));
    // The card's one full path: the core in buy order (boots where it buys them), then its 4th to 6th items.
    const items = [...new Set([...ids(q.items), ...ids(q.full)])];
    // Augments best DeepScore first across tiers (each tier's list is already in that order).
    const augs = RARITY_ORDER.flatMap((r) => q.augments[r] ?? [])
      .sort((a, b) => (b.deepScore ?? -Infinity) - (a.deepScore ?? -Infinity));
    champions[q.id.toLowerCase()] = { items, augments: ids(augs) };
  }
  return Response.json({ champions });
}
