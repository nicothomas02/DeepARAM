import type { Metadata } from "next";
import ClashPlanner, { type ClashChampion } from "@/components/ClashPlanner";
import { T } from "@/components/I18n";
import Intro from "@/components/Intro";
import clash from "@/data/clash.json";
import { PLATFORMS, upcomingAramClash, type ClashDate, type Platform } from "@/lib/riot";
import "./clash.css";

// ARAM Clash: upcoming dates on the visitor's server, a team planner (team, bench, bans) and the summoner
// spells ARAM allows. Data: src/data/clash.json (scripts/build_clash_data.py) and the Clash schedule.
// A preview: not in the header yet and kept out of search until it goes live.
export const metadata: Metadata = { title: "ARAM Clash · DeepARAM", robots: { index: false, follow: false } };

type Spell = { id: string; name: string; cooldown: number; description: string; icon: string };

const SERVERS: [Platform, string][] = [
  ["na1", "NA"], ["euw1", "EUW"], ["eun1", "EUNE"], ["kr", "KR"], ["br1", "BR"], ["la1", "LAN"], ["la2", "LAS"],
  ["oc1", "OCE"], ["tr1", "TR"], ["ru", "RU"], ["jp1", "JP"], ["me1", "ME"], ["sg2", "SEA"], ["tw2", "TW"], ["vn2", "VN"],
];

const pretty = (key: string) => key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

export default async function Page({ searchParams }: { searchParams: Promise<{ server?: string }> }) {
  const { server } = await searchParams;
  const platform: Platform = server && server in PLATFORMS ? (server as Platform) : "na1";
  const dates: ClashDate[] | null = await upcomingAramClash(platform).catch(() => null);
  const spells = clash.spells as Spell[];

  return (
    <>
      <Intro eyebrow={<T ns="clash">Clash</T>} title={<T ns="clash">Plan your ARAM Clash team.</T>}>
        <T ns="clash">Check the next ARAM Clash dates, read your team&apos;s damage, frontline and range, and share the plan with your teammates.</T>
      </Intro>

      <section className="card clash-dates">
        <div className="card-head">
          <h2>
            <T ns="clash">Upcoming ARAM Clash</T>
          </h2>
          <nav className="clash-servers" aria-label="Server">
            {SERVERS.map(([id, label]) => (
              <a key={id} href={`?server=${id}`} aria-current={id === platform ? "true" : undefined}>
                {label}
              </a>
            ))}
          </nav>
        </div>
        {dates?.length ? (
          <ul className="clash-date-list">
            {dates.map((d) => (
              <li key={d.id}>
                <b>{pretty(d.name)}</b>
                <span>
                  <T ns="clash">Registration</T> {when(d.registration)}
                </span>
                <span>
                  <T ns="clash">Starts</T> {when(d.start)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="clash-hint">
            <T ns="clash">No ARAM Clash dates are announced for this server right now.</T>
          </p>
        )}
      </section>

      <ClashPlanner champions={clash.champions as ClashChampion[]} />

      <section className="card clash-spells">
        <div className="card-head">
          <h2>
            <T ns="clash">ARAM summoner spells</T>
          </h2>
        </div>
        <ul>
          {spells.map((s) => (
            <li key={s.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.icon} alt="" width={40} height={40} loading="lazy" />
              <div>
                <b>{s.name}</b> <span className="clash-cd">{s.cooldown}s</span>
                <p>{s.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
