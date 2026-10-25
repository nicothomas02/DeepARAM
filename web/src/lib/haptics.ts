import { loadSettings } from "./settings";
import { chime } from "./ui-sound";

// Short haptic taps for touch actions. On Android they vibrate; iPhones have no web vibration, so the
// DeepARAM app (user agent "DeepARAMApp/") plays them natively: it listens on the "deeparamHaptic"
// message handler, or for the "deeparam-haptic" window event ({detail: {kind}}). Off with the Haptics
// setting, and never on a mouse-driven screen. Each one also plays the matching interface sound when
// those are turned on (lib/ui-sound.ts).
//
// Kinds by meaning: tap (a button), step (a tab or choice), done (something finished), tick (a light
// click as a strip or slider snaps to its next stop), thud (something weighty, like a Prismatic augment)
// and win (a double buzz for a win in the Simulator).

const PATTERNS = { tap: 8, step: 12, done: [10, 40, 18], tick: 4, thud: 35, win: [20, 70, 20] } as const;
export type HapticKind = keyof typeof PATTERNS;
// The app knows tap, step and done; newer kinds go as `style` with the nearest of those as `kind`,
// so an app that doesn't know them yet still plays something close.
const APP_KIND: Record<HapticKind, "tap" | "step" | "done"> = { tap: "tap", step: "step", done: "done", tick: "step", thud: "tap", win: "done" };

type AppBridge = { webkit?: { messageHandlers?: { deeparamHaptic?: { postMessage: (m: unknown) => void } } } };

export const inApp = () => typeof navigator !== "undefined" && /DeepARAMApp\//.test(navigator.userAgent);
export const canVibrate = () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function" && matchMedia("(pointer: coarse)").matches;
/** Whether this device can feel haptics at all (the Haptics setting is only shown then). */
export const hapticsAvailable = () => inApp() || canVibrate();

let last = 0;
export function buzz(kind: HapticKind = "tap") {
  // A control with its own buzz also reaches the page-wide tap handler; one tap is enough.
  const now = performance.now();
  if (now - last < 60) return;
  last = now;
  chime(kind);
  if (!loadSettings().haptics) return;
  dispatchEvent(new CustomEvent("deeparam-haptic", { detail: { kind, appKind: APP_KIND[kind] } }));
  const app = (window as unknown as AppBridge).webkit?.messageHandlers?.deeparamHaptic;
  try {
    if (app) app.postMessage({ kind: APP_KIND[kind], style: kind });
    // Before the first tap the browser blocks vibration and logs an error (a buzz from a page load, not a touch).
    else if (canVibrate() && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(PATTERNS[kind] as number | number[]);
  } catch {}
}
