import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { livePatch } from "@/lib/highlights";
import augmentNames from "@/data/augment-names.json";
import { AdvancedProvider } from "@/components/Advanced";
import ChampionTiers from "@/components/ChampionTiers";
import ChampionsPanel from "@/components/ChampionsPanel";
import DuosTable from "@/components/DuosTable";
import { questPairs } from "@/components/champion/Quests";
import { archetypeRows, duoVersion, hasDuos } from "@/lib/duos";
import { augmentHref, augmentPages } from "@/lib/augments";
import { augmentTiers, STYLES } from "@/lib/augment-tiers";
import AugmentTiers from "@/components/AugmentTiers";
import { augmentRows, type RawAugment } from "@/lib/augment-winrate";
import { AUGMENT_DEEPSCORE_HELP } from "@/lib/deepscore";
import championIds from "@/data/champion-ids.json";
import championNames from "@/data/champion-names.json";
import type { PatchRow } from "@/lib/tiers";
import Intro from "@/components/Intro";
import { T } from "@/components/I18n";
import HowRankings from "@/components/HowRankings";
import ItemIndex from "@/components/ItemIndex";
import { augmentSpread, championAugmentReliance, itemEstimate, powerCurveLists } from "@/lib/estimates";
import { itemPages } from "@/lib/item-pages";
import { text } from "@/lib/content";
import Pending from "@/components/Pending";
import SubTabs from "@/components/SubTabs";
import { readRepoCsv, readRepoJson } from "@/lib/repo-data";
import { allChampionTags, championTagData } from "@/lib/champion-tags";
import { fillGames } from "@/lib/fill";
import { patchName } from "@/lib/patch-name";
import WeaponOfDestiny from "@/components/WeaponOfDestiny";
import { weaponOfDestiny } from "@/lib/weapon-of-destiny";

export const metadata: Metadata = pageMeta(
  "/tier-list",
  `ARAM Mayhem Tier List${livePatch() ? `, Patch ${patchName(livePatch())}` : ""}`,
  "ARAM Mayhem champion tier list for the current patch, with augment win rates and duo synergy.",
);

const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));
const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([alias, id]) => [id, alias]));
const NAMES = championNames as Record<string, string>;
const names = augmentNames as Record<string, string>;

