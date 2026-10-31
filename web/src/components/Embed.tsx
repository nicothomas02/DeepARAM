"use client";

import { useEffect, useRef, useState } from "react";
import { THEME_EVENT, themeDocument } from "@/lib/theme";
import Skeleton from "@/components/Skeleton";
import { replayPip } from "@/lib/replay-pip";

// The site fills the window, so embedded pages' own width caps are lifted too.
const FULL_WIDTH = "body,main,.wrap{max-width:none!important}";
function fullWidth(doc: Document) {
  if (doc.getElementById("deeparam-full-width")) return;
  const style = doc.createElement("style");
  style.id = "deeparam-full-width";
  style.textContent = FULL_WIDTH;
  doc.head.append(style);
}

// Embedded pages take the site's look: its fonts (copied over, since @font-face doesn't cross
// frames), round corners, filled borderless cards without colour edges, numbers in the text face,
// and labels in sentence case instead of small spaced capitals.
const CARD = "--card:#f7f9fb";
const CARD_DARK = "--card:#141a23";
function siteLook(doc: Document) {
  if (doc.readyState !== "complete" || doc.getElementById("deeparam-look")) return;
  const faces: string[] = [];
  const fixes: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      // Font addresses can be relative to their stylesheet, so they're made absolute before moving into the frame.
      const base = sheet.href || location.href;
      const absUrl = (m: string, q: string, u: string) => (u.startsWith("data:") ? m : `url("${new URL(u, base).href}")`);
      for (const rule of Array.from(sheet.cssRules)) if (rule instanceof CSSFontFaceRule) faces.push(rule.cssText.replace(/url\((["']?)([^"')]+)\1\)/g, absUrl));
    } catch {} // a cross-origin stylesheet can't be read
  }
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof (doc.defaultView?.CSSStyleRule ?? CSSStyleRule)) {
        const r = rule as CSSStyleRule;
        const sel = r.selectorText;
        const css = r.style.cssText;
        // A card: a surface fill inside a line border (form controls keep theirs).
        if (/background[^;]*var\(--surface\)/.test(css) && /border[^;]*var\(--line\)/.test(css) && !/input|select|textarea|button|btn/i.test(sel))
          fixes.push(`${sel}{border-color:transparent;background:var(--card);box-shadow:none}`);
        // A thin colour edge along a card's top.
        if (/::before\s*$/.test(sel) && r.style.height === "3px") fixes.push(`${sel}{display:none}`);
        if (r.style.textTransform !== "uppercase" || /input/i.test(sel)) continue;
        // Small labels grow to a readable size once they lose their capitals.
        const px = parseFloat(r.style.fontSize);
        fixes.push(`${sel}{text-transform:none!important;letter-spacing:0!important${!(px >= 13) ? ";font-size:0.8125rem" : ""}}`);
      } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {}
  }
  const root = getComputedStyle(document.documentElement);
  const sans = `${root.getPropertyValue("--font-sans").trim() || "system-ui"}, system-ui, sans-serif`;
  const display = `${root.getPropertyValue("--font-display").trim() || "system-ui"}, ${sans}`;
  const style = doc.createElement("style");
  style.id = "deeparam-look";
  style.textContent = [
    ...faces,
    `:root{--sans:${sans};--display:${display};--mono:${sans};--r:24px;--r-sm:12px;${CARD}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${CARD_DARK}}}`,
    `:root[data-theme="dark"]{${CARD_DARK}}`,
    `html body{font-family:var(--sans);font-variant-numeric:tabular-nums}`,
    `html h1,html h2.display,html h2.section{font-family:var(--display)}`,
    `html .card::before,html main>section::before,html .tool::before{display:none}`,
    ...fixes,
  ].join("\n");
  doc.head.append(style);
}

// The page above already shows the tool's title and description, so its own header steps aside.
function hideHeader(doc: Document) {
  if (doc.getElementById("deeparam-no-header")) return;
  const style = doc.createElement("style");
  style.id = "deeparam-no-header";
  style.textContent = "body>main>header:first-child{display:none}";
  doc.head.append(style);
}

// The site's search keys (/, ⌘K, Ctrl+K) work inside embedded tools too: the key is handed to the
// page, where the header search listens for it.
function searchKeys(doc: Document) {
  if (doc.documentElement.dataset.searchKeys) return;
  doc.documentElement.dataset.searchKeys = "1";
  doc.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? "") || (e.target as HTMLElement)?.isContentEditable;
    const combo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
    if (!combo && (e.key !== "/" || typing)) return;
    e.preventDefault();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey }));
  });
}

// Same-origin iframe that grows to fit its page, so the embedded tool scrolls with the site.
export default function Embed({
  src,
  title,
  minHeight = 0,
  hash,
  ownTitle = false,
}: {
  src: string;
  title: string;
  minHeight?: number;
  /** Opens the tool at this #part instead of following the page's (a champion's own page). */
  hash?: string;
  /** The page shows the tool's title above it, so the tool's own header is hidden. */
  ownTitle?: boolean;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const [loaded, setLoaded] = useState(false);
  // Pass the page's #hash to the tool, so links to a tool can name what it opens.
  const [frameSrc, setFrameSrc] = useState(hash ? `${src}#${hash}` : src);
  useEffect(() => {
    if (hash) return;
    const sync = () => setFrameSrc(src + location.hash);
    sync();
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, [src, hash]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    const attach = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      if (doc.readyState === "complete" || doc.body.childElementCount) setLoaded(true);
      siteLook(doc);
      themeDocument(doc, document.documentElement.dataset.theme);
      fullWidth(doc);
      if (ownTitle) hideHeader(doc);
      searchKeys(doc);
      replayPip(doc);
      const fit = () =>
        setHeight(Math.max(minHeight, doc.documentElement.scrollHeight));
      fit();
      observer?.disconnect();
      observer = new ResizeObserver(fit);
      observer.observe(doc.body);
    };
    const retheme = () =>
      frame.contentDocument &&
      themeDocument(
        frame.contentDocument,
        document.documentElement.dataset.theme,
      );
    const done = () => setLoaded(true);
    frame.addEventListener("load", attach);
    frame.addEventListener("load", done);
    window.addEventListener(THEME_EVENT, retheme);
    attach();
    return () => {
      frame.removeEventListener("load", attach);
      frame.removeEventListener("load", done);
      window.removeEventListener(THEME_EVENT, retheme);
      observer?.disconnect();
    };
  }, [minHeight, ownTitle]);

  return (
    <div className="embed" data-loading={loaded ? undefined : ""}>
      {!loaded && <Skeleton kind="chart" label={`Loading ${title}…`} />}
      <iframe ref={ref} src={frameSrc} title={title} style={{ height }} allow="fullscreen" />
    </div>
  );
}
