import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import languages from "@/i18n/languages.json";

// Champion pages show each champion's title in the page's language (scripts/fetch_names.py "titles").
describe("translated names", () => {
  it("carry champion titles for every language", () => {
    for (const { code } of languages as { code: string }[]) {
      if (code === "en") continue;
      const names = JSON.parse(readFileSync(join(__dirname, "../../public/i18n/names", `${code}.json`), "utf8"));
      // Only titles that differ from English are kept, so a language may list few (Indonesian keeps English).
      expect(names.titles, code).toBeTypeOf("object");
    }
    const de = JSON.parse(readFileSync(join(__dirname, "../../public/i18n/names/de.json"), "utf8"));
    expect(de.titles.Ahri).toBeTruthy();
  });
});
