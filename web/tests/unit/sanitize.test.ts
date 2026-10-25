// What players send to the site (published profiles, shared games, admin text) is cleaned before it is stored.
import { describe, expect, it } from "vitest";
import { cleanProfile, nameKey } from "@/lib/profiles";
import { cleanGame } from "@/lib/shared-games";
import { cleanContent, FIELDS } from "@/lib/content";

describe("cleanProfile", () => {
  it("rejects non-objects and profiles with no games", () => {
    expect(cleanProfile(null)).toBeNull();
    expect(cleanProfile("x")).toBeNull();
    expect(cleanProfile({ games: 0 })).toBeNull();
  });

  it("clamps numbers, caps lists and drops unknown fields", () => {
    const p = cleanProfile({
      games: 10, wins: 50, kills: -3, deaths: "4", assists: 1.6, evil: "<script>",
      champions: [...Array.from({ length: 15 }, (_, i) => ({ id: i + 1, n: 1 })), { id: 0, n: 3 }],
      badges: ["x".repeat(100), ""],
    })!;
    expect(p.wins).toBe(10);
    expect(p.kills).toBe(0);
    expect(p.deaths).toBe(4);
    expect(p.assists).toBe(2);
    expect(p.champions).toHaveLength(10);
    expect(p.badges).toEqual(["x".repeat(40)]);
    expect(p).not.toHaveProperty("evil");
  });

  it("matches Riot IDs regardless of case and spaces", () => {
    expect(nameKey("Nico Aura", "NA1")).toBe(nameKey("nicoaura", "na1"));
  });
});

describe("cleanGame", () => {
  const game = {
    id: "5123456789", platform: "NA1", patch: "16.20", played: "2026-10-16", queue: 2400, duration: 1200,
    teams: [{ id: 100, win: true, towers: 3 }, { id: 200, win: "yes" }],
    players: Array.from({ length: 10 }, (_, i) => ({ team: i < 5 ? 100 : 200, champ: i + 1, win: i < 5, k: 999, augs: [1, 2, 3, 4, 5, 6, 7], puuid: "secret" })),
  };

  it("accepts a real-looking game and keeps no account ids", async () => {
    const out = (await cleanGame(game))!;
    expect(out.key).toMatch(/^[0-9a-f]{64}$/);
    expect(out.game.players).toHaveLength(10);
    expect(out.game.players[0].k).toBe(200);
    expect(out.game.players[0].augs).toHaveLength(6);
    expect(out.game.teams[1].win).toBe(false);
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("keeps per-minute gold and experience as numbers, at most 90 minutes", async () => {
    const players = game.players.map((p, i) => (i ? p : { ...p, goldMin: [500, "1400", -3, ...Array(100).fill(9e9)], xpMin: "lots" }));
    const out = (await cleanGame({ ...game, players }))!;
    expect(out.game.players[0].goldMin!.slice(0, 3)).toEqual([500, 1400, 0]);
    expect(out.game.players[0].goldMin).toHaveLength(90);
    expect(Math.max(...out.game.players[0].goldMin!)).toBe(500_000);
    expect(out.game.players[0].xpMin).toEqual([]);
  });

  it("gives the same game the same key whoever shares it", async () => {
    expect((await cleanGame(game))!.key).toBe((await cleanGame({ ...game, players: game.players.slice().reverse() }))!.key);
  });

  it("rejects malformed games", async () => {
    expect(await cleanGame(null)).toBeNull();
    expect(await cleanGame({ ...game, id: "abc" })).toBeNull();
    expect(await cleanGame({ ...game, patch: "latest" })).toBeNull();
    expect(await cleanGame({ ...game, played: "yesterday" })).toBeNull();
    expect(await cleanGame({ ...game, players: game.players.slice(0, 1) })).toBeNull();
    expect(await cleanGame({ ...game, players: [{ champ: 0 }, { champ: 1 }] })).toBeNull();
  });
});

describe("cleanContent", () => {
  it("keeps only known keys as strings of at most 2000 characters", () => {
    const [first] = FIELDS;
    const out = cleanContent({ [first.key]: "y".repeat(3000), extra: "x", [FIELDS[1]?.key ?? "z"]: 5 });
    expect(Object.keys(out).sort()).toEqual(FIELDS.map((f) => f.key).sort());
    expect(out[first.key]).toHaveLength(2000);
    expect(out).not.toHaveProperty("extra");
    expect(cleanContent("nope")[first.key]).toBe("");
  });
});
