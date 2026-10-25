// What each champion archetype tag looks like and means (built by lib/champion-tags.ts), safe for the browser.

export type TagKind = "class" | "sub" | "play";
export type TagInfo = Record<string, { color: string; meaning: string; kind: TagKind }>;

/** The tags in a set, grouped by kind in display order. */
export function tagsByKind(info: TagInfo): Record<TagKind, string[]> {
  const out: Record<TagKind, string[]> = { class: [], sub: [], play: [] };
  for (const [name, t] of Object.entries(info)) out[t.kind].push(name);
  return out;
}

/** A tag chip's colour as CSS variables: the colour, plus "r g b" for browsers without color-mix(). */
export function tagStyle(color: string): React.CSSProperties {
  const n = parseInt(color.slice(1), 16);
  const rgb = /^#[0-9a-f]{6}$/i.test(color) ? `${n >> 16} ${(n >> 8) & 255} ${n & 255}` : undefined;
  return { "--tag": color, "--tag-rgb": rgb } as React.CSSProperties;
}
