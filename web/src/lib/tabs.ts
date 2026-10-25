import "server-only";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { repoPath } from "./repo-data";
import { sections } from "./sections";

export type Tab = { href: string; label: string; body: string };
/** A header tab; one with `children` is a dropdown menu. */
export type NavItem = { href: string; label: string; body?: string; children?: NavItem[] };

// A folder in the repo becomes a tab when it holds a site-tab.json:
//   { "label": "Fun Tools", "description": "...", "entry": "index.html", "order": 10 }
// scripts/sync-embeds.mjs copies the folder to public/embed/<slug>/ and the tab embeds `entry`.
export type ToolTab = Tab & { slug: string; entry: string; order: number; folder: string };

const SKIP = new Set(["web", "node_modules", ".git", ".github"]);

// Where each embedded folder (by slug) is published. Anything not listed lives at /tools/<slug>.
// The Kitchen (tools/fun, formerly The Lab) holds the Chef Specials; cook-builds is its data, no tab of its own.
export const KITCHEN = "/kitchen";
const HIDDEN = new Set(["cook-builds"]);
const ROUTES: Record<string, string> = {
  champions: "/champions",
  guide: "/info",
  fun: "/kitchen",
};
export const toolHref = (slug: string) => ROUTES[slug] ?? `/tools/${slug}`;
// Tab names the site sets regardless of the folder's own label.
const LABELS: Record<string, string> = { guide: "About", fun: "The Kitchen" };

export function discoverToolTabs(): ToolTab[] {
  const root = repoPath("");
  const found: ToolTab[] = [];
  const visit = (dir: string, depth: number) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".") || SKIP.has(d.name)) continue;
      const folder = join(dir, d.name);
      const manifest = join(folder, "site-tab.json");
      if (existsSync(manifest) && !HIDDEN.has(d.name)) {
        try {
          const m = JSON.parse(readFileSync(manifest, "utf8"));
          const slug = String(m.slug ?? d.name)
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-");
          found.push({
            slug,
            href: toolHref(slug),
            label: LABELS[slug] ?? String(m.label ?? d.name),
            body: String(m.description ?? ""),
            entry: String(m.entry ?? "index.html"),
            order: Number(m.order ?? 100),
            folder: relative(root, folder),
          });
        } catch {
          console.warn(`Skipping ${manifest}: not valid JSON`);
        }
      } else if (depth < 2) visit(folder, depth + 1);
    }
  };
  visit(root, 1);
  return found.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function allTabs(): Tab[] {
  return [...sections, ...discoverToolTabs()];
}

const pick = (href: string): NavItem[] => {
  const t = allTabs().find((x) => x.href === href);
  return t ? [{ href: t.href, label: t.label, body: t.body }] : [];
};

/** The header's tabs, grouped by what a player is trying to do:
 *  Tier List (champions, augments, items, duos, augments by icon, draft practice) · Simulator · The Kitchen ·
 *  More (PBE, Patches, About, newer tool folders), the same order as the phone tab bar.
 *  Builds for a champion are on its page.
 *  My Stats sits behind the account button; champion, augment and item pages open from the tier lists and search. */
export function navItems(): NavItem[] {
  const tools = discoverToolTabs().filter((t) => t.href.startsWith("/tools/"));
  const menu = (href: string, label: string, children: NavItem[]): NavItem[] => (children.length ? [{ href, label, children }] : []);
  return [
    ...pick("/tier-list"),
    ...pick("/simulator"),
    ...pick("/kitchen"),
    ...menu("#more", "More", [...pick("/pbe"), ...pick("/patches"), ...pick("/info"), ...tools.flatMap((t) => pick(t.href))]),
  ];
}

/** Every page in header order, menus flattened (search, home page). */
export const navPages = (): NavItem[] => navItems().flatMap((t) => t.children ?? [t]);

/** Every page with the header menu it sits in (phone tab bar sheet). */
export const navGroups = (): (NavItem & { group?: string })[] =>
  navItems().flatMap((t) => (t.children ? t.children.map((c) => ({ ...c, group: t.label })) : [t]));
