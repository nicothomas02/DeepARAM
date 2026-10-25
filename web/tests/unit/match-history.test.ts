import { describe, expect, it } from "vitest";
import { cleanHistoryGame } from "@/lib/match-history";

// The owner's saved games (lib/match-history.ts): the player's own stats, teammates' Riot IDs and a few stats,
// and nothing of the other team but champions.
const game = {
  gameId: 7123456789,
  gameCreation: 1760000000000,
  gameDuration: 1100,
  queueId: 2400,
  gameVersion: "16.20.715.1234",
  participants: [
    { participantId: 1, teamId: 100, championId: 103, puuid: "me", championName: "Ahri", riotIdGameName: "Nico", riotIdTagline: "NA1",
      stats: { win: true, kills: 12, deaths: 3, assists: 20, totalDamageDealtToChampions: 51000, playerAugment1: 1001, item0: 3089, goldEarned: 99 } },
    { participantId: 2, teamId: 100, championId: 1, puuid: "someone", riotIdGameName: "Other", riotIdTagline: "EUW", stats: { kills: 4, goldEarned: 5 } },
    { participantId: 6, teamId: 200, championId: 22, puuid: "enemy", riotIdGameName: "Enemy", stats: { kills: 9 } },
  ],
  killMap: [[60, 100, 200, 1, 6]],
  extra: "dropped",
};

describe("cleanHistoryGame", () => {
  it("keeps the player's own stats, teammates' names and a few stats, and only champions for the other team", () => {
    const g = cleanHistoryGame(game)!;
    expect(g.gameId).toBe(7123456789);
    const [me, mate, enemy] = g.participants as Record<string, unknown>[];
    expect(me).toMatchObject({ puuid: "me", championName: "Ahri", riotIdGameName: "Nico" });
    expect((me.stats as Record<string, unknown>).kills).toBe(12);
    expect((me.stats as Record<string, unknown>).goldEarned).toBeUndefined();
    expect(mate).toEqual({ participantId: 2, teamId: 100, championId: 1, riotIdGameName: "Other", riotIdTagline: "EUW",
      stats: { kills: 4, deaths: 0, assists: 0, totalDamageDealtToChampions: 0 } });
    expect(enemy).toEqual({ participantId: 6, teamId: 200, championId: 22 });
    expect(JSON.stringify(g)).not.toContain("someone");
    expect(g.killMap).toEqual([[60, 100, 200, 1, 6]]);
    expect(JSON.stringify(g)).not.toContain("dropped");
  });

  it.each([
    [{ ...game, gameId: 0 }],
    [{ ...game, gameVersion: "<b>" }],
    [{ ...game, participants: game.participants.map((p) => ({ ...p, puuid: "x" })) }],
    [null],
  ])("refuses a game that isn't one of the player's", (g) => expect(cleanHistoryGame(g)).toBeNull());

  it("strips markup from names", () => {
    const g = cleanHistoryGame({ ...game, participants: [{ ...game.participants[0], riotIdGameName: "<img src=x>Nico" }] })!;
    expect((g.participants[0] as Record<string, unknown>).riotIdGameName).toBe("img src=xNico");
  });
});
