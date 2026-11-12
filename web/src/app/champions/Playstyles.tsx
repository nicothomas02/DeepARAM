import Link from "next/link";
import { Name, T } from "@/components/I18n";
import type { playstyleClusters } from "@/lib/analysis";

// Playstyle groups from data/analysis/playstyle_clusters.py: champions grouped by how their Mayhem games go
// (damage share, damage soaked, kill participation, time dead, which augments they take), not by Riot's class.
// Each group names the classes it mostly holds; champions whose class is rare in their group are marked.

const STAT: Record<string, string> = {
  avg_damage_ratio: "damage share",
  avg_tank_ratio: "damage soaked",
  avg_participation_rate: "kill participation",
  avg_death_time: "time dead",
};

export default function Playstyles({ data }: { data: ReturnType<typeof playstyleClusters> }) {
  if (!data || !data.clusters.length) return null;
  const unlike = data.champions.filter((c) => c.unlike_class);
  const byAlias = new Map(data.champions.map((c) => [c.alias, c]));
  return (
    <section className="playstyles" id="playstyles">
      <div className="card-head">
        <h2>
          <T ns="champions">Playstyles</T>
        </h2>
        <span className="card-note">
          <T ns="champions" v={{ k: data.k, n: data.features.patches }}>
            {"{k} groups from the last {n} patches"}
          </T>
        </span>
      </div>
      <p className="muted">
        <T ns="champions">
          Grouped by how their games actually go: share of the team&apos;s damage, damage soaked, kill participation, time dead and which augments they take. Classes are Riot&apos;s; a marked champion plays unlike its class.
        </T>
      </p>
      <div className="bento">
        {data.clusters.map((cl) => (
          <section key={cl.id} className="card span-6 playstyle">
            <div className="card-head">
              <h3>
                <T ns="champions">{cl.label}</T>
              </h3>
              <span className="card-note">{cl.size}</span>
            </div>
            <p className="playstyle-profile muted">
              {Object.entries(cl.profile)
                .filter(([, v]) => Math.abs(v) >= 0.2)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .map(([k, v]) => (
                  <span key={k}>
                    {v > 0 ? "▲" : "▼"} <T ns="champions">{STAT[k] ?? k}</T>
                  </span>
                ))}
              {cl.classes.length > 0 && (
                <span>
                  <T ns="champions">mostly</T> {cl.classes.slice(0, 2).map((c) => c.name).join(", ")}
                </span>
              )}
            </p>
            <ul className="playstyle-champs">
              {cl.champions.map((a) => (
                <li key={a} data-unlike={byAlias.get(a)?.unlike_class ? "true" : undefined}>
                  <Link href={`/champions/${a}`} title={byAlias.get(a)?.name ?? a}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/icons/champions/${a}.webp`} alt={byAlias.get(a)?.name ?? a} width={32} height={32} loading="lazy" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {unlike.length > 0 && (
        <p className="playstyle-unlike">
          <b>
            <T ns="champions">Plays unlike its class:</T>
          </b>{" "}
          {unlike.map((c, i) => (
            <span key={c.alias}>
              {i > 0 && ", "}
              <Link href={`/champions/${c.alias}`}>
                <Name kind="champions" id={c.alias}>
                  {c.name}
                </Name>
              </Link>{" "}
              <small className="muted">({c.classes.join("/")})</small>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
