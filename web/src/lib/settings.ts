// Site settings from the header's gear menu, saved in this browser's localStorage.
// Same-origin embeds (the Simulator) read the same key; every change fires SETTINGS_EVENT
// on the page and is written before it fires, so a listener can just call loadSettings().
// The theme is kept separately (lib/theme.ts) because it must apply before paint.

export const SETTINGS_KEY = "deeparam-settings";
export const SETTINGS_EVENT = "deeparam-settings";

export type Settings = {
  /** "system" follows the OS setting; "reduce" turns animations and transitions off. */
  motion: "system" | "reduce";
  /** Champion pick quotes and Simulator sounds. */
  sound: boolean;
  /** Simulator rendering quality; "auto" lets it adapt to the device. */
  graphics: "auto" | "low" | "high";
  /** Soft clicks and chimes on taps and finished actions (needs sound on). */
  uiSound: boolean;
  /** Short vibrations on phone taps and swipes, where the phone supports them. */
  haptics: boolean;
  /** "high" strengthens muted text, borders and focus rings. */
  contrast: "standard" | "high";
  /** "colorblind" swaps green/red and the tier colours for a blue/orange set. */
  colors: "standard" | "colorblind";
  /** Base text size; everything sized in rem follows it. */
  text: "standard" | "large" | "larger";
  /** Reopen the Tier List the way it was left. */
  remember: boolean;
  /** The Tier List's starting patch range. */
  tierRange: "live" | "set" | "last3" | "all";
  /** "simple" hides fine print and expert controls site-wide (html[data-view]); "detailed" shows everything. */
  view: "simple" | "detailed";
};

export const DEFAULT_SETTINGS: Settings = { motion: "system", sound: true, uiSound: false, haptics: true, graphics: "auto", contrast: "standard", colors: "standard", remember: true, text: "standard", tierRange: "live", view: "simple" };

/** The values each choice setting can take; the on/off ones take a boolean. */
const CHOICES: { [K in keyof Settings as Settings[K] extends string ? K : never]: readonly Settings[K][] } = {
  motion: ["system", "reduce"],
  graphics: ["auto", "low", "high"],
  contrast: ["standard", "high"],
  colors: ["standard", "colorblind"],
  text: ["standard", "large", "larger"],
  tierRange: ["live", "set", "all"],
  view: ["simple", "detailed"],
};

/**
 * The known settings in `raw` whose values the site can use, nothing else. A hand-edited copy, or one saved by
 * another version of the site, can't then switch sound on with "off" or leave the gear menu with no option pressed.
 */
export function cleanSettings(raw: unknown): Partial<Settings> {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    // "last3" is the old name of the "set" range.
    const v = k === "tierRange" && r[k] === "last3" ? "set" : r[k];
    const ok = typeof def === "boolean" ? typeof v === "boolean" : (CHOICES[k as keyof typeof CHOICES] as readonly string[]).includes(v as string);
    if (ok) out[k] = v;
  }
  return out as Partial<Settings>;
}

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...cleanSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(patch: Partial<Settings>) {
  // The patch is cleaned too: an account's synced copy may predate a choice's current values.
  const next = { ...loadSettings(), ...cleanSettings(patch) };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {}
  applySettings(next);
  window.dispatchEvent(new Event(SETTINGS_EVENT));
  return next;
}

export function applySettings(s: Settings) {
  const root = document.documentElement;
  if (s.motion === "reduce") root.dataset.motion = "reduce";
  else delete root.dataset.motion;
  if (s.contrast === "high") root.dataset.contrast = "high";
  else delete root.dataset.contrast;
  if (s.colors === "colorblind") root.dataset.colors = "colorblind";
  else delete root.dataset.colors;
  if (s.text === "large" || s.text === "larger") root.dataset.text = s.text;
  else delete root.dataset.text;
  root.dataset.view = s.view === "detailed" ? "detailed" : "simple";
}

/** Inline before-paint script: applies reduced motion, contrast, colour, text size and page detail choices from saved settings. */
export const SETTINGS_SCRIPT = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||"{}"),d=document.documentElement.dataset;if(s.motion==="reduce")d.motion="reduce";if(s.contrast==="high")d.contrast="high";if(s.colors==="colorblind")d.colors="colorblind";if(s.text==="large"||s.text==="larger")d.text=s.text;d.view=s.view==="detailed"?"detailed":"simple"}catch(e){}`;
