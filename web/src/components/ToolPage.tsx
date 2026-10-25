import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Embed from "@/components/Embed";
import Intro from "@/components/Intro";
import NeedsScript from "./NeedsScript";
import { pageMeta } from "@/lib/meta";
import { discoverToolTabs } from "@/lib/tabs";
import { T } from "./I18n";

// A tab whose page is another folder's static site (a site-tab.json folder), found by its URL.

// Titles for search results, where the tab's short label alone says little.
const SEARCH_TITLES: Record<string, string> = {
  "/info": "How ARAM Mayhem Works: Rules, Quests & Augments",
  "/kitchen": "The Kitchen: Off-Meta ARAM Mayhem Builds",
};

export const toolMetadata = (href: string): Metadata => {
  const tab = discoverToolTabs().find((t) => t.href === href);
  return tab ? pageMeta(href, SEARCH_TITLES[href] ?? tab.label, tab.body || `${tab.label} for ARAM Mayhem.`) : { title: "DeepARAM" };
};

export default function ToolPage({ href }: { href: string }) {
  const tab = discoverToolTabs().find((t) => t.href === href);
  if (!tab) notFound();
  return (
    <>
      {/* The tab's name as the headline; its longer description sits under it. */}
      <Intro title={<T ns="tool-pages">{tab.label}</T>} art={href === "/info" ? "habackground" : undefined}>
        {tab.body && <T ns="tool-pages">{tab.body}</T>}
      </Intro>
      <NeedsScript />
      <Embed src={`/embed/${tab.slug}/${tab.entry}`} title={tab.label} ownTitle />
    </>
  );
}
