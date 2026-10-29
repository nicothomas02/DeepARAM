import { describe, expect, it } from "vitest";
import { cleanHistoryGame } from "@/lib/match-history";

// Malformed, partial and odd games as My Stats might send them to /api/history (lib/match-history.ts): the
// cleaner keeps what the dashboard can read and refuses what it can't.
const me = { participantId: 1, teamId: 100, championId: 103, puuid: "me", championName: "Ahri", riotIdGameName: "Nico", riotIdTagline: "NA1",
  stats: { win: true, kills: 12, deaths: 3, assists: 20, pentaKills: 1, quadraKills: 2 } };
const mate = { participantId: 2, teamId: 100, championId: 1, puuid: "someone", riotIdGameName: "Other", riotIdTagline: "EUW", stats: { kills: 4 } };
const enemy = { participantId: 6, teamId: 200, championId: 22, puuid: "enemy", riotIdGameName: "Enemy", stats: { kills: 9 } };
const game = { gameId: 7123456789, gameCreation: 1760000000000, gameDuration: 1100, queueId: 2400, gameVersion: "16.20.715.1234", participants: [me, mate, enemy] };

const stats = (g: ReturnType<typeof cleanHistoryGame>) => ((g!.participants[0] as Record<string, unknown>).stats as Record<string, number | boolean>);

