import { whyBestData } from "@/lib/why-best";

// The build engine's "why it's best" data for the apps (lib/why-best.ts). Built once per deploy.
export const dynamic = "force-static";

export function GET() {
  return Response.json(whyBestData());
}
