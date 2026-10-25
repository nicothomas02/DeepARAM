"use client";

import { loadSettings, saveSettings, SETTINGS_EVENT, type Settings } from "./settings";

// Keeps a signed-in visitor's settings the same on every browser. On each visit the saved copy replaces
// this browser's; the first time an account is used here the two are merged (the account's settings over
// this browser's). Changes are sent back a moment after they're made.

export const ACCOUNT_EVENT = "deeparam-account";
const MERGED_KEY = "deeparam-account-merged"; // which account this browser has already merged with

export const signedIn = () => typeof document !== "undefined" && /(?:^|;\s*)deeparam-signed-in=1/.test(document.cookie);

type Saved = { settings: Partial<Settings> };

let applying = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function push() {
  if (applying || !signedIn()) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    void fetch("/api/account", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: loadSettings() }),
      keepalive: true,
    }).catch(() => {});
  }, 1500);
}

function apply(data: Saved) {
  applying = true;
  try {
    const s = loadSettings();
    if (Object.entries(data.settings).some(([k, v]) => s[k as keyof Settings] !== v)) saveSettings(data.settings);
  } finally {
    applying = false;
  }
}

/** Brings this browser in step with the signed-in account; call after signing in and on each visit. */
export async function syncAccount(): Promise<void> {
  if (!signedIn()) return;
  const res = await fetch("/api/account", { cache: "no-store" }).catch(() => null);
  const a = res?.ok ? ((await res.json().catch(() => null)) as ({ signedIn: boolean; id: string; data: Saved } | null)) : null;
  if (!a?.signedIn) {
    window.dispatchEvent(new Event(ACCOUNT_EVENT)); // the session ended; the server cleared the cookies
    return;
  }
  let merged: string | null = null;
  try {
    merged = localStorage.getItem(MERGED_KEY);
  } catch {}
  if (merged !== a.id) {
    apply({ settings: { ...loadSettings(), ...a.data.settings } });
    try {
      localStorage.setItem(MERGED_KEY, a.id);
    } catch {}
    push();
  } else {
    apply(a.data);
  }
  if (!listening) {
    listening = true;
    addEventListener(SETTINGS_EVENT, push);
  }
}

/** After signing out: this browser keeps its copy, but merges again next time an account signs in. */
export function forgetAccount() {
  try {
    localStorage.removeItem(MERGED_KEY);
  } catch {}
  window.dispatchEvent(new Event(ACCOUNT_EVENT));
}
