import type { Metadata } from "next";
import Link from "next/link";
import { pageMeta } from "@/lib/meta";
import DataTable from "@/components/DataTable";
import Embed from "@/components/Embed";
import Intro from "@/components/Intro";
import { text } from "@/lib/content";
import Pending from "@/components/Pending";
import SimBuildsTable, { type SimBuild } from "@/components/SimBuildsTable";
import SimLeaderboard from "@/components/SimLeaderboard";
import SimReplayEmbed from "@/components/SimReplayEmbed";
import SubTabs from "@/components/SubTabs";
import { readRepoJson, repoHas } from "@/lib/repo-data";

export const metadata: Metadata = pageMeta("/simulator", "ARAM Mayhem Teamfight Simulator", "Simulated ARAM Mayhem teamfights, simulated builds and fight replays for every champion.");

type Named = Record<string, { name: string; id: number }>;
type BestBuilds = {
  champions: {
    champion: string;
    name: string;
    role: string;
    parse_quality: string;
    build: { items: string[]; augments: string[] };
    summary: { mean_dps: number; median: number; survival_rate: number; time_alive: number };
  }[];
};

const VIEWER = "simulator/viewer";

export default function SimulatorPage() {
  if (!repoHas(`${VIEWER}/index.html`) && !repoHas("simulator/README.md")) {
    return (
      <>
        <Intro eyebrow="Simulator" title={text("page./simulator.title", "Teamfight damage, simulated.")} />
        <Pending pr={4}>The simulator appears here once it is merged:</Pending>
      </>
    );
  }

  const best = readRepoJson<BestBuilds>(`${VIEWER}/replay-data/best-builds.json`);
  const items = readRepoJson<{ items: Named }>("simulator/data/items.json")?.items ?? {};
  const augments = readRepoJson<{ augments: Named }>("simulator/data/augments.json")?.augments ?? {};
  const hasReplays = repoHas(`${VIEWER}/replay-data/index.json`);

  const tabs = [];
  if (hasReplays) {
    tabs.push({
      id: "replays",
      label: "1v1",
      content: <SimReplayEmbed />,
    });
  }
  if (repoHas(`${VIEWER}/team.html`)) {
    tabs.push({
      id: "teamfight",
      label: "5v5 teamfight",
      lazy: true,
      content: <Embed src="/embed/simulator/team.html" title="Mayhem 5v5 teamfight" minHeight={1100} />,
    });
  }
  if (best) {
    const builds: SimBuild[] = best.champions.map((c) => ({
      row: { name: c.champion, role: c.role, dps: c.summary.mean_dps, survival: c.summary.survival_rate, alive: c.summary.time_alive },
      items: c.build.items.map((i) => [items[i]?.id ?? 0, items[i]?.name ?? i]),
      augments: c.build.augments.map((a) => [augments[a]?.id ?? 0, augments[a]?.name ?? a]),
    }));
    tabs.push({
      id: "builds",
      label: "Simulated builds",
      content: <SimBuildsTable builds={builds} />,
    });
  }

  if (hasReplays) {
    const names = (m: Named) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { name: v.name, id: v.id }]));
    // Leaderboards, one tab each; more boards can be added here with their own name.
    tabs.push({
      id: "leaderboard",
      label: "Leaderboard",
      lazy: true,
      content: <SimLeaderboard board="Leaderboard" items={names(items)} augments={names(augments)} />,
    });
  }


  return (
    <>
      <Intro eyebrow="Simulator" title={text("page./simulator.title", "Teamfight damage, simulated.")}>
        An experiment: results can shift as the model changes. Monte Carlo teamfights against enemy teams weighted by
        Mayhem pick rates, with a build search for every champion. Use it to compare builds for one champion, not to
        rank champions.
      </Intro>
      {tabs.length ? (
        <SubTabs tabs={tabs} />
      ) : (
        <Pending pr={4}>
          The simulator is in the repo, but its results haven&apos;t been generated for the site yet. See
        </Pending>
      )}
    </>
  );
}
