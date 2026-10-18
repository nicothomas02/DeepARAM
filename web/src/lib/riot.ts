import "server-only";
import challengeNames from "@/data/challenges.json";
import { serverEnv } from "./env";

// Regional routing values used by the account-v1 and match-v5 APIs.
export const REGIONS = ["americas", "europe", "asia", "sea"] as const;
export type Region = (typeof REGIONS)[number];

export class RiotError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function apiKey(): string {
  const key = serverEnv("RIOT_API_KEY");
  if (!key) throw new RiotError("RIOT_API_KEY is not set on the server", 500);
  return key;
}

// Calls the Riot API with the key from the environment. Responses are cached
// by Next.js for `revalidate` seconds so repeat lookups don't spend rate limit.
export async function riotFetch<T>(
  host: Region | Platform,
  path: string,
  revalidate = 300,
): Promise<T> {
  const res = await fetch(`https://${PLATFORM_HOST[host as Platform] ?? host}.api.riotgames.com${path}`, {
    headers: { "X-Riot-Token": apiKey() },
    next: { revalidate },
  });
  if (!res.ok) {
    throw new RiotError(`Lookup failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

export type Account = { puuid: string; gameName: string; tagLine: string };

// Platform routing values (one per server) and the regional host each one's accounts live on.
export const PLATFORMS = {
  na1: "americas", br1: "americas", la1: "americas", la2: "americas",
  euw1: "europe", eun1: "europe", tr1: "europe", ru: "europe",
  me1: "europe",
  kr: "asia", jp1: "asia",
  oc1: "sea", sg2: "sea", ph2: "sea", th2: "sea", tw2: "sea", vn2: "sea",
} as const satisfies Record<string, Region>;
export type Platform = keyof typeof PLATFORMS;
// PH and TH merged into the SEA server, so their lookups go to sg2.
const PLATFORM_HOST: Partial<Record<Platform, string>> = { ph2: "sg2", th2: "sg2" };

export type ChallengeProgress = { challenges: { challengeId: number; level: string; value: number; percentile: number }[] };

export type Mastery = { championId: number; championLevel: number; championPoints: number };
export type ChallengeSummary = {
  /** percentile is the share of players at or above this player (0.05 = top 5%). */
  total: { level: string; current: number; percentile: number } | null;
  aram: { level: string; value: number; percentile: number } | null;
  /** The challenge tokens the player shows on their profile in the client (up to three), at their current level. */
  tokens: { id: number; name: string; description: string; level: string }[];
  /** The title the player has picked, if any. */
  title: string | null;
};
export type ClashMember = {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  position: string;
  role: string;
  /** Their three highest-mastery champions. */
  top: Mastery[];
};
export type ClashTeam = { name: string; abbreviation: string; tier: number; iconId: number; members: ClashMember[] };
export type PlayerExtras = { mastery: Mastery[]; challenges: ChallengeSummary | null; clash: ClashTeam | null };

/** The challenge that sums every ARAM challenge ("ARAM Authority"). */
const ARAM_CHALLENGE = 101000;

const topMastery = (platform: Platform, puuid: string, count: number) =>
  riotFetch<Mastery[]>(platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/top?count=${count}`, 3600)
    .then((rows) => rows.map(({ championId, championLevel, championPoints }) => ({ championId, championLevel, championPoints })))
    .catch(() => [] as Mastery[]);

async function challengeSummary(platform: Platform, puuid: string): Promise<ChallengeSummary | null> {
  type Data = {
    totalPoints?: { level: string; current: number; percentile: number };
    challenges?: ChallengeProgress["challenges"];
    preferences?: { challengeIds?: number[]; title?: string };
  };
  const d = await riotFetch<Data>(platform, `/lol/challenges/v1/player-data/${encodeURIComponent(puuid)}`, 3600).catch(() => null);
  if (!d) return null;
  const aram = d.challenges?.find((c) => c.challengeId === ARAM_CHALLENGE);
  return {
    total: d.totalPoints ? { level: d.totalPoints.level, current: d.totalPoints.current, percentile: d.totalPoints.percentile } : null,
    aram: aram ? { level: aram.level, value: aram.value, percentile: aram.percentile } : null,
    ...shownOff(d.preferences, d.challenges ?? []),
  };
}

const NAMES: { challenges: Record<string, string[]>; titles: Record<string, string> } = challengeNames;

/** Names the tokens and title a player picked to show (ids in the API, names in data/challenges.json). */
export function shownOff(prefs: { challengeIds?: number[]; title?: string } | undefined, progress: ChallengeProgress["challenges"]) {
  const tokens = (prefs?.challengeIds ?? []).slice(0, 3).flatMap((id) => {
    const named = NAMES.challenges[String(id)];
    const level = progress.find((c) => c.challengeId === id)?.level;
    return named && level && level !== "NONE" ? [{ id, name: named[0], description: named[1] ?? "", level }] : [];
  });
  const title = prefs?.title ? (NAMES.titles[prefs.title] ?? null) : null;
  return { tokens, title };
}

/** The player's team in an ARAM Clash tournament, if they're on one. Summoner's Rift Clash teams are left out. */
async function aramClashTeam(platform: Platform, puuid: string): Promise<ClashTeam | null> {
  type Entry = { teamId: string };
  type Team = { tournamentId: number; name: string; abbreviation: string; tier: number; iconId: number; players: { puuid?: string; position: string; role: string }[] };
  type Tournament = { nameKey: string; nameKeySecondary: string };
  const entries = await riotFetch<Entry[]>(platform, `/lol/clash/v1/players/by-puuid/${encodeURIComponent(puuid)}`, 600).catch(() => []);
  for (const { teamId } of entries) {
    const team = await riotFetch<Team>(platform, `/lol/clash/v1/teams/${encodeURIComponent(teamId)}`, 600).catch(() => null);
    if (!team) continue;
    const t = await riotFetch<Tournament>(platform, `/lol/clash/v1/tournaments/${team.tournamentId}`, 3600).catch(() => null);
    if (!t || !/aram/i.test(`${t.nameKey} ${t.nameKeySecondary}`)) continue;
    const region = PLATFORMS[platform] === "sea" ? "asia" : PLATFORMS[platform];
    const members = await Promise.all(
      team.players.filter((p) => p.puuid).map(async (p) => {
        const [account, top] = await Promise.all([
          riotFetch<Account>(region, `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(p.puuid!)}`, 3600).catch(() => null),
          topMastery(platform, p.puuid!, 3),
        ]);
        return { puuid: p.puuid!, gameName: account?.gameName ?? null, tagLine: account?.tagLine ?? null, position: p.position, role: p.role, top };
      }),
    );
    return { name: team.name, abbreviation: team.abbreviation, tier: team.tier, iconId: team.iconId, members };
  }
  return null;
}

/** Mastery, challenge standing and ARAM Clash team for a Riot account connected to a site account. */
export async function getPlayerExtras(platform: Platform, puuid: string): Promise<PlayerExtras> {
  const [mastery, challenges, clash] = await Promise.all([
    topMastery(platform, puuid, 20),
    challengeSummary(platform, puuid),
    aramClashTeam(platform, puuid).catch(() => null),
  ]);
  return { mastery, challenges, clash };
}

export type ClashDate = { id: number; name: string; registration: number; start: number };

/** Upcoming ARAM Clash dates on one server, soonest first. Summoner's Rift Clash is left out; cancelled days too. */
export async function upcomingAramClash(platform: Platform): Promise<ClashDate[]> {
  type Tournament = { id: number; nameKey: string; nameKeySecondary: string; schedule: { id: number; registrationTime: number; startTime: number; cancelled: boolean }[] };
  const all = await riotFetch<Tournament[]>(platform, "/lol/clash/v1/tournaments", 3600);
  const now = Date.now();
  return all
    .filter((t) => /aram/i.test(`${t.nameKey} ${t.nameKeySecondary}`))
    .flatMap((t) =>
      t.schedule
        .filter((s) => !s.cancelled && s.startTime > now)
        .map((s) => ({ id: s.id, name: t.nameKeySecondary || t.nameKey, registration: s.registrationTime, start: s.startTime })),
    )
    .sort((a, b) => a.start - b.start);
}
