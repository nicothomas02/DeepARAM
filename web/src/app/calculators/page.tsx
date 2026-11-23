import type { Metadata } from "next";
import Embed from "@/components/Embed";
import Intro from "@/components/Intro";
import NeedsScript from "@/components/NeedsScript";
import SubTabs from "@/components/SubTabs";
import { T } from "@/components/I18n";
import { pageMeta } from "@/lib/meta";
import { repoHas } from "@/lib/repo-data";
import { sections } from "@/lib/sections";

// Calculators: Infinite Ryze (?tab=infinite-ryze, formerly a Kitchen and before that a Simulator tab) and
// Infinite Ashe (?tab=infinite-ashe). Both pages live in tools/fun/ and share The Kitchen's embed folder.
const tab = sections.find((s) => s.href === "/calculators")!;

export const metadata: Metadata = pageMeta("/calculators", "ARAM Mayhem Calculators", tab.body);

const CALCULATORS = [
  { id: "infinite-ryze", label: "Infinite Ryze", folder: "ryze-calculator", minHeight: 900 },
  { id: "infinite-ashe", label: "Infinite Ashe", folder: "ashe-calculator", minHeight: 1100 },
];

export default function CalculatorsPage() {
  const ready = CALCULATORS.filter((c) => repoHas(`tools/fun/${c.folder}/index.html`));
  return (
    <>
      <Intro title={<T ns="tool-pages">{tab.label}</T>}>
        <T ns="tool-pages">{tab.body}</T>
      </Intro>
      <NeedsScript />
      <SubTabs
        ns="tool-pages"
        tabs={ready.map((c, i) => ({
          id: c.id,
          label: c.label,
          lazy: i > 0,
          content: <Embed src={`/embed/fun/${c.folder}/index.html`} title={c.label} minHeight={c.minHeight} />,
        }))}
      />
    </>
  );
}
