import { tvData } from "@/lib/tv";

// The Apple TV app's data: tiers, quick builds, augment tiers, Chef's Special and PBE changes. Built once per deploy.
export const dynamic = "force-static";

export function GET() {
  return Response.json(tvData());
}
