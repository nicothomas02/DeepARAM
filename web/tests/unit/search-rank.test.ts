import { describe, expect, it } from "vitest";
import type { SearchItem } from "@/components/SearchPalette";
import { closestPages, rankSearch } from "@/lib/search-rank";

const champ = (name: string, alias = name, alt?: string[]): SearchItem => ({ group: "Champions", name, hint: "", href: `/champions/${alias}`, ref: ["champions", alias], alt });
const aug = (name: string, slug: string): SearchItem => ({ group: "Augments", name, hint: "", href: `/augments/${slug}` });
const item = (name: string, slug: string): SearchItem => ({ group: "Items", name, hint: "", href: `/items/${slug}` });
const page = (name: string, href: string): SearchItem => ({ group: "Pages", name, hint: "", href });

// In the order the search list arrives: pages, then champions, augments and items.
const ALL = [
  page("Tier List", "/tier-list"),
  champ("Ahri", "Ahri", ["阿狸", "ари"]),
  champ("Anivia"),
  champ("Annie"),
  champ("Kai'Sa", "Kaisa"),
  champ("Rammus"),
  champ("Wukong", "MonkeyKing"),
  aug("Banner of Command", "banner-of-command"),
  aug("Titan's Resolve", "titans-resolve"),
  item("Infinity Edge", "infinity-edge"),
  item("Annul", "annul"),
];
const names = (q: string) => rankSearch(ALL, q).map((i) => i.name);

describe("search ranking", () => {
  it("lists champions, then augments, then items, then pages", () => {
    expect(names("an")).toEqual(["Anivia", "Annie", "Banner of Command", "Titan's Resolve", "Annul"]);
  });

  it("puts names that start with the query before names that only contain it", () => {
    // "Titan's" only contains "an"; "Banner" starts with it.
    expect(names("an").slice(2, 4)).toEqual(["Banner of Command", "Titan's Resolve"]);
    // A word inside the name starting with the query ranks above a match in the middle of a word.
    expect(rankSearch([champ("Rammus"), champ("Aurelion Sol", "AurelionSol")], "sol").map((i) => i.name)).toEqual(["Aurelion Sol"]);
    expect(rankSearch([aug("Eureka", "eureka"), aug("Titan's Resolve", "titans-resolve")], "re").map((i) => i.name)).toEqual(["Titan's Resolve", "Eureka"]);
  });

  it("finds champions by punctuation-free names, page names and names in other languages", () => {
    expect(names("kaisa")).toEqual(["Kai'Sa"]);
    expect(names("monkey king")).toEqual(["Wukong"]);
    expect(names("阿狸")).toEqual(["Ahri"]);
    expect(names("Ари")).toEqual(["Ahri"]);
  });

  it("matches page names too", () => {
    expect(names("tier")).toEqual(["Tier List"]);
  });
});

describe("not-found suggestions", () => {
  const near = (typed: string) => closestPages(ALL, typed).map((i) => i.name);
  it("suggests the closest champion, augment or item for a typo", () => {
    expect(near("ahrii")[0]).toBe("Ahri");
    expect(near("infinty-edge")[0]).toBe("Infinity Edge");
    expect(near("titans-resolv")[0]).toBe("Titan's Resolve");
    expect(near("wukog")[0]).toBe("Wukong");
  });

  it("suggests nothing for unrelated or tiny addresses", () => {
    expect(near("zzzzzzzz")).toEqual([]);
    expect(near("a")).toEqual([]);
  });
});
