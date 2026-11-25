import descriptions from "@/data/descriptions.json";

// Official item and augment descriptions (English) for the apps' hover cards. Built once per deploy.
export const dynamic = "force-static";

export function GET() {
  return Response.json(descriptions);
}
