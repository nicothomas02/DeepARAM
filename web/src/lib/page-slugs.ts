import championNames from "@/data/champion-names.json";
import { foldName } from "./fold";

// Champion, item and augment pages only exist at their exact address (/champions/Ahri, /augments/titans-resolve),
// so a typed or shared link like /champions/ahri, /champions/wukong or /augments/Titans-Resolve would land on the
// not-found page. The middleware sends those to the real page instead.

const NAMES = championNames as Record<string, string>;
const CHAMPIONS = new Map<string, string>();
for (const [alias, name] of Object.entries(NAMES)) {
  CHAMPIONS.set(foldName(alias), alias);
  CHAMPIONS.set(foldName(name), alias);
}

/** The page a near-miss address means, or null when it is already right (or nothing matches). */
export function canonicalPath(pathname: string): string | null {
  const m = pathname.match(/^\/(champions|items|augments)\/([^/]+)\/?$/);
  if (!m) return null;
  const [, section, raw] = m;
  let seg = raw;
  try {
    seg = decodeURIComponent(raw);
  } catch {}
  if (section === "champions") {
    if (Object.prototype.hasOwnProperty.call(NAMES, seg)) return null;
    const alias = CHAMPIONS.get(foldName(seg));
    return alias ? `/champions/${alias}` : null;
  }
  const lower = seg.toLowerCase();
  return lower !== seg ? `/${section}/${encodeURIComponent(lower)}` : null;
}
