import FunToolPage, { funToolMetadata, type FunTool } from "@/components/FunToolPage";

const TOOL: FunTool = {
  path: "/info/region-teams",
  folder: "region-teams",
  eyebrow: "About",
  title: "Region Teams",
  description: "The strongest ARAM Mayhem team from each region of Runeterra.",
};

export const metadata = funToolMetadata(TOOL);

export default function Page() {
  return <FunToolPage tool={TOOL} />;
}
