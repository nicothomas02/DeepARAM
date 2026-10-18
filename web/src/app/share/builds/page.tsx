import type { Metadata } from "next";
import Link from "next/link";
import championNames from "@/data/champion-names.json";
import Intro from "@/components/Intro";
import OpenLink from "@/components/OpenLink";

// A shared build's link: /share/builds?champ=Jinx&items=…&augs=…, with items and augments as simulator keys or
// game ids. Link previews get the build's card (./image); a visitor goes on to what was shared: with to=sim the
// build in the Simulator's fight replay, with to=kitchen The Kitchen's community builds (title= names the build),
// else the champion's page. Old links from the removed Build Editor still work the same way.

const NAMES = championNames as Record<string, string>;
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const list = (v: string) => v.split(/[,+]/).map((s) => s.trim()).filter((s) => /^[a-z0-9_]{1,48}$/.test(s));

async function target(searchParams: Props["searchParams"]) {
  const q = await searchParams;
  const champ = Object.keys(NAMES).find((k) => k.toLowerCase() === one(q.champ).toLowerCase()) ?? "";
  const items = list(one(q.items)).slice(0, 6);
  const augs = list(one(q.augs)).slice(0, 4);
  const to = one(q.to);
  const title = one(q.title).replace(/\s+/g, " ").trim().slice(0, 60);
  const href =
    to === "kitchen"
      ? "/kitchen#community"
      : to === "sim" && champ && items.length
        ? `/simulator?tab=replays#${champ}&items=${items.join(",")}&augs=${augs.join(",")}`
        : champ
          ? `/champions/${champ}`
          : "/tier-list";
  const image = new URLSearchParams({ champ, items: items.join(","), augs: augs.join(","), ...(title ? { title } : {}), ...(to ? { to } : {}) });
  return { champ, name: NAMES[champ], href, items: items.length, title, image: `/share/builds/image?${image}` };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { name, href, items, title: named, image: src } = await target(searchParams);
  const title = named ? `${named}: ${name ?? "ARAM Mayhem"} build · DeepARAM` : name ? `${name} build for ARAM Mayhem · DeepARAM` : "An ARAM Mayhem build · DeepARAM";
  const description = name
    ? `${items ? `${items} items` : "The build that wins most"} for ${name} in ARAM Mayhem, with augments and simulated damage.`
    : "What to build in ARAM Mayhem, with augments and simulated damage.";
  const image = { url: src, width: 1200, height: 630, alt: name ? `${name} build` : "DeepARAM" };
  return {
    title,
    description,
    robots: { index: false },
    alternates: { canonical: href.split("#")[0] },
    openGraph: { type: "website", siteName: "DeepARAM", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function ShareBuildPage({ searchParams }: Props) {
  const { name, href, title } = await target(searchParams);
  return (
    <Intro eyebrow="Builds" title={title || (name ? `${name} build` : "Shared build")}>
      <OpenLink href={href} />
      <Link className="inline-link" href={href}>
        Open the build →
      </Link>
    </Intro>
  );
}
