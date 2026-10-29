import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// POST /api/history, called the way Next calls it. Riot (tokenOwner) and D1 (lib/match-history.ts) are stubbed:
// every request below must be refused, or filtered, before anything is written.
const saveHistory = vi.fn(async (_account: string, games: unknown[]) => games.length);
const ownerAccountFor = vi.fn(async (_puuid: string) => "acct-1");
vi.mock("@/lib/match-history", async (actual) => ({
  ...(await actual<typeof import("@/lib/match-history")>()),
  ownerAccountFor: (...a: [string]) => ownerAccountFor(...a),
  saveHistory: (...a: [string, unknown[]]) => saveHistory(...a),
  historyCount: async () => 3,
  removeHistory: async () => {},
}));
vi.mock("@/lib/profiles", async (actual) => ({
  ...(await actual<typeof import("@/lib/profiles")>()),
  tokenOwner: async (token: string) => (token === "good-token-good-token-good" ? { puuid: "p1", name: "Me", tag: "EUW" } : null),
}));

import { POST } from "@/app/api/history/route";

const post = (body: unknown) =>
  POST(new NextRequest("https://deeparam.com/api/history", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const base = { token: "good-token-good-token-good", platform: "euw1" };
const game = (queueId: number, gameId = 1) => ({
  gameId,
  gameVersion: "16.21.1",
  queueId,
  gameCreation: 1700000000000,
  gameDuration: 1200,
  participants: [{ participantId: 1, teamId: 100, championId: 22, puuid: "me", stats: { win: true } }, { participantId: 2, teamId: 200, championId: 1 }],
});

beforeEach(() => {
  saveHistory.mockClear();
  ownerAccountFor.mockClear();
});

describe("POST /api/history", () => {
  it.each([
    ["bad JSON", "{nope"],
    ["an array", [1, 2]],
    ["no token", { platform: "euw1", action: "status" }],
    ["an unknown platform", { ...base, platform: "mars", action: "status" }],
    ["an unknown action", { ...base, action: "drop" }],
    ["save without a games array", { ...base, action: "save", games: "lots" }],
  ])("answers 400 to %s without asking Riot or D1", async (_what, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(ownerAccountFor).not.toHaveBeenCalled();
    expect(saveHistory).not.toHaveBeenCalled();
  });

  it("answers 413 to a body over the cap", async () => {
    expect((await post("x".repeat(1_500_001))).status).toBe(413);
  });

  it("answers 401 when the token isn't Riot's", async () => {
    expect((await post({ ...base, token: "some-other-token-that-is-long", action: "status" })).status).toBe(401);
    expect(saveHistory).not.toHaveBeenCalled();
  });

  it("saves only Mayhem games", async () => {
    const res = await post({ ...base, action: "save", games: [game(2400, 1), game(450, 2), game(2450, 3), { gameId: "x" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 2, saved: 2 });
    expect(saveHistory).toHaveBeenCalledTimes(1);
    expect((saveHistory.mock.calls[0][1] as { gameId: number }[]).map((g) => g.gameId)).toEqual([1, 3]);
  });

  it("refuses an upload with no Mayhem games in it", async () => {
    const res = await post({ ...base, action: "save", games: [game(450), game(420)] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only ARAM: Mayhem games can be saved." });
    expect(saveHistory).not.toHaveBeenCalled();
  });

  it("keeps at most 100 games of one upload", async () => {
    const games = Array.from({ length: 120 }, (_, i) => game(2400, i + 1));
    expect(await (await post({ ...base, action: "save", games })).json()).toEqual({ accepted: 100, saved: 100 });
  });

  it("answers status with the count", async () => {
    expect(await (await post({ ...base, action: "status" })).json()).toEqual({ available: true, saved: 3 });
  });
});
