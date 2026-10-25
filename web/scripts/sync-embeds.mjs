// Copies static pages that other parts of the repo publish into public/embed/ so the
// site can serve them: the stats dashboard, the simulator's replay viewer, and any
// folder with a site-tab.json (see src/lib/tabs.ts). Missing sources are skipped and
// the matching tab explains what it is waiting for.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(web, "..");
const out = join(web, "public", "embed");
const SKIP = new Set(["web", "node_modules", ".git", ".github"]);

const embeds = [
  // My Stats starts empty on the site: a local match archive in dashboard/data/ is never shipped
  { name: "dashboard", from: join(repo, "dashboard"), exclude: ["data"] },
  { name: "simulator", from: join(repo, "simulator", "viewer") },
];

function discover(dir, depth) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith(".") || SKIP.has(d.name)) continue;
    const folder = join(dir, d.name);
    const manifest = join(folder, "site-tab.json");
    if (existsSync(manifest)) {
      try {
        const m = JSON.parse(readFileSync(manifest, "utf8"));
        const slug = String(m.slug ?? d.name).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        embeds.push({ name: slug, from: folder });
      } catch {
        console.warn(`sync-embeds: ${manifest} is not valid JSON, skipping`);
      }
    } else if (depth < 2) discover(folder, depth + 1);
  }
}
discover(repo, 1);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const { name, from, exclude = [] } of embeds) {
  if (!existsSync(from)) {
    console.log(`sync-embeds: ${name} not found, skipping`);
    continue;
  }
  const skip = exclude.map((d) => join(from, d));
  // Build scripts and notes stay in the repo; only the pages and their data are published.
  const tooling = (src) => /\.(py|md)$/.test(src) || src.includes("/__pycache__");
  cpSync(from, join(out, name), { recursive: true, filter: (src) => !tooling(src) && !skip.some((d) => src === d || src.startsWith(d + "/")) });
  console.log(`sync-embeds: copied ${name}`);
}

// Every image, sound, model, font and script the pages use is mirrored in public/assets/ (scripts/fetch_assets.py),
// so links to the outside copies are pointed at the site's own. Pages that already use /assets/ are left as they are.
// A rule with a third entry only applies when that file is in public/assets/ (in git, so in the deployed build):
// until the models or three.js are committed there, pages keep loading them from the outside copy.
const LOCAL = [
  [/https:\/\/raw\.communitydragon\.org\//g, "/assets/cd/"],
  [/https:\/\/ddragon\.leagueoflegends\.com\/cdn\//g, "/assets/dd/"],
  // The mode's internal name stays out of the pages: unfilled tooltip tokens are dropped, and the copies in
  // public/assets/ store its "kiwi" folders and files as "mayhem" (fetch_assets.py local_path).
  [/\{\{\s*Kiwi_[^}]*\}\}\s*/g, ""],
  [/kiwi/gi, (m) => (m === "KIWI" ? "MAYHEM" : m[0] === "K" ? "Mayhem" : "mayhem")],
  // Augment "small" icons are grey for every rarity; the "large" ones carry the silver, gold or prismatic colour.
  // Arena augments have no large icon, so only swap when the large copy is there.
  [
    /\/assets\/(cd\/[^"'`\s]*?\/augments\/icons\/[\w.-]+?)_small\.png/gi,
    (m, path) => (existsSync(join(web, "public", "assets", `${path}_large.png`)) ? `/assets/${path}_large.png` : m),
  ],
  [/https:\/\/cdn\.modelviewer\.lol\/lol\/models/g, "/assets/models", "models/models.json"],
  [/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\//g, "/assets/lib/three-0.160.0/", "lib/three-0.160.0/build/three.module.js"],
  [/<link[^>]+rel="preconnect"[^>]+fonts\.g(?:oogleapis|static)\.com[^>]*>\s*/g, ""],
  [/https:\/\/fonts\.googleapis\.com\/css2\?[^"')\s]+/g, "/assets/fonts/fonts.css"],
];
// Official versions first: client images with a Data Dragon copy point at that copy (fetch_assets.py writes the map).
const swapFile = join(web, "src", "data", "dd-swap.json");
const SWAP = existsSync(swapFile) ? JSON.parse(readFileSync(swapFile, "utf8")).paths : {};
LOCAL.push([/\/assets\/cd\/latest\/[^"'`\s()\\<>]+/g, (m) => SWAP[m] ?? m]);
// Pick quotes (game voice lines) aren't kept, so data that names one gets none.
LOCAL.push([/"\/assets\/cd\/latest\/[^"]*\/champion-choose-vo\/\d+\.ogg"/g, "null"]);
const ACTIVE = LOCAL.filter(([, , needs]) => !needs || existsSync(join(web, "public", "assets", needs)));
const TEXT = /\.(html|js|mjs|css|json)$/;
function localize(dir) {
  let changed = 0;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) changed += localize(p);
    else if (TEXT.test(d.name)) {
      const before = readFileSync(p, "utf8");
      const after = ACTIVE.reduce((s, [re, to]) => s.replace(re, to), before);
      if (after !== before) (writeFileSync(p, after), changed++);
    }
  }
  return changed;
}
if (existsSync(join(web, "public", "assets", "manifest.json"))) console.log(`sync-embeds: pointed ${localize(out)} files at /assets`);

// Names and icons for shared build link previews (src/app/share/builds/image): champion icons, items by simulator key and
// by game id with a PNG icon (Data Dragon copy where there is one), augments by key and id with their rarity.
{
  const GD = join(web, "public", "assets", "cd", "latest", "plugins", "rcp-be-lol-game-data", "global", "default");
  const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  const cdItems = read(join(GD, "v1", "items.json")) ?? [];
  const simItems = read(join(repo, "simulator", "data", "items.json"))?.items ?? {};
  const simAugs = read(join(repo, "simulator", "data", "augments.json"))?.augments ?? {};
  const items = {};
  for (const i of cdItems) {
    if (!i.iconPath || !i.name) continue;
    const cd = "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/" + i.iconPath.replace(/^\/lol-game-data\/assets\//i, "").toLowerCase();
    const icon = SWAP[cd] ?? cd;
    if (existsSync(join(web, "public", icon))) items[i.id] = { name: i.name, icon };
  }
  for (const [key, v] of Object.entries(simItems)) if (items[v.id]) items[key] = { ...items[v.id], name: v.name };
  const augments = {};
  for (const [key, v] of Object.entries(simAugs)) augments[key] = augments[v.id] = { name: v.name, rarity: v.rarity };
  const champions = {};
  const version = read(swapFile)?.version;
  const ddChamps = version && existsSync(join(web, "public", "assets", "dd", version, "img", "champion")) ? readdirSync(join(web, "public", "assets", "dd", version, "img", "champion")) : [];
  for (const alias of Object.keys(read(join(web, "src", "data", "champion-names.json")) ?? {})) {
    const file = ddChamps.find((f) => f.toLowerCase() === alias.toLowerCase() + ".png");
    if (file) champions[alias] = `/assets/dd/${version}/img/champion/${file}`;
  }
  writeFileSync(join(web, "src", "data", "share-builds.json"), JSON.stringify({ champions, items, augments }));
  console.log(`sync-embeds: share-builds.json with ${Object.keys(items).length} item and ${Object.keys(augments).length} augment entries`);
}
