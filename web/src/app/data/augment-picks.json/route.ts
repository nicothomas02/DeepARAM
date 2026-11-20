import { augmentPicks } from "@/lib/augment-picks";

// The desktop app's augment panel: each champion's augments in ranking order plus synergy pairs (lib/augment-picks.ts).
// Built once per deploy.
export const dynamic = "force-static";

export function GET() {
  return Response.json(augmentPicks());
}
