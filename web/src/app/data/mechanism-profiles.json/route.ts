// What each augment and item directly changes (lib/mechanisms.ts), for both desktop apps' "What it does" lines:
// {made, augments: {id: {metric: {change, z}}}, items: {base item id: ...}}. Change and z only, no sample sizes.
// Metrics: damage, healing, mitigated, cc (% change per minute) and deaths (change per 10 minutes). Built once per deploy.
import { mechanismProfiles } from "@/lib/mechanisms";

export const dynamic = "force-static";

export function GET() {
  const p = mechanismProfiles();
  return Response.json(p ? { made: p.made, augments: p.augments, items: p.items } : { made: null, augments: {}, items: {} });
}
