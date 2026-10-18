// Sends a browser-side error to /api/log, where it lands in the server logs. At most a few per page
// view, and repeats of the same message are dropped, so one broken loop can't flood the logs.
const MAX = 5;
const seen = new Set<string>();
// Harmless browser messages that say nothing about the site: a resize settling over two frames, a page
// transition skipped because the tab was hidden or another started, and cross-site errors with no details.
const NOISE = /^ResizeObserver loop|^Skipping view transition|^Script error\.?$/;

export function reportError(message: string, extra: { source?: string; line?: number; col?: number; stack?: string } = {}) {
  if (typeof window === "undefined" || NOISE.test(message) || seen.size >= MAX || seen.has(message)) return;
  seen.add(message);
  const body = JSON.stringify({ message, ...extra, page: location.pathname + location.search, ua: navigator.userAgent });
  try {
    if (!navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }))) {
      fetch("/api/log", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
    }
  } catch {
    // Reporting must never break the page.
  }
}
