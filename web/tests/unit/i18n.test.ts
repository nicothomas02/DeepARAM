// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fill, LANG_KEY, LANG_SCRIPT, LANGS, matchLang } from "@/lib/i18n";

const I18N = join(process.cwd(), "public", "i18n");
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("language matching", () => {
  it.each([
    ["fr-FR", "fr"],
    ["de", "de"],
    ["es-ES", "es"],
    ["es-AR", "es-MX"],
    ["es-419", "es-MX"],
    ["pt-PT", "pt-BR"],
    ["zh-HK", "zh-TW"],
    ["zh-Hant", "zh-TW"],
    ["zh", "zh-CN"],
    ["zh_CN", "zh-CN"],
    ["ja-JP", "ja"],
    ["nl-NL", null],
    ["", null],
  ])("%s → %s", (tag, code) => expect(matchLang(tag)).toBe(code));

  it("fills placeholders and leaves unknown ones", () => expect(fill("{a} of {b} {c}", { a: 1, b: "2" })).toBe("1 of 2 {c}"));
});

// The before-paint script repeats matchLang in plain JS; both must agree.
describe("before-paint script", () => {
  const run = (languages: string[], saved?: string) => {
    localStorage.clear();
    if (saved) localStorage.setItem(LANG_KEY, saved);
    Object.defineProperty(navigator, "languages", { value: languages, configurable: true });
    const root = document.documentElement;
    root.removeAttribute("dir");
    delete root.dataset.lang;
    new Function(LANG_SCRIPT)();
    return [root.dataset.lang, root.getAttribute("dir")];
  };

  it.each([["fr-CA"], ["es-AR"], ["zh-TW"], ["ko"], ["pt-PT"]])("agrees with matchLang for %s", (tag) => expect(run([tag])[0]).toBe(matchLang(tag)));
  it("keeps English for English browsers, even with another language listed later", () => expect(run(["en-US", "fr"])[0]).toBe("en"));
  it("skips unsupported languages for the next one", () => expect(run(["nl", "de"])[0]).toBe("de"));
  it("prefers the saved pick", () => expect(run(["fr"], "ja")[0]).toBe("ja"));
  it("ignores a saved code the site doesn't have", () => expect(run(["fr"], "xx")[0]).toBe("fr"));
  it("sets right-to-left for Arabic", () => expect(run(["ar-AE"])).toEqual(["ar", "rtl"]));
});

describe("dictionaries", () => {
  // Official names and descriptions only list what differs from English (fetch_names.py, fetch_descriptions.py).
  const namespaces = readdirSync(I18N).filter((d) => d !== "names" && d !== "descriptions");
  const others = LANGS.filter((l) => l.code !== "en");

  it.each(namespaces)("%s: every language has every English key, with the same placeholders", (ns) => {
    const en = JSON.parse(readFileSync(join(I18N, ns, "en.json"), "utf8")) as Record<string, string>;
    for (const l of others) {
      const d = JSON.parse(readFileSync(join(I18N, ns, `${l.code}.json`), "utf8")) as Record<string, string>;
      const missing = Object.keys(en).filter((k) => !d[k]?.trim());
      expect(missing, `${ns}/${l.code}.json`).toEqual([]);
      for (const [k, v] of Object.entries(d)) expect(placeholders(v), `${ns}/${l.code}.json: ${k}`).toEqual(placeholders(k));
    }
  });

  it("every language has its official names file", () => {
    for (const l of others) {
      const d = JSON.parse(readFileSync(join(I18N, "names", `${l.code}.json`), "utf8"));
      expect(Object.keys(d)).toEqual(expect.arrayContaining(["champions", "items", "augments", "mode"]));
    }
  });
});

describe("official descriptions", () => {
  const en = JSON.parse(readFileSync(join(I18N, "..", "..", "src", "data", "descriptions.json"), "utf8")) as Record<"augments" | "items", Record<string, string>>;
  it("has English text for augments and items", () => {
    expect(Object.keys(en.augments).length).toBeGreaterThan(100);
    expect(en.items["3157"]).toContain("§Time Stop§");
  });
  it.each(LANGS.filter((l) => l.code !== "en").map((l) => [l.code]))("%s only translates descriptions English has", (code) => {
    const d = JSON.parse(readFileSync(join(I18N, "descriptions", `${code}.json`), "utf8")) as typeof en;
    for (const kind of ["augments", "items"] as const) for (const id of Object.keys(d[kind])) expect(en[kind][id], `${kind} ${id}`).toBeDefined();
  });
});
