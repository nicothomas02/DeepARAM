// Before `next build` (npm prebuild/predev, run with vite-node so the site's own modules load outside Next): writes the
// owner view's numbers (lib/owner-points.ts) to src/generated/owner-points.json. That folder is gitignored and is not
// served as a file; /api/owner/points bundles it and hands it out only to the signed-in owner.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerPoints } from "../src/lib/owner-points";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "generated", "owner-points.json");
mkdirSync(dirname(out), { recursive: true });
const data = ownerPoints();
writeFileSync(out, JSON.stringify(data));
console.log(`owner-points: ${Object.keys(data.champions).length} champions, ${Object.keys(data.tierList).length} augments -> src/generated`);
