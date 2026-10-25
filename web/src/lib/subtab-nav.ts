// Moves to the next or previous in-page tab (SubTabs); else follows the page's own next/previous link
// (a[data-swipe="next"|"prev"], like the next champion on a champion page); else the neighbouring
// bottom-bar tab. Shared by phone swipes (SwipeGestures) and the [ and ] keys (KeyboardShortcuts).
import { buzz } from "./haptics";

export function switchTab(dir: 1 | -1) {
  const list = document.querySelector<HTMLElement>("main .subtab-list");
  if (list && list.offsetParent) {
    const tabs = [...list.querySelectorAll<HTMLButtonElement>("[role='tab']")];
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const next = tabs[i + dir];
    if (next) {
      next.click();
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    return;
  }
  const step = document.querySelector<HTMLAnchorElement>(`main a[data-swipe="${dir > 0 ? "next" : "prev"}"]`);
  if (step) {
    buzz("step");
    step.click();
    return;
  }
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".tabbar a")];
  const i = links.findIndex((a) => a.getAttribute("aria-current") === "page");
  const next = i >= 0 ? links[i + dir] : undefined;
  if (next) {
    buzz("step");
    next.click();
  }
}