describe("cleanHistoryGame with partial or odd games", () => {
  it("refuses a game with no participants, or whose only participants are other people", () => {
    expect(cleanHistoryGame({ ...game, participants: [] })).toBeNull();
    expect(cleanHistoryGame({ ...game, participants: undefined })).toBeNull();
    expect(cleanHistoryGame({ ...game, participants: "nope" })).toBeNull();
    expect(cleanHistoryGame({ ...game, participants: [mate, enemy] })).toBeNull();
  });

  it("refuses a game the player appears in twice", () => {
    expect(cleanHistoryGame({ ...game, participants: [me, { ...me, participantId: 3 }] })).toBeNull();
  });

  it("refuses a game with no creation time, which the dashboard couldn't place on a day", () => {
    expect(cleanHistoryGame({ ...game, gameCreation: 0 })).toBeNull();
    expect(cleanHistoryGame({ ...game, gameCreation: undefined })).toBeNull();
    expect(cleanHistoryGame({ ...game, gameCreation: "soon" })).toBeNull();
  });

  it("keeps a game of any length, including a remake, with the duration in seconds", () => {
    expect(cleanHistoryGame({ ...game, gameDuration: 0 })!.gameDuration).toBe(0);
    expect(cleanHistoryGame({ ...game, gameDuration: 180 })!.gameDuration).toBe(180);
    // Older archives have the duration in milliseconds (as the dashboard and the shared-game cleaner know).
    expect(cleanHistoryGame({ ...game, gameDuration: 1_100_400 })!.gameDuration).toBe(1100);
    expect(cleanHistoryGame({ ...game, gameDuration: -5 })!.gameDuration).toBe(0);
  });

  it("accepts ids and numbers sent as strings, and treats junk as zero", () => {
    const g = cleanHistoryGame({ ...game, gameId: "7123456789", queueId: "2450", participants: [{ ...me, championId: "103", stats: { ...me.stats, kills: "12", deaths: {} } }] })!;
    expect(g.gameId).toBe(7123456789);
    expect(g.queueId).toBe(2450);
    expect((g.participants[0] as Record<string, unknown>).championId).toBe(103);
    expect(stats(g).kills).toBe(12);
    expect(stats(g).deaths).toBe(0);
  });

  it("keeps a game with an unknown champion id rather than guessing one", () => {
    const g = cleanHistoryGame({ ...game, participants: [{ ...me, championId: 99999, championName: undefined }] })!;
    expect(g.participants[0]).toMatchObject({ championId: 99999 });
    expect((g.participants[0] as Record<string, unknown>).championName).toBeUndefined();
  });

  it("survives participants and stats that aren't objects", () => {
    const g = cleanHistoryGame({ ...game, participants: [null, { ...me, stats: "none" }, { ...mate, stats: null }, 5] })!;
    expect(g.participants).toHaveLength(4);
    expect(stats(cleanHistoryGame({ ...game, participants: [{ ...me, stats: "none" }] })).win).toBe(false);
    expect((g.participants[2] as Record<string, unknown>).stats).toEqual({ kills: 0, deaths: 0, assists: 0, totalDamageDealtToChampions: 0 });
  });

  it("counts a win only when the stats say true", () => {
    for (const win of ["Win", 1, "true", true]) {
      expect(stats(cleanHistoryGame({ ...game, participants: [{ ...me, stats: { win }, participantId: 1 }] })).win).toBe(win === true);
    }
  });

  it("keeps multikill counts and clamps absurd ones", () => {
    const g = cleanHistoryGame({ ...game, participants: [{ ...me, stats: { pentaKills: 2, quadraKills: -1, largestKillingSpree: 1e12 } }] });
    expect(stats(g)).toMatchObject({ pentaKills: 2, quadraKills: 0, largestKillingSpree: 1e9 });
  });

  it("keeps only the first ten participants and needs the player among them", () => {
    const crowd = Array.from({ length: 12 }, (_, i) => ({ ...enemy, participantId: i + 1 }));
    expect(cleanHistoryGame({ ...game, participants: [...crowd, me] })).toBeNull();
    expect(cleanHistoryGame({ ...game, participants: [me, ...crowd] })!.participants).toHaveLength(10);
  });

  it("drops kill-map rows that don't have a time, a position and both players", () => {
    const g = cleanHistoryGame({ ...game, killMap: [[60, 100, 200, 1, 6], [70, 100], "x", [], [80, 1, 2, 3, 4, 5, 6], [90, 1, 2, "a", null]] })!;
    expect(g.killMap).toEqual([[60, 100, 200, 1, 6], [80, 1, 2, 3, 4], [90, 1, 2, 0, 0]]);
    expect(cleanHistoryGame({ ...game, killMap: "later" })!.killMap).toBeUndefined();
    expect(cleanHistoryGame({ ...game, killMap: [] })!.killMap).toEqual([]);
  });

  it("accepts any queue id, since the helper only imports Mayhem games", () => {
    expect(cleanHistoryGame({ ...game, queueId: 450 })!.queueId).toBe(450);
    expect(cleanHistoryGame({ ...game, queueId: undefined })!.queueId).toBe(0);
  });

  it("accepts the patch versions Riot uses and nothing else", () => {
    expect(cleanHistoryGame({ ...game, gameVersion: "16.1.1" })!.gameVersion).toBe("16.1.1");
    expect(cleanHistoryGame({ ...game, gameVersion: "16.20" })!.gameVersion).toBe("16.20");
    expect(cleanHistoryGame({ ...game, gameVersion: "16.20.715.1234.5678.9999" })!.gameVersion).toHaveLength(20);
    for (const v of ["", "v16.20", "16", "16.20 <b>", 16.2, null]) expect(cleanHistoryGame({ ...game, gameVersion: v })).toBeNull();
  });

  it("keeps a teammate's name only when it is a usable string", () => {
    const g = cleanHistoryGame({ ...game, participants: [me, { ...mate, riotIdGameName: 42 }, { ...mate, participantId: 3, riotIdGameName: "<>\u0000" }, { ...mate, participantId: 4, riotIdGameName: "x".repeat(80) }] })!;
    expect(g.participants[1]).toEqual({ participantId: 2, teamId: 100, championId: 1 });
    expect(g.participants[2]).toEqual({ participantId: 3, teamId: 100, championId: 1 });
    expect((g.participants[3] as Record<string, unknown>).riotIdGameName).toBe("x".repeat(40));
  });

  it("never keeps anyone else's account id, however it is spelled", () => {
    const g = cleanHistoryGame({ ...game, participants: [me, { ...mate, PUUID: "shout", summonerId: 77, player: { puuid: "nested" } }] })!;
    const text = JSON.stringify(g);
    for (const s of ["someone", "shout", "77", "nested", "summonerId"]) expect(text).not.toContain(s);
  });
});
