import { damageTypes } from "@/lib/damage-types";

// The desktop app's enemy-aware damage line: champion damage types and item stats (lib/damage-types.ts).
// Built once per deploy.
export const dynamic = "force-static";

export function GET() {
  return Response.json(damageTypes());
}
