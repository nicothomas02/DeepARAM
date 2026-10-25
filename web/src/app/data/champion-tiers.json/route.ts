// Live-patch Mayhem tier per champion, keyed by numeric champion id, for My Stats' mastery comparison.
// Built once per deploy.
import championIds from "@/data/champion-ids.json";
import { champName, liveTiers } from "@/lib/highlights";

export const dynamic = "force-static";

export function GET() {
  const tiers = new Map(liveTiers().map((t) => [t.id, t]));
  const out: Record<number, { id: string; name: string; tier: string | null; winRate: number | null }> = {};
  for (const [alias, id] of Object.entries(championIds as Record<string, number>)) {
    const t = tiers.get(alias);
    out[id] = { id: alias, name: t?.name ?? champName(alias), tier: t?.tier ?? null, winRate: t?.winRate ?? null };
  }
  return Response.json(out);
}
