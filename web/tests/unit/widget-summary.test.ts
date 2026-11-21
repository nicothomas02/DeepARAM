import { describe, expect, it } from "vitest";
import type { HistoryGame } from "@/lib/match-history";
import { widgetSummary } from "@/lib/widget-summary";

// The iPhone widgets' summary (lib/widget-summary.ts): the week judged by leading indicators against the player's
// own usual, one tip, and the live patch for the champions they play most.
const NOW = Date.UTC(2026, 10, 21, 12);
const DAY = 86_400_000;

function game(daysAgo: number, o: { champ?: string; win?: boolean; deaths?: number; damage?: number; kills?: number; assists?: number; teamKills?: number; minutes?: number } = {}): HistoryGame {
  const kills = o.kills ?? 10;
  return {
    gameId: Math.round(NOW - daysAgo * DAY),
    gameCreation: NOW - daysAgo * DAY,
    gameDuration: (o.minutes ?? 20) * 60,
    queueId: 2400,
    gameVersion: "16.23.1",
    participants: [
      { participantId: 1, teamId: 100, championId: 103, puuid: "me", championName: o.champ ?? "Ahri",
        stats: { win: o.win ?? true, kills, deaths: o.deaths ?? 4, assists: o.assists ?? 20, totalDamageDealtToChampions: o.damage ?? 40000 } },
      { participantId: 2, teamId: 100, championId: 1, riotIdGameName: "Mate", stats: { kills: (o.teamKills ?? 50) - kills } },
      { participantId: 6, teamId: 200, championId: 22 },
    ],
  };
}

const tiers = [
  { id: "Ahri", name: "Ahri", tier: "A", deepScore: 61 },
  { id: "MonkeyKing", name: "Wukong", tier: "S", deepScore: 74 },
  { id: "Brand", name: "Brand", tier: "B", deepScore: 52 },
];
const before = [{ id: "Ahri", name: "Ahri", tier: "B", deepScore: 55 }];

describe("widgetSummary", () => {
  const usual = Array.from({ length: 12 }, (_, i) => game(10 + i * 3, { deaths: 4 }));

  it("counts the week and compares each indicator with the player's usual", () => {
    const week = [game(1, { deaths: 8, win: false }), game(2, { deaths: 8 }), game(3, { deaths: 8 })];
    const s = widgetSummary([...week, ...usual], NOW, "26.23", tiers, before);
    expect(s.week).toMatchObject({ games: 3, wins: 2, losses: 1 });
    const deaths = s.week.indicators.find((i) => i.key === "deaths")!;
    expect(deaths).toMatchObject({ week: 4, usual: 2, better: false });
    expect(s.week.indicators.find((i) => i.key === "kp")).toMatchObject({ week: 60, usual: 60, better: true });
    // The tip names the indicator furthest below usual.
    expect(s.tip.key).toBe("deaths");
    expect(s.tip.body).toContain("4 deaths per 10 min");
  });

  it("praises a week that is at or better than usual, and asks for games when there are too few", () => {
    const good = [game(1), game(2), game(3)];
    expect(widgetSummary([...good, ...usual], NOW, "26.23", tiers, before).tip.key).toBeNull();
    expect(widgetSummary([...good, ...usual], NOW, "26.23", tiers, before).tip.title).toBe("Keep it going");
    expect(widgetSummary([], NOW, "26.23", tiers, before).tip.title).toBe("Play a few games");
  });

  it("skips remakes and has no usual without enough older games", () => {
    const s = widgetSummary([game(1, { minutes: 3 }), game(2), game(3), game(4)], NOW, null, [], []);
    expect(s.week.games).toBe(3);
    expect(s.week.indicators.every((i) => i.usual === null && i.better === null)).toBe(true);
  });

  it("lists the most played champions with their DeepScore move and Mayhem notes, matching names loosely", () => {
    const games = [game(1, { champ: "MonkeyKing" }), game(2, { champ: "MonkeyKing" }), game(3), game(4, { champ: "Brand" }), game(5, { champ: "MonkeyKing" }), game(6, { champ: "Zoe" })];
    const s = widgetSummary(games, NOW, "26.23", tiers, before, { Wukong: ["Q damage: 20 ⇒ 30"] });
    expect(s.patch.live).toBe("26.23");
    expect(s.patch.champions.map((c) => c.id)).toEqual(["MonkeyKing", "Ahri", "Brand"]);
    expect(s.patch.champions[0]).toMatchObject({ games: 3, change: null, notes: ["Q damage: 20 ⇒ 30"] });
    expect(s.patch.champions[1]).toMatchObject({ change: 6, tierBefore: "B" });
  });
});
