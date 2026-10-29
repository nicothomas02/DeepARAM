import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// POST /api/games, the shared-games upload. Riot (tokenOwner) and D1 (lib/shared-games.ts) are stubbed.
const shareGames = vi.fn(async (_puuid: string, games: unknown[]) => games.length);
vi.mock("@/lib/shared-games", async (actual) => ({
  ...(await actual<typeof import("@/lib/shared-games")>()),
  shareGames: (...a: [string, unknown[]]) => shareGames(...a),
  sharedCount: async () => 5,
  unshareGames: async () => {},
}));
vi.mock("@/lib/profiles", async (actual) => ({
  ...(await actual<typeof import("@/lib/profiles")>()),
  tokenOwner: async (token: string) => (token === "good-token-good-token-good" ? { puuid: "p1", name: "Me", tag: "EUW" } : null),
}));

import { POST } from "@/app/api/games/route";

const post = (body: unknown) =>
  POST(new NextRequest("https://deeparam.com/api/games", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const base = { token: "good-token-good-token-good", platform: "euw1" };
const game = (queue: number, id = 1) => ({
  id: String(7000000000 + id),
  platform: "euw1",
  patch: "16.21",
  played: "2026-10-28",
  queue,
  duration: 1200,
  teams: [{ id: 100, win: true }, { id: 200, win: false }],
  players: [{ team: 100, champ: 22, win: true }, { team: 200, champ: 1, win: false }],
});

beforeEach(() => {
  shareGames.mockClear();
});

describe("POST /api/games", () => {
  it.each([
    ["bad JSON", "{nope"],
    ["an array", [1]],
    ["no token", { platform: "euw1", action: "status" }],
    ["an unknown action", { ...base, action: "steal" }],
    ["share without a games array", { ...base, action: "share", games: {} }],
  ])("answers 400 to %s without writing anything", async (_what, body) => {
    expect((await post(body)).status).toBe(400);
    expect(shareGames).not.toHaveBeenCalled();
  });

  it("answers 413 to a body over the cap", async () => {
    expect((await post("x".repeat(600_001))).status).toBe(413);
  });

  it("shares only Mayhem games, at most 50 at a time", async () => {
    const games = [game(450, 1), ...Array.from({ length: 60 }, (_, i) => game(2400, i + 2))];
    const res = await post({ ...base, action: "share", games });
    expect(await res.json()).toEqual({ accepted: 49, shared: 49 });
    expect(shareGames).toHaveBeenCalledTimes(1);
  });

  it("refuses an upload with no Mayhem games in it", async () => {
    const res = await post({ ...base, action: "share", games: [game(450)] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only ARAM: Mayhem games can be shared." });
    expect(shareGames).not.toHaveBeenCalled();
  });

  it("answers status with the count", async () => {
    expect(await (await post({ ...base, action: "status" })).json()).toEqual({ shared: 5 });
  });
});