// Each team quest pair once (Jinx and Ekko), for a note under the Duos list.
const teamQuests = (): [string, string, string][] =>
  questPairs("ally").flatMap((q) => (q.champion < q.partner ? [[q.champion, q.partner, q.name] as [string, string, string]] : []));

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
        <ChampionsPanel
          solo={
            <ChampionTiers
              rows={rows}
              patches={patches.map((p) => p.patch)}
              tags={allChampionTags([...new Set(rows.map((r) => r.name))])}
              tagInfo={championTagData().info}
              games={fillGames()}
              scaling={Object.fromEntries([...powerCurveLists().scaling].flatMap(([id, v]) => (ALIAS[id] ? [[ALIAS[id], v]] : [])))}
              reliance={Object.fromEntries([...championAugmentReliance()].flatMap(([id, v]) => (ALIAS[id] ? [[ALIAS[id], v]] : [])))}
            />
          }
          duos={duos ? <DuosTable archetypes={archetypeRows()} tagInfo={championTagData().info} version={duoVersion()} quests={teamQuests()} /> : undefined}
        />
      ),
    },
  ];
  if (augments.length) {
    const graded = new Map(augmentTiers().map((a) => [a.id, a]));
    const augName = (a: Record<string, unknown>) => names[String(a.augment_id)] ?? String(a.key).replace(/^ARAM_/, "");
    const bestById = new Map(augmentPages().map((p) => [p.id, p.best]));
    const augCols = [
      { key: "grade", label: "Tier", format: "tier" as const, sortKey: "deepScore", hint: AUGMENT_DEEPSCORE_HELP },
      { key: "name", label: "Augment", format: "augment" as const, iconKey: "id", hrefKey: "href" },
      { key: "deepScore", label: "DeepScore", format: "deepscore" as const, hint: AUGMENT_DEEPSCORE_HELP },
      { key: "tier", label: "Rarity", format: "tier" as const, phone: "hide" as const },
      { key: "win_rate", label: "Win rate", format: "pct" as const },
      { key: "pick_rate", label: "Pick rate", format: "pct" as const, phone: "hide" as const },
    ];
    tabs.push({
      id: "augments",
      label: "Augments",
      content: (
        <>
          <AugmentTiers
            styles={STYLES}
            columns={augCols}
            // Most useful on the left: rank, win rate and its boost, pick rate, then the finer numbers.
            advancedColumns={[
              ...augCols.slice(0, 3),
              augCols[4],
              {
                key: "lift",
                label: "Win rate boost",
                format: "pts" as const,
                hint: "Win rate minus what the champions who take it win anyway. Above zero means it helps them.",
              },
              {
                key: "spread",
                label: "Varies by champion",
                format: "spread" as const,
                hint: "Estimated. How far its win rate boost swings from one champion to another. High means great on some champions and weak on others.",
              },
              augCols[5],
              { key: "best", label: "Best champ", format: "champion-icon", sortable: false, hint: "The champion with the highest estimated win rate boost from this augment." },
              augCols[3],
            ]}
            rows={augments
              .filter((a) => names[String(a.augment_id)] || a.key)
              .map((a) => ({
                id: Number(a.augment_id),
                href: augmentHref(Number(a.augment_id)),
                name: augName(a),
                tier: String(a.tier ?? ""),
                styles: (graded.get(Number(a.augment_id))?.styles ?? []).join(","),
                grade: graded.get(Number(a.augment_id))?.tier ?? null,
                deepScore: graded.get(Number(a.augment_id))?.deepScore ?? null,
                lift: graded.get(Number(a.augment_id))?.lift ?? null,
                spread: augmentSpread(Number(a.augment_id)),
                win_rate: Number(a.win_rate),
                pick_rate: Number(a.pick_rate),
                best: bestById.get(Number(a.augment_id))?.[0]?.id ?? null,
              }))}
            note={
              <p className="patch-note">
                <T ns="tier-list" v={{ patch: patchName(latest.patch) }}>
                  {
                    "Live patch {patch}. Each augment gets a DeepScore against the others of its rarity: 50 is average, S is 70 and up, A 59, B 44, C 32 and D below."
                  }
                </T>
              </p>
            }
          />
        </>
      ),
    });
  }
  // Formerly the Items page (/items redirects here); each item keeps its own page at /items/<slug>.
  const items = itemPages().map(({ id, slug, name, icon, cost, tags, popularity, tier, deepScore }) => {
    const est = itemEstimate(id);
    return {
      id,
      slug,
      name,
      icon,
      cost,
      tags,
      popularity,
      tier,
      deepScore,
      winRate: est?.winRate ?? null,
      buildShare: est?.buildShare ?? null,
      granted: est?.granted ?? false,
    };
  });
  if (items.length) {
    tabs.push({
      id: "items",
      label: "Items",
      lazy: true,
      content: (
        <>
          <p className="patch-note subtab-note">
            <T ns="items">
              Pick tags to narrow the list: every tag you pick has to match. Open an item for its stats, who builds it and how much damage it adds in the
              Simulator.
            </T>
          </p>
          <ItemIndex items={items} />
        </>
      ),
    });
  }

  // Which Legendary item to make the Weapon of Destiny (gold augment): how often it's upgraded and how rare its stats are.
  const destiny = weaponOfDestiny();
  if (destiny?.rows.length) {
    tabs.push({
      id: "weapon-of-destiny",
      label: "Weapon of Destiny",
      lazy: true,
      content: <WeaponOfDestiny items={destiny.rows} gold={destiny.gold} anticipated={destiny.anticipated} />,
    });
  }

  return (
    <AdvancedProvider>
      <Intro
        art="arambilgewater"
        eyebrow={
          <T ns="tier-list" v={{ patch: patchName(latest.patch) }}>
            {"Tier List · Patch {patch}"}
          </T>
        }
        title={<T ns="tier-list">{text("page./tier-list.title", "Every Mayhem champion and augment, ranked.")}</T>}
      >
        <T ns="tier-list" v={{ patch: patchName(latest.patch) }}>
          {"Live patch {patch} by default. Pick any patches, or all time, above the champion table."}
        </T>
      </Intro>
      <HowRankings />
      <SubTabs tabs={tabs} ns="tier-list" />
    </AdvancedProvider>
  );
}
