// Shared by the header's theme switch and the layout's before-paint script.
export const THEME_KEY = "deeparam-theme";
export const THEME_COLORS = { light: "#dce1e7", dark: "#090b0f" };
export const THEME_EVENT = "deeparam-theme";

const ORIGINAL = new WeakMap<CSSMediaRule, string>();

/** Makes a same-origin page's prefers-color-scheme rules follow the site's Light / Dark choice
 *  (embedded tools style themselves with those media queries, which only see the system setting). */
export function themeDocument(doc: Document, theme: string | undefined) {
  doc.documentElement.dataset.theme = theme ?? "";
  if (!theme) delete doc.documentElement.dataset.theme;
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof (doc.defaultView?.CSSMediaRule ?? CSSMediaRule))) continue;
      const media = rule as CSSMediaRule;
      const orig = ORIGINAL.get(media) ?? media.media.mediaText;
      if (/prefers-color-scheme/.test(orig)) {
        ORIGINAL.set(media, orig);
        const text = theme ? orig.replace(/\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)/g, (_, s) => (s === theme ? "(min-width: 0px)" : "(max-width: -1px)")) : orig;
        if (media.media.mediaText !== text) media.media.mediaText = text;
      }
      walk(media.cssRules);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {} // a cross-origin stylesheet (fonts) can't be read; it has no theme rules anyway
  }
  doc.querySelectorAll("iframe").forEach((f) => {
    try {
      if (f.contentDocument) themeDocument(f.contentDocument, theme);
    } catch {}
  });
}
