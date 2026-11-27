import { allKitInteractions } from "@/lib/kit-interactions";

// The public desktop app's Kit badge (apps/desktop/ui/companion.html): champion and augment interactions that hinge on
// the champion's own kit (data/kit-interactions.json, written and checked by hand). No win or pick rates.
// { champions: { alias: [[augment id, confirmed 1|0, why]] } }. Built once per deploy.
export const dynamic = "force-static";

export function GET() {
  const champions: Record<string, [number, number, string][]> = {};
  for (const x of allKitInteractions()) (champions[x.champion] ??= []).push([x.augment, x.confirmed ? 1 : 0, x.text]);
  return Response.json({ champions });
}
