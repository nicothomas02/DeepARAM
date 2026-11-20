import { championAliases } from "@/lib/champions";
import { championHistory } from "@/lib/champion-history";

// One champion's saved build numbers per patch, loaded by the champion page's timeframe picker when a patch range
// other than the live patch is picked. Built once per deploy.
export const dynamic = "force-static";
export const dynamicParams = false;

export const generateStaticParams = () => championAliases().map((alias) => ({ alias }));

export async function GET(_: Request, { params }: { params: Promise<{ alias: string }> }) {
  const h = championHistory((await params).alias);
  return h ? Response.json(h) : new Response("Not found", { status: 404 });
}
