import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { livePatch } from "@/lib/highlights";
import augmentNames from "@/data/augment-names.json";
import { AdvancedProvider, AdvancedToggle } from "@/components/Advanced";
import ChampionTiers from "@/components/ChampionTiers";
import DataTable from "@/components/DataTable";
import DuosTable from "@/components/DuosTable";
import { hasDuos } from "@/lib/duos";
import { augmentHref } from "@/lib/augments";
import { augmentTiers, STYLES } from "@/lib/augment-tiers";
import AugmentTiers from "@/components/AugmentTiers";
import { augmentRows, type RawAugment } from "@/lib/augment-winrate";
import { AUGMENT_DEEPSCORE_HELP } from "@/lib/deepscore";
import championIds from "@/data/champion-ids.json";
import championNames from "@/data/champion-names.json";
import type { PatchRow } from "@/lib/tiers";
import Intro from "@/components/Intro";
import { T } from "@/components/I18n";
import ItemIndex from "@/components/ItemIndex";
import { itemPages } from "@/lib/item-pages";
import { text } from "@/lib/content";
import Pending from "@/components/Pending";
import SubTabs from "@/components/SubTabs";
import { readRepoCsv, readRepoJson } from "@/lib/repo-data";
import { allChampionTags, championTagData } from "@/lib/champion-tags";
import { fillGames } from "@/lib/fill";

export const metadata: Metadata = pageMeta(
  "/tier-list",
  `ARAM Mayhem Tier List${livePatch() ? `, Patch ${livePatch()}` : ""}`,
  "ARAM Mayhem champion tier list for the current patch, with augment win rates and duo synergy.",
);

const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));
const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([alias, id]) => [id, alias]));
const NAMES = championNames as Record<string, string>;
const names = augmentNames as Record<string, string>;

