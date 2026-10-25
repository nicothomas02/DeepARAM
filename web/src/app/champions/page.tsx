import type { Metadata } from "next";
import RowLink from "@/components/RowLink";
import ChampionRedirect from "@/components/ChampionRedirect";
import { Name, T } from "@/components/I18n";
import Intro from "@/components/Intro";
import { Breadcrumbs } from "@/components/JsonLd";
import { championAliases, champList } from "@/lib/champions";
import { livePatch, liveTiers } from "@/lib/highlights";
import { pageMeta } from "@/lib/meta";
import "./champions.css";
import { patchName } from "@/lib/patch-name";

export const metadata: Metadata = pageMeta(
  "/champions",
  "ARAM Mayhem Champions A to Z",
  "Every League of Legends champion in ARAM Mayhem, A to Z, with their tier on the current patch. Open one for its build, augments and teammates.",
);

// Every champion page, linked from one place, so each can be found from the footer and by search engines.
// Old /champions#Ahri links still forward to that champion's page.
export default function Page() {
  const tiers = new Map(liveTiers().map((c) => [c.id, c.tier]));
  return (
    <>
      <Breadcrumbs trail={[["Champions", "/champions"]]} />
      <ChampionRedirect aliases={championAliases()} />
      <Intro eyebrow={<T>Champions</T>} title={<T ns="champions">Every Mayhem champion, A to Z.</T>}>
        <T ns="champions" v={{ patch: patchName(livePatch()) }}>
          {"Tiers are for patch {patch}. Open a champion for their build, augments and best teammates."}
        </T>
      </Intro>
      <ul className="champ-index">
        {champList().map((c) => (
          <li key={c.id}>
            <RowLink href={`/champions/${c.id}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/icons/champions/${c.id}.webp`} alt="" width={40} height={40} loading="lazy" />
              <span className="champ-index-name">
                <Name kind="champions" id={c.id}>
                  {c.name}
                </Name>
              </span>
              {tiers.has(c.id) && <span className="champ-index-tier" data-tier={tiers.get(c.id)}>{tiers.get(c.id)}</span>}
            </RowLink>
          </li>
        ))}
      </ul>
    </>
  );
}
