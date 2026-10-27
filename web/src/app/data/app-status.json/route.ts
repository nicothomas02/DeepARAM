import { livePatch } from "@/lib/highlights";
import { patchName } from "@/lib/patch-name";
import { readRepoJson } from "@/lib/repo-data";

// What the desktop and mobile apps poll to notice a new live patch or test server build. Built once per deploy.
export const dynamic = "force-static";

type PbeMeta = { meta?: { dataAsOf?: string; builds?: { pbe?: string } } };

export function GET() {
  const pbe = readRepoJson<PbeMeta>("data/pbe/kiwi-s3.json")?.meta;
  const live = livePatch();
  return Response.json({
    // As the site names it ("26.21"), which is what the apps show and compare against.
    livePatch: live ? patchName(live) : null,
    pbeBuild: pbe?.builds?.pbe ?? null,
    pbeUpdated: pbe?.dataAsOf ?? null,
  });
}
