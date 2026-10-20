import Link from "next/link";
import rivalQuests from "@/data/rival-quests.json";
import { T } from "@/components/I18n";
import QuestWhen from "./QuestWhen";
import { Panel } from "./Ranked";

// Mayhem's champion quests (scripts/fetch_rival_quests.py): a rival on the other team, or a partner on yours,
// gives this champion a goal and a reward for the rest of the game. The texts are the game's own, in every language.

type Quest = { champion: string; partner: string; side: string; name: string; goal?: string; reward?: string; rewardText?: string };
const QUESTS = rivalQuests as Quest[];

export const questsFor = (alias: string) => QUESTS.filter((q) => q.champion === alias);
export const questPairs = (side: "ally" | "enemy") => QUESTS.filter((q) => q.side === side);

export default function Quests({ alias, names }: { alias: string; names: Record<string, string> }) {
  const quests = questsFor(alias);
  if (!quests.length) return null;
  return (
    <Panel id="quests" title={quests.some((q) => q.side === "enemy") ? "Rival quest" : "Team quest"}>
      {quests.map((q) => (
        <div key={q.partner} className="cp-quest">
          <Link className="cp-link" href={`/champions/${q.partner}`}>
            <img className="cp-icon" src={`/icons/champions/${q.partner}.webp`} alt="" width={36} height={36} loading="lazy" />
            <span className="cp-name">
              <strong>
                <T ns="quests">{q.name}</T>
              </strong>
              <small>
                <QuestWhen partner={q.partner} name={names[q.partner] ?? q.partner} enemy={q.side === "enemy"} />
              </small>
            </span>
          </Link>
          {q.goal && (
            <p>
              <T ns="quests">{q.goal}</T>
            </p>
          )}
          {q.reward && q.rewardText && (
            <p className="cp-quest-reward">
              <strong>
                <T ns="quests">{q.reward}</T>
              </strong>{" "}
              <T ns="quests">{q.rewardText}</T>
            </p>
          )}
        </div>
      ))}
    </Panel>
  );
}
