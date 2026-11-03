import { describe, expect, it } from "vitest";
import { cleanProfile, profileRiotId } from "@/lib/profiles";

// What a published player page can show (lib/profiles.ts, app/profile): nothing it would render as more than
// 100% or twice over, whatever the helper sends.
const base = { games: 20, wins: 11, kills: 100, deaths: 80, assists: 200, damage: 30000, duration: 1200, first: 1760000000000, last: 1760600000000 };

describe("cleanProfile edge cases", () => {
  it("keeps a champion's wins within its games, so no champion shows more than 100%", () => {
    const p = cleanProfile({ ...base, champions: [{ id: 103, n: 5, w: 9 }, { id: 1, n: 3, w: 3 }] })!;
    expect(p.champions.map((c) => c.w)).toEqual([5, 3]);
  });

  it("keeps a champion's games within the profile's games", () => {
    const p = cleanProfile({ ...base, champions: [{ id: 103, n: 500, w: 400 }] })!;
    expect(p.champions[0]).toMatchObject({ n: 20, w: 20 });
  });

  it("lists each champion once, keeping the first entry", () => {
    const p = cleanProfile({ ...base, champions: [{ id: 103, n: 5, w: 2 }, { id: 103, n: 4, w: 1 }, { id: 1, n: 1, w: 0 }] })!;
    expect(p.champions.map((c) => [c.id, c.n])).toEqual([[103, 5], [1, 1]]);
  });

  it("lists each achievement once and without control characters", () => {
    const p = cleanProfile({ ...base, badges: ["Pentakill", "Pentakill", "Iron\u0000 Will​", " "] })!;
    expect(p.badges).toEqual(["Pentakill", "Iron Will"]);
  });

  it("puts the first game before the last", () => {
    const p = cleanProfile({ ...base, first: base.last, last: base.first })!;
    expect(p.first).toBe(base.first);
    expect(p.last).toBe(base.last);
  });

  it("keeps a profile with nothing but a game count", () => {
    expect(cleanProfile({ games: 1 })).toEqual({ games: 1, wins: 0, kills: 0, deaths: 0, assists: 0, damage: 0, duration: 0, first: 0, last: 0, champions: [], badges: [] });
  });

  it("ignores champions and badges that aren't lists", () => {
    const p = cleanProfile({ ...base, champions: "Ahri", badges: { a: 1 } })!;
    expect(p.champions).toEqual([]);
    expect(p.badges).toEqual([]);
  });
});

describe("profileRiotId", () => {
  it("decodes the Riot ID from the page address", () => {
    expect(profileRiotId("Nico%20Aura-NA1")).toBe("Nico Aura-NA1");
    expect(profileRiotId("Nico-NA1")).toBe("Nico-NA1");
  });

  it("returns null for an address that isn't valid percent-encoding, instead of throwing", () => {
    expect(profileRiotId("%E0%A4%A")).toBeNull();
    expect(profileRiotId("Nico%-NA1")).toBeNull();
  });
});
