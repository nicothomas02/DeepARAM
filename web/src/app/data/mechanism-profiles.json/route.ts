// What each augment and item directly changes (lib/mechanisms.ts), for both desktop apps' "What it does" lines:
// {made, augments: {id: {metric: {change, z}}}, items: {base item id: ...}}. Change and z only, no sample sizes.
// Metrics: damage, healing, mitigated, cc (% change per minute) and deaths (change per 10 minutes). Built once per deploy.
// `shield`: ids whose description mentions shields, so the apps drop the healing line the same way the site does.
import descriptions from "@/data/descriptions.json";
import { mechanismProfiles } from "@/lib/mechanisms";

const DESC = descriptions as { augments: Record<string, string>; items: Record<string, string> };
// Item ids come back as base ids (Mayhem 22xxxx variants folded in), the same keys as `items`.
const shielding = (all: Record<string, string>, base = false) => [
  ...new Set(Object.keys(all).filter((id) => /shield/i.test(all[id] ?? "")).map((id) => (base && Number(id) >= 100000 ? String(Number(id) % 10000) : id))),
];

export const dynamic = "force-static";

export function GET() {
  const p = mechanismProfiles();
  return Response.json(p ? { made: p.made, augments: p.augments, items: p.items, shield: { augments: shielding(DESC.augments), items: shielding(DESC.items, true) } } : { made: null, augments: {}, items: {}, shield: { augments: [], items: [] } });
}
