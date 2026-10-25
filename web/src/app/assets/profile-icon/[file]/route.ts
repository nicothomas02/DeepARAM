import { ddVersion } from "@/lib/dd-swap";

// Player profile icons, at /assets/profile-icon/<id>.jpg. There are thousands, so instead of a copy of
// each in public/assets/ the site fetches the official one it needs and caches it.

const SOURCE = `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/`;
const WEEK = 7 * 24 * 60 * 60;

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = /^(\d{1,6})\.jpg$/.exec(file)?.[1];
  if (!id) return new Response("Not found", { status: 404 });
  const res = await fetch(SOURCE + `${id}.png`, { cf: { cacheTtl: WEEK, cacheEverything: true } } as RequestInit);
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(res.body, {
    headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${WEEK}, immutable` },
  });
}
