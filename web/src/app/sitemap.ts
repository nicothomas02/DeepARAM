import type { MetadataRoute } from "next";
import { augmentPages } from "@/lib/augments";
import { championAliases } from "@/lib/champions";
import { itemPages } from "@/lib/item-pages";
import { recapPatches } from "@/lib/patches";
import { navPages } from "@/lib/tabs";
import { patchName } from "@/lib/patch-name";

const SITE = "https://deeparam.com";

// Every page in the header, plus Home, the champion list, My Stats and each champion, augment, item and patch page. Rebuilt with each deploy.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages = ["/", ...navPages().map((t) => t.href), "/champions", "/info/region-teams", "/privacy", "/terms", ...championAliases().map((a) => `/champions/${a}`), ...augmentPages().map((a) => `/augments/${a.slug}`), ...itemPages().map((i) => `/items/${i.slug}`), ...recapPatches().map((p) => `/patches/${patchName(p)}`)];
  return [...new Set(pages)].map((path) => ({
    url: SITE + (path === "/" ? "" : path),
    lastModified: now,
    changeFrequency: "daily",
    priority: path === "/" ? 1 : path === "/tier-list" ? 0.9 : /^\/(champions|augments)\//.test(path) ? 0.7 : path.startsWith("/items/") ? 0.5 : 0.6,
  }));
}
