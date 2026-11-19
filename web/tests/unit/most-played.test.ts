import { describe, expect, it } from "vitest";
import { iconChoice, mostPlayedChampion, storedIcon } from "@/lib/most-played";

// The account icon follows the most played champion from saved games unless the player picked one.
describe("mostPlayedChampion", () => {
  it("picks the champion with the most games, and the most recent one on a tie", () => {
    expect(mostPlayedChampion([
      { champ: 22, name: "Ashe", n: 2, last: 4 },
      { champ: 103, name: "Ahri", n: 2, last: 9 },
      { champ: 1, name: "Annie", n: 1, last: 10 },
    ])).toBe("Ahri");
  });
  it("skips champions the site doesn't know and falls back to the champion name", () => {
    expect(mostPlayedChampion([{ champ: 99999, name: "Nobody", n: 9, last: 1 }, { champ: null, name: "Annie", n: 1, last: 1 }])).toBe("Annie");
    expect(mostPlayedChampion([])).toBeNull();
  });
});

describe("icon choice", () => {
  it("follows most played unless a champion or no icon was picked", () => {
    expect(iconChoice(null)).toBe("auto");
    expect(iconChoice("none")).toBe("none");
    expect(iconChoice("Ahri")).toBe("Ahri");
    expect(iconChoice("NotAChampion")).toBe("auto");
    expect(storedIcon("auto")).toBeNull();
    expect(storedIcon("none")).toBe("none");
    expect(storedIcon("Ahri")).toBe("Ahri");
    expect(storedIcon("<x>")).toBeNull();
  });
});
