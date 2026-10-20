// The site's pages are built from the repo's data files. These checks run the same loaders the pages use,
// on the committed data, so a data refresh or a loader change that would break a page fails here first.
import { describe, expect, it } from "vitest";
import championIds from "@/data/champion-ids.json";
import { augmentHref, augmentPages, augmentSlug } from "@/lib/augments";
import { championAliases } from "@/lib/champions";
import { counts, livePatch, topChampions } from "@/lib/highlights";
import { itemPages } from "@/lib/item-pages";
import { recap, recapPatches } from "@/lib/patches";
import { navItems, navPages } from "@/lib/tabs";

const unique = (xs: string[]) => new Set(xs).size === xs.length;

describe("live data", () => {
  it("has a live patch like 16.20", () => {
    expect(livePatch()).toMatch(/^\d{1,2}\.\d{1,2}$/);
  });

  it("has champions and augments with sane rates", () => {
    const c = counts();
    expect(c.champions).toBeGreaterThan(150);
    expect(c.augments).toBeGreaterThan(50);
    for (const t of topChampions(10)) {
      expect(t.winRate).toBeGreaterThan(0);
      expect(t.winRate).toBeLessThan(1);
      expect(t.pickRate).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("page addresses", () => {
  it("gives every champion, augment and item a unique address", () => {
    const champs = championAliases();
    // Every real champion gets a page; another mode's "Jade_" stand-ins don't.
    expect(champs.length).toBe(Object.keys(championIds).filter((a) => !a.startsWith("Jade_")).length);
    expect(champs).toContain("Ahri");
    expect(champs.some((a) => a.includes("_"))).toBe(false);
    expect(unique(champs.map((a) => a.toLowerCase()))).toBe(true);
    const augs = augmentPages();
    expect(augs.length).toBeGreaterThan(50);
    expect(unique(augs.map((a) => a.slug))).toBe(true);
    const items = itemPages();
    expect(items.length).toBeGreaterThan(50);
    expect(unique(items.map((i) => i.slug))).toBe(true);
  });

  it("makes clean augment slugs", () => {
    expect(augmentSlug("Can't Touch This")).toBe("cant-touch-this");
    expect(augmentSlug("  Ice Cold! ")).toBe("ice-cold");
    for (const a of augmentPages()) expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(augmentHref("definitely-not-an-augment")).toBeNull();
  });

  it("has a recap for every patch, each pointing at the one before", () => {
    const patches = recapPatches();
    expect(patches.length).toBeGreaterThan(1);
    patches.forEach((p, i) => {
      const r = recap(p)!;
      expect(r.patch).toBe(p);
      expect(r.prev).toBe(patches[i + 1] ?? null);
      for (const a of [...r.added, ...r.removed, ...r.changed]) expect(a.name).toBeTruthy();
    });
    expect(recap("0.0")).toBeNull();
  });
});

describe("header", () => {
  it("shows Tier List, Simulator, The Kitchen and More (PBE, Patches, About), with every page in one of them", () => {
    const top = navItems().map((n) => n.label);
    expect(top).toEqual(["Tier List", "Simulator", "The Kitchen", "More"]);
    expect(
      navItems()[3]
        .children?.slice(0, 3)
        .map((n) => n.label),
    ).toEqual(["PBE", "Patches", "About"]);
    for (const n of navItems()) if (n.children) expect(n.children.length, n.label).toBeGreaterThan(1);
    const hrefs = navPages().map((n) => n.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/tier-list", "/simulator", "/pbe", "/patches", "/info", "/kitchen"]));
    // The build tools (Build Editor, Team Builder) were removed.
    expect(hrefs).not.toContain("/builds");
    // Augments (by icon, draft practice) moved into the Tier List.
    expect(hrefs).not.toContain("/augments");
    // Items is a Tier List tab.
    expect(hrefs).not.toContain("/items");
    expect(unique(hrefs)).toBe(true);
  });
});
