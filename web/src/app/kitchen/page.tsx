import type { Metadata } from "next";
import BuildChecks from "@/components/BuildChecks";
import Embed from "@/components/Embed";
import Intro from "@/components/Intro";
import NeedsScript from "@/components/NeedsScript";
import SubTabs from "@/components/SubTabs";
import { T } from "@/components/I18n";
import ToolPage, { toolMetadata } from "@/components/ToolPage";
import { checks } from "@/lib/checks";
import { repoHas } from "@/lib/repo-data";
import { discoverToolTabs } from "@/lib/tabs";

// The Kitchen: the daily Chef Special and its archive (/kitchen#chefs-special-YYYY-MM-DD), Infinite Ryze
// (/kitchen?tab=infinite-ryze), Traps (?tab=traps: builds that work on paper but not in real games) and the Bug
// finder (?tab=bug-finder: interactions that might be broken, to test in game). Formerly The Lab.
export const metadata: Metadata = toolMetadata("/kitchen");

export default function KitchenPage() {
  const tab = discoverToolTabs().find((t) => t.href === "/kitchen");
  if (!tab || !repoHas("tools/fun/ryze-calculator/index.html")) return <ToolPage href="/kitchen" />;
  const found = checks();
  return (
    <>
      <Intro title={<T ns="tool-pages">{tab.label}</T>}>{tab.body && <T ns="tool-pages">{tab.body}</T>}</Intro>
      <NeedsScript />
      <SubTabs
        ns="tool-pages"
        tabs={[
          { id: "chef-specials", label: "Chef Specials", content: <Embed src={`/embed/${tab.slug}/${tab.entry}`} title={tab.label} ownTitle /> },
          {
            id: "infinite-ryze",
            label: "Infinite Ryze",
            lazy: true,
            content: <Embed src="/embed/fun/ryze-calculator/index.html" title="Infinite Ryze" minHeight={900} />,
          },
          { id: "traps", label: "Traps", content: <BuildChecks mode="traps" findings={found.traps} /> },
          { id: "bug-finder", label: "Bug finder", content: <BuildChecks mode="bugs" findings={found.bugs} /> },
        ]}
      />
    </>
  );
}
