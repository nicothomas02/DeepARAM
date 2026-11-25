import { championAliases } from "@/lib/champions";
import { championLists } from "@/lib/champion-lists";

// The champion page's longest lists (the teammates past the first rows, the "All items" fold), loaded when a visitor
// opens them (components/champion/LazyLists.tsx). Built once per deploy.
export const dynamic = "force-static";
export const dynamicParams = false;

export const generateStaticParams = () => championAliases().map((alias) => ({ alias }));

export async function GET(_: Request, { params }: { params: Promise<{ alias: string }> }) {
  const l = championLists((await params).alias);
  return l ? Response.json(l) : new Response("Not found", { status: 404 });
}
