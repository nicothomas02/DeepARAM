import type { Metadata } from "next";

// Title, description, canonical address and link-preview text for one page.
// Link previews use public/og.png (1200x630); a page's openGraph replaces the layout's, so it's set here too.
const IMAGE = { url: "/og.png", width: 1200, height: 630, alt: "DeepARAM" };
/** `name` ("augments:123") lets the browser-tab title show that augment's or item's name in the visitor's language
 *  (components/DocTitle.tsx). */
export function pageMeta(path: string, title: string, description: string, name?: string): Metadata {
  const full = title === "DeepARAM" ? title : `${title} · DeepARAM`;
  return {
    title: full,
    ...(name ? { other: { "deeparam-name": name } } : {}),
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "DeepARAM", title: full, description, url: path, images: [IMAGE] },
    twitter: { card: "summary_large_image", title: full, description, images: [IMAGE.url] },
  };
}
