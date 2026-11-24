// After `next build`: copies the prerendered /data/*.json feeds into public/data/ so Cloudflare serves them as
// static assets, without running the Worker. overlay.json (1.1 MB, both apps' builds) was hitting the Worker's
// CPU limit (Error 1102, 2026-11-24) even as a cache hit. `--clean` (prebuild) removes the copies first, so
// `next build` never sees a public file next to a route of the same path. Headers: public/_headers.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(web, "public", "data");
const built = join(web, ".next", "server", "app", "data");

rmSync(out, { recursive: true, force: true });
if (!process.argv.includes("--clean")) {
  const files = existsSync(built) ? readdirSync(built).filter((f) => f.endsWith(".json.body")) : [];
  mkdirSync(out, { recursive: true });
  for (const f of files) copyFileSync(join(built, f), join(out, f.slice(0, -".body".length)));
  console.log(`static-data: ${files.length} feeds -> public/data`);
}
