import type { Metadata } from "next";
import Embed from "@/components/Embed";
import Intro from "@/components/Intro";
import NeedsScript from "@/components/NeedsScript";
import { pageMeta } from "@/lib/meta";
import { T } from "./I18n";

// One of The Kitchen folder's tools on a page of its own (tools/fun/<folder>/index.html), under the tab
// it belongs to: Region Teams under Info.

export type FunTool = {
  path: string;
  folder: string;
  eyebrow: string;
  title: string;
  description: string;
};

export const funToolMetadata = (t: FunTool): Metadata => pageMeta(t.path, t.title, t.description);

export default function FunToolPage({ tool }: { tool: FunTool }) {
  return (
    <>
      <Intro eyebrow={<T ns="tool-pages">{tool.eyebrow}</T>} title={<T ns="tool-pages">{tool.title}</T>}>
        <T ns="tool-pages">{tool.description}</T>
      </Intro>
      <NeedsScript />
      <Embed src={`/embed/fun/${tool.folder}/index.html`} title={tool.title} ownTitle />
    </>
  );
}
