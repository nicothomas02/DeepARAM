import type { Metadata } from "next";
import Embed from "@/components/Embed";
import Intro from "@/components/Intro";
import NeedsScript from "@/components/NeedsScript";
import SubTabs from "@/components/SubTabs";
import { T } from "@/components/I18n";
import ToolPage, { toolMetadata } from "@/components/ToolPage";
import { repoHas } from "@/lib/repo-data";
import { discoverToolTabs } from "@/lib/tabs";

// The Kitchen: the daily Chef Special and its archive (/kitchen#chefs-special-YYYY-MM-DD), plus Infinite Ryze
// (/kitchen?tab=infinite-ryze). Formerly The Lab.
export const metadata: Metadata = toolMetadata("/kitchen");

export default function KitchenPage() {
  const tab = discoverToolTabs().find((t) => t.href === "/kitchen");
  if (!tab || !repoHas("tools/fun/ryze-calculator/index.html")) return <ToolPage href="/kitchen" />;
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
        ]}
      />
    </>
  );
}
