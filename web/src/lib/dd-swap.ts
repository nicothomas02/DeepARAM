import "server-only";
import swap from "@/data/dd-swap.json";

// Where an image has an official Data Dragon version (champion icons and art, ability, item, summoner
// spell and rune icons), pages show that copy instead of the client file. scripts/fetch_assets.py writes
// the map and fetches the copies; sync-embeds.mjs applies the same map to the embedded pages.

const PATHS = (swap as { paths: Record<string, string> }).paths;

/** The official copy of a mirrored image, or the path unchanged when there is none. */
export function official(path: string): string;
export function official(path: string | undefined): string | undefined;
export function official(path?: string) {
  return path ? (PATHS[path] ?? path) : path;
}

/** The Data Dragon version the official copies come from. */
export const ddVersion = (swap as { version: string }).version;
