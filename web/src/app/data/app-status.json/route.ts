// What the apps check for new-patch alerts: the live patch (as the site names it) and the current PBE build.
// Shape is decoded by SiteStatus in apps/shared/DeepARAMKit/Sources/DeepARAMKit/PatchWatcher.swift.
import { livePatch } from "@/lib/highlights";
import { patchName } from "@/lib/patch-name";
import { readRepoJson } from "@/lib/repo-data";

export const dynamic = "force-static";

export function GET() {
  const pbe = readRepoJson<{ builds?: { pbe?: string }; dataAsOf?: string }>("data/pbe/tracker.json");
  const live = livePatch();
  return Response.json({
    livePatch: live ? patchName(live) : null,
    pbeBuild: pbe?.builds?.pbe ?? null,
    pbeUpdated: pbe?.dataAsOf ?? null,
  });
}
