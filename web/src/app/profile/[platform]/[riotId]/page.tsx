import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import championIds from "@/data/champion-ids.json";
import { champName } from "@/lib/highlights";
import { pageMeta } from "@/lib/meta";
import { profileByRiotId, profilePath, profileRiotId } from "@/lib/profiles";

// A player's public page, published by them from My Stats. Nothing appears here unless they publish.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ platform: string; riotId: string }> };

const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([a, id]) => [id, a]));
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const wr = (n: number) => (n >= 0.52 ? "wr-high" : n <= 0.48 ? "wr-low" : "");
const kda = (k: number, d: number, a: number) => ((k + a) / Math.max(1, d)).toFixed(2);
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

async function load({ params }: Props) {
  const { platform, riotId } = await params;
  const id = profileRiotId(riotId);
  return id ? profileByRiotId(platform, id) : null;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const p = await load(props);
  if (!p) return { title: "Player not found · DeepARAM", robots: { index: false } };
  const d = p.data;
  return pageMeta(profilePath(p.platform, p.name, p.tag), `${p.name}#${p.tag}`,
    `${p.name}#${p.tag}'s ARAM Mayhem stats: ${d.games} matches, ${pct(d.wins / d.games)} win rate, top champions and achievements.`);
}

export default async function ProfilePage(props: Props) {
  const p = await load(props);
  if (!p) notFound();
  const d = p.data;
  const rate = d.wins / d.games;
  return (
    <>
      <section className="intro compact">
        <p className="eyebrow">Player · {p.platform.toUpperCase()}</p>
        <h1>
          {p.name}
          <span className="profile-tag">#{p.tag}</span>
        </h1>
        <p className="lede">
          {d.games.toLocaleString()} ARAM Mayhem matches
          {d.first && d.last ? `, ${fmtDate(d.first)} to ${fmtDate(d.last)}` : ""}. Updated {fmtDate(Date.parse(p.updated + "Z"))}.
        </p>
        <div className="stat-row">
          <div>
            <b>{d.games.toLocaleString()}</b>
            <span>total matches</span>
          </div>
          <div>
            <b className={wr(rate)}>{pct(rate)}</b>
            <span>
              win rate, {d.wins} W · {d.games - d.wins} L
            </span>
          </div>
          <div>
            <b>{kda(d.kills, d.deaths, d.assists)}</b>
            <span>
              KDA, {(d.kills / d.games).toFixed(1)} / {(d.deaths / d.games).toFixed(1)} / {(d.assists / d.games).toFixed(1)}
            </span>
          </div>
          <div>
            <b>{d.damage.toLocaleString()}</b>
            <span>damage per game</span>
          </div>
          {d.duration > 0 && (
            <div>
              <b>
                {Math.floor(d.duration / 60)}:{String(d.duration % 60).padStart(2, "0")}
              </b>
              <span>average game</span>
            </div>
          )}
        </div>
      </section>
      <div className="bento">
        {d.champions.length > 0 && (
          <section className="card span-7" data-accent="gold">
            <div className="card-head">
              <h2>Top champions</h2>
            </div>
            <div className="rank plain">
              {d.champions.map((c) => {
                const alias = ALIAS[c.id];
                const name = alias ? champName(alias) : `Champion ${c.id}`;
                const row = (
                  <>
                    {alias && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="icon" src={`/icons/champions/${alias}.webp`} alt="" width={24} height={24} loading="lazy" />
                    )}
                    <span className="rank-name">
                      {name} <small className="muted">{c.n} matches · {kda(c.k, c.d, c.a)} KDA</small>
                    </span>
                    <span className={`rank-v ${wr(c.w / c.n)}`}>{pct(c.w / c.n)}</span>
                  </>
                );
                return alias ? (
                  <Link key={c.id} href={`/champions/${alias}`}>
                    {row}
                  </Link>
                ) : (
                  <div key={c.id}>{row}</div>
                );
              })}
            </div>
          </section>
        )}
        <section className="card span-5" data-accent="gold">
          <div className="card-head">
            <h2>Achievements</h2>
            <span className="muted">{d.badges.length} earned</span>
          </div>
          {d.badges.length ? (
            <div className="profile-badges">
              {d.badges.map((b) => (
                <span key={b} className="chip tier-gold">
                  ★ {b}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">None yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
