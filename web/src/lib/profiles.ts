import "server-only";
import { d1 } from "./env";
import { PLATFORMS, type Platform } from "./platforms";

// Public player pages. A player publishes from My Stats on their own computer; the local helper sends the
// signed-in client's access token with the summary, and the page is stored under the account that token
// belongs to, so nobody can publish or remove someone else's page. Only the summary below is kept.

export type ProfileChamp = { id: number; n: number; w: number; k: number; d: number; a: number };
export type ProfileData = {
  games: number; wins: number; kills: number; deaths: number; assists: number;
  damage: number; duration: number; first: number; last: number;
  champions: ProfileChamp[]; badges: string[];
};
export type StoredProfile = { platform: Platform; name: string; tag: string; data: ProfileData; updated: string };

const int = (v: unknown, max = 1e9) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : 0);

/** Keeps only the known fields, as numbers or short strings. */
export function cleanProfile(raw: unknown): ProfileData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const games = int(r.games, 100000);
  if (!games) return null;
  const champs = Array.isArray(r.champions) ? r.champions.slice(0, 10) : [];
  const badges = Array.isArray(r.badges) ? r.badges.slice(0, 40) : [];
  return {
    games, wins: Math.min(games, int(r.wins)), kills: int(r.kills), deaths: int(r.deaths), assists: int(r.assists),
    damage: int(r.damage), duration: int(r.duration, 36000), first: int(r.first, 1e13), last: int(r.last, 1e13),
    champions: champs.map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { id: int(o.id, 100000), n: int(o.n), w: int(o.w), k: int(o.k), d: int(o.d), a: int(o.a) };
    }).filter((c) => c.id && c.n),
    badges: badges.map((b) => String(b).slice(0, 40)).filter(Boolean),
  };
}

export const isPlatform = (p: unknown): p is Platform => typeof p === "string" && Object.hasOwn(PLATFORMS, p);

type Owner = { puuid: string; name: string; tag: string };

/** The account a client access token belongs to, or null if the token isn't valid. */
export async function tokenOwner(token: string, platform: Platform): Promise<Owner | null> {
  if (!/^[\w.-]{20,8000}$/.test(token)) return null;
  const auth = { Authorization: `Bearer ${token}` };
  try {
    const res = await fetch("https://auth.riotgames.com/userinfo", { headers: auth, cache: "no-store" });
    if (res.ok) {
      const u = (await res.json()) as { sub?: string; acct?: { game_name?: string; tag_line?: string } };
      if (u.sub && u.acct?.game_name && u.acct.tag_line) return { puuid: u.sub, name: u.acct.game_name, tag: u.acct.tag_line };
    }
  } catch {
    // The token couldn't be checked.
  }
  return null;
}

export const nameKey = (name: string, tag: string) => `${name}-${tag}`.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
export const profilePath = (platform: string, name: string, tag: string) =>
  `/profile/${platform}/${encodeURIComponent(`${name}-${tag}`)}`;

export async function saveProfile(owner: Owner, platform: Platform, data: ProfileData) {
  const db = d1("PROFILES");
  if (!db) throw new Error("storage unavailable");
  await db.prepare(
    `INSERT INTO profiles (puuid, region, name, tag, name_key, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(puuid) DO UPDATE SET region = excluded.region, name = excluded.name, tag = excluded.tag,
       name_key = excluded.name_key, data = excluded.data, updated_at = excluded.updated_at`,
  ).bind(owner.puuid, platform, owner.name, owner.tag, nameKey(owner.name, owner.tag), JSON.stringify(data)).run();
}

export async function removeProfile(puuid: string) {
  await d1("PROFILES")?.prepare("DELETE FROM profiles WHERE puuid = ?").bind(puuid).run();
}

type Row = { region: string; name: string; tag: string; data: string; updated_at: string };
const toProfile = (r: Row | null): StoredProfile | null =>
  r && isPlatform(r.region) ? { platform: r.region, name: r.name, tag: r.tag, data: JSON.parse(r.data), updated: r.updated_at } : null;

export async function profileByPuuid(puuid: string) {
  const db = d1("PROFILES");
  return db ? toProfile(await db.prepare("SELECT region, name, tag, data, updated_at FROM profiles WHERE puuid = ?").bind(puuid).first<Row>()) : null;
}

/** riotId is "name-tag" as in the page address; the tag is everything after the last dash. */
export async function profileByRiotId(platform: string, riotId: string) {
  const db = d1("PROFILES");
  const i = riotId.lastIndexOf("-");
  if (!db || !isPlatform(platform) || i < 1) return null;
  const key = nameKey(riotId.slice(0, i), riotId.slice(i + 1));
  return toProfile(await db.prepare("SELECT region, name, tag, data, updated_at FROM profiles WHERE region = ? AND name_key = ?").bind(platform, key).first<Row>());
}
