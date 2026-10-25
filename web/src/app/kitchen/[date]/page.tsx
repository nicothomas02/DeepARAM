import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import championNames from "@/data/champion-names.json";
import Intro from "@/components/Intro";
import OpenLink from "@/components/OpenLink";
import { readRepoJson } from "@/lib/repo-data";

// A Chef Special's share link (/kitchen/2026-10-17), made by its Share button in The Kitchen. Link previews
// show the special's card (tools/fun/cook-builds/share/<id>.png, made by data/cook-builds/share_images.js);
// a visitor goes on to that day's special in The Kitchen.

type Special = { id: string; champion: string; title: string; why: string; chef?: string };
const NAMES = championNames as Record<string, string>;

function specials(): Special[] {
  return (readRepoJson<{ builds: Special[] }>("data/cook-builds/builds.json")?.builds ?? []).filter((b) => b.chef);
}
const find = (date: string) => specials().find((b) => b.chef === date);

export const dynamicParams = false;
export function generateStaticParams() {
  return specials().map((b) => ({ date: b.chef! }));
}

type Props = { params: Promise<{ date: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const b = find((await params).date);
  if (!b) return {};
  const champ = NAMES[b.champion] ?? b.champion;
  const title = `${b.title}: ${champ} · Chef Special · DeepARAM`;
  const description = b.why.length > 200 ? b.why.slice(0, b.why.lastIndexOf(" ", 197)) + "…" : b.why;
  const image = { url: `/embed/fun/cook-builds/share/${b.id}.png`, width: 1200, height: 630, alt: `${b.title}, ${champ}` };
  return {
    title,
    description,
    robots: { index: false },
    alternates: { canonical: "/kitchen" },
    openGraph: { type: "website", siteName: "DeepARAM", title, description, url: `/kitchen/${b.chef}`, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function ChefSpecialLink({ params }: Props) {
  const b = find((await params).date);
  if (!b) notFound();
  const href = `/kitchen#chefs-special-${b.chef}`;
  return (
    <Intro eyebrow="The Kitchen" title={b.title}>
      <OpenLink href={href} />
      <Link className="inline-link" href={href}>
        Open the Chef Special →
      </Link>
    </Intro>
  );
}
