"use client";

import { useNames, useT } from "@/components/I18n";

// "When Viktor is on the other team", with the partner's name in the page's language (Quests.tsx).
export default function QuestWhen({ partner, name, enemy }: { partner: string; name: string; enemy: boolean }) {
  const t = useT("champions");
  const names = useNames();
  return <>{t(enemy ? "When {name} is on the other team" : "When {name} is on your team", { name: names("champions", partner, name) })}</>;
}
