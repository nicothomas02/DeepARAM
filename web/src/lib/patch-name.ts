// The game files and stats number patches by client version (16.20); Riot's patch notes and players
// call the same patch 26.20 (the year). Data stays keyed by the client version; everything a visitor
// reads, and patch page URLs, use Riot's public number.
const VERSION = /^(\d+)\.(\d+)$/;

// "16.20" -> "26.20", "15.24" -> "25.24"; already-public numbers like "26.01" -> "26.1".
export function patchName(patch: string | null | undefined): string {
  const m = VERSION.exec(patch ?? "");
  if (!m) return patch ?? "";
  const major = Number(m[1]);
  return `${major >= 10 && major < 20 ? major + 10 : major}.${Number(m[2])}`;
}

// The other way, for patch page URLs: "26.20" -> "16.20". Client versions pass through.
export function patchVersion(name: string): string {
  const m = VERSION.exec(name);
  if (!m) return name;
  const major = Number(m[1]);
  return `${major >= 20 && major < 30 ? major - 10 : major}.${Number(m[2])}`;
}
