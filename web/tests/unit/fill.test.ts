import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRepoJson } from "@/lib/repo-data";
import { fillGames, fillSpells, spell } from "@/lib/fill";

// The temporary spells and game counts fill (data/fill/README.md).
describe("fill", () => {
  const on = readRepoJson<{ enabled?: boolean }>("data/fill/config.json")?.enabled === true;

  it.skipIf(on)("shows nothing while switched off", () => {
    expect(fillGames()).toBeNull();
    expect(fillSpells("aatrox", 0.5)).toEqual([]);
  });

  it.each([1, 3, 4, 6, 7, 13, 14, 21, 32])("Mayhem spell %i has a name and a shipped icon", (id) => {
    const s = spell(id);
    expect(s?.name).toBeTruthy();
    expect(existsSync(join(process.cwd(), "public", s!.icon))).toBe(true);
  });
});
