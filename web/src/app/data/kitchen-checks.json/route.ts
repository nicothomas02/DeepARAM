// Kitchen builds that may not come together in a real game, for the Chef Specials page (tools/fun/cook-builds/app.js):
// per build, the augments the champion has never been seen taking, can't be offered (melee or ranged only) or that
// left Mayhem. data/checks/findings.py works them out daily. Augments with no stats yet aren't counted: no stats
// isn't proof either way. Built once per deploy.
import { readRepoJson } from "@/lib/repo-data";

export const dynamic = "force-static";

type Problem = { build?: string; kind?: string; augment?: string; augments?: number[]; why?: string; test?: string };

export function GET() {
  const builds: Record<string, { augments: { id: number | null; name: string }[] }> = {};
  for (const p of readRepoJson<{ kitchen?: Problem[] }>("data/checks/findings.json")?.kitchen ?? []) {
    if (p.kind !== "pool" || !p.build || !p.augment) continue;
    const why = p.why ?? (p.test?.startsWith("There are no stats") ? "no_data" : "unseen");
    if (why === "no_data") continue;
    (builds[p.build] ??= { augments: [] }).augments.push({ id: p.augments?.[0] ?? null, name: p.augment });
  }
  return Response.json({ builds });
}
