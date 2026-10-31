// Keeps a page's view in its address (?tab=, ?q=, ?sort=, ?patches=) so a copied link opens the same view.
// replaceState: changing a filter doesn't add a Back step. Switching tabs does ({ push: true }), so Back returns
// to the tab before.
//
// Pages in REMEMBERED also save their last view (minus the search box) in this browser, so going back
// to the page reopens it the way it was left: VIEW_SCRIPT restores it on a full page load and
// ViewMemory on links within the site. Off with Settings > Remember my views.

export const REMEMBERED = ["/tier-list"];
const VIEW_KEY = "deeparam-view:";

const remembering = () => {
  try {
    return JSON.parse(localStorage.getItem("deeparam-settings") || "{}").remember !== false;
  } catch {
    return false;
  }
};

export function setParams(values: Record<string, string | null>, { push = false } = {}) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = url.pathname + url.search + url.hash;
  if (push && next !== location.pathname + location.search + location.hash) history.pushState(history.state, "", next);
  else history.replaceState(history.state, "", next);
  if (REMEMBERED.includes(url.pathname) && remembering()) {
    url.searchParams.delete("q");
    try {
      localStorage.setItem(VIEW_KEY + url.pathname, url.search);
    } catch {}
  }
}

export const getParam = (key: string) => new URLSearchParams(location.search).get(key);

/** The saved view of a remembered page ("?tab=augments&sort=…"), or "". */
export function savedView(path: string) {
  if (!REMEMBERED.includes(path) || !remembering()) return "";
  try {
    return localStorage.getItem(VIEW_KEY + path) || "";
  } catch {
    return "";
  }
}

export function forgetViews() {
  try {
    for (const p of REMEMBERED) localStorage.removeItem(VIEW_KEY + p);
    localStorage.removeItem("deeparam-view-advanced");
  } catch {}
}

/** Inline before-hydration script: a bare remembered address reopens its saved view. */
export const VIEW_SCRIPT = `try{var p=location.pathname;if(!location.search&&${JSON.stringify(REMEMBERED)}.indexOf(p)>=0&&JSON.parse(localStorage.getItem("deeparam-settings")||"{}").remember!==false){var v=localStorage.getItem(${JSON.stringify(VIEW_KEY)}+p);if(v&&v.charAt(0)==="?")history.replaceState(history.state,"",p+v+location.hash)}}catch(e){}`;