export default function TierListPage() {
  const byPatch = readRepoCsv("data/cn/history/by_patch.csv");
  const patches = readRepoCsv("data/cn/history/patches.csv");
  const augments = augmentRows<RawAugment & Record<string, string | number | number[]>>();
  const duos = hasDuos();

  if (!byPatch || !patches?.length) {
    return (
      <>
        <Intro
          eyebrow={<T ns="tier-list">Tier List</T>}
          title={<T ns="tier-list">{text("page./tier-list.title", "Every Mayhem champion and augment, ranked.")}</T>}
        />
        <Pending pr={5}>Champion, augment and duo stats appear here once the stats data is merged:</Pending>
      </>
    );
  }

  const latest = patches.at(-1)!;
  // Only the live and previous patch ship with the page; ChampionTiers loads the rest when picked.
  const recent = new Set(patches.slice(-2).map((p) => p.patch));
  const rows: PatchRow[] = byPatch
    .filter((r) => recent.has(r.patch))
    .map((r) => ({
      patch: r.patch,
      days: Number(r.days),
      name: r.name,
      win_rate: Number(r.win_rate),
      pick_rate: Number(r.pick_rate),
      damage: num(r.avg_damage_ratio),
      tank: num(r.avg_tank_ratio),
      kp: num(r.avg_participation_rate),
      dead: num(r.avg_death_time),
      augs: r.augment_ids ?? "",
    }));
  const champName = (alias?: string) => (alias ? (NAMES[alias] ?? alias) : null);
  const tabs: { id: string; label: string; content: React.ReactNode; lazy?: boolean }[] = [
    {
      id: "champions",
      label: "Champions",
      content: (
        <ChampionTiers
          rows={rows}
          patches={patches.map((p) => p.patch)}
          tags={allChampionTags([...new Set(rows.map((r) => r.name))])}
          tagInfo={championTagData().info}
          games={fillGames()}
        />
      ),
    },
  ];
  if (augments.length) {
    const graded = new Map(augmentTiers().map((a) => [a.id, a]));
    const augName = (a: Record<string, unknown>) => names[String(a.augment_id)] ?? String(a.key).replace(/^ARAM_/, "");
    const augCols = [
      { key: "grade", label: "Tier", format: "tier" as const, sortKey: "deepScore", hint: AUGMENT_DEEPSCORE_HELP },
      { key: "name", label: "Augment", format: "augment" as const, iconKey: "id", hrefKey: "href" },
      { key: "deepScore", label: "DeepScore", format: "deepscore" as const, hint: AUGMENT_DEEPSCORE_HELP },
      { key: "tier", label: "Rarity", format: "tier" as const },
      { key: "win_rate", label: "Win rate", format: "pct" as const },
      { key: "pick_rate", label: "Pick rate", format: "pct" as const },
    ];
    tabs.push({
      id: "augments",
      label: "Augments",
      content: (
        <>
          <AugmentTiers rows={augmentTiers()} styles={STYLES} />
          <p className="patch-note">
            <T ns="tier-list" v={{ patch: latest.patch }}>
              {
                "Live patch {patch}. Each augment gets a DeepScore against the others of its rarity: 50 is average, S is 70 and up, A 59, B 44, C 32 and D below. Every number is in the table below."
              }
            </T>
          </p>
          <DataTable
            columns={augCols}
            advancedColumns={[
              ...augCols,
              {
                key: "lift",
                label: "Win rate vs its champions",
                format: "pct" as const,
                hint: "Win rate minus what the champions who take it win anyway. Above zero means it helps them.",
              },
              { key: "win_rank", label: "Win rank", format: "int" },
              { key: "pick_rank", label: "Pick rank", format: "int" },
              { key: "pick_change", label: "Pick rank change", format: "int" },
              { key: "best", label: "Best champions", format: "text", sortable: false },
            ]}
            rows={augments
              .filter((a) => names[String(a.augment_id)] || a.key)
              .map((a) => ({
                id: Number(a.augment_id),
                href: augmentHref(Number(a.augment_id)),
                name: augName(a),
                tier: String(a.tier ?? ""),
                grade: graded.get(Number(a.augment_id))?.tier ?? null,
                deepScore: graded.get(Number(a.augment_id))?.deepScore ?? null,
                lift: graded.get(Number(a.augment_id))?.lift ?? null,
                win_rate: Number(a.win_rate),
                pick_rate: Number(a.pick_rate),
                win_rank: num(String(a.win_rank ?? "")),
                pick_rank: num(String(a.pick_rank ?? "")),
                pick_change: num(String(a.pick_rank_change ?? "")),
                best: ((a.best_champions as number[]) ?? [])
                  .slice(0, 4)
                  .map((id) => champName(ALIAS[id]))
                  .filter(Boolean)
                  .join(", "),
              }))}
            initialSort={{ key: "deepScore", desc: true }}
            searchKey="name"
            searchLabel="Find an augment"
            urlTab="augments"
          />
        </>
      ),
    });
  }
  // Formerly the Items page (/items redirects here); each item keeps its own page at /items/<slug>.
  const items = itemPages().map(({ id, slug, name, icon, cost, tags, popularity, tier, deepScore }) => ({ id, slug, name, icon, cost, tags, popularity, tier, deepScore }));
  if (items.length) {
    tabs.push({
      id: "items",
      label: "Items",
      lazy: true,
      content: (
        <>
          <p className="patch-note subtab-note">
            <T ns="items">
              Pick tags to narrow the list: every tag you pick has to match. Open an item for its stats, who builds it and how much damage it adds in the Simulator.
            </T>
          </p>
          <ItemIndex items={items} />
        </>
      ),
    });
  }
  if (duos) tabs.push({ id: "duos", label: "Duos", content: <DuosTable />, lazy: true });

  return (
    <AdvancedProvider>
      <Intro
        eyebrow={
          <T ns="tier-list" v={{ patch: latest.patch }}>
            {"Tier List · Patch {patch}"}
          </T>
        }
        title={<T ns="tier-list">{text("page./tier-list.title", "Every Mayhem champion and augment, ranked.")}</T>}
      >
        <T ns="tier-list" v={{ patch: latest.patch }}>
          {"Live patch {patch} by default. Pick any patches, or all time, above the champion table. Advanced shows every stat we have."}
        </T>
      </Intro>
      <div className="tier-view">
        <AdvancedToggle />
      </div>
      <SubTabs tabs={tabs} ns="tier-list" />
    </AdvancedProvider>
  );
}
