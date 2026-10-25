import site from "@/content/site.json";

// Site text Nico edits at /account/edit. The editor commits src/content/site.json to main, which redeploys the site.
// Every key below is one field in the editor; keys missing from the JSON fall back to "".

export type Field = { key: string; label: string; group: string; long?: boolean; hint?: string };

const TABS = [
  ["/stats", "My Stats"],
  ["/tier-list", "Tier List"],
  ["/simulator", "Simulator"], // key names predate the move to /tools/simulator
  ["/pbe", "PBE"],
] as const;

export const FIELDS: Field[] = [
  { key: "banner", label: "Announcement", group: "Whole site", hint: "Shown above every page. Leave empty to hide it." },
  { key: "footer", label: "Footer", group: "Whole site", long: true },
  { key: "kofi", label: "Ko-fi link", group: "Whole site", hint: "Your Ko-fi page, like https://ko-fi.com/yourname. Shows a Ko-fi button in the header; leave empty to hide it." },
  { key: "home.title", label: "Headline", group: "Home" },
  { key: "home.lede", label: "Intro", group: "Home", long: true },
  ...TABS.flatMap(([href, name]) => [
    { key: `tab.${href}.label`, label: "Tab name", group: name },
    { key: `tab.${href}.body`, label: "Description on home and in search", group: name, long: true },
    ...(href === "/pbe" ? [] : [{ key: `page.${href}.title`, label: "Page headline", group: name }]),
  ]),
];

export type Content = Record<string, string>;

const content = site as Content;

export const text = (key: string, fallback = "") => content[key] || fallback;

/** Keeps only known keys with string values, so a save can't add anything else to the file. */
export function cleanContent(input: unknown): Content {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Content = {};
  for (const f of FIELDS) {
    const v = src[f.key];
    out[f.key] = typeof v === "string" ? v.slice(0, 2000) : "";
  }
  return out;
}
