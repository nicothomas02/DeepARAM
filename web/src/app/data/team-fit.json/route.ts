import { teamFitData } from "@/lib/team-fit";

// "Best pick for your team" (Tier List, Champions tab, and the desktop app): champion strength, duo and archetype
// synergy from public live stats (lib/team-fit.ts). Built once per deploy.
export const dynamic = "force-static";

export function GET() {
  return Response.json(teamFitData());
}
