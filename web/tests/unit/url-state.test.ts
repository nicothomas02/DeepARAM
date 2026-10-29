// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { forgetViews, getParam, REMEMBERED, savedView, setParams, VIEW_SCRIPT } from "@/lib/url-state";
import { SETTINGS_KEY } from "@/lib/settings";

// A page's view lives in its address (?tab=, ?sort=, ?patches=), and the Tier List remembers its last view in
// this browser (lib/url-state.ts).
const go = (path: string) => history.replaceState(null, "", path);

describe("page view in the address", () => {
  beforeEach(() => {
    localStorage.clear();
    go("/tier-list");
  });

  it("sets, replaces and removes parameters without adding a Back step", () => {
    const steps = history.length;
    setParams({ tab: "augments", sort: "deepScore.desc" });
    expect(location.search).toBe("?tab=augments&sort=deepScore.desc");
    expect(getParam("tab")).toBe("augments");
    setParams({ sort: null, tab: "" });
    expect(location.search).toBe("");
    expect(getParam("tab")).toBeNull();
    expect(history.length).toBe(steps);
  });

  it("keeps the hash while changing the search", () => {
    go("/tier-list#top");
    setParams({ tab: "duos" });
    expect(location.pathname + location.search + location.hash).toBe("/tier-list?tab=duos#top");
  });

  it("remembers the Tier List's view without its search box, and only the Tier List's", () => {
    setParams({ tab: "augments", q: "ahri", sort: "winRate.asc" });
    expect(savedView("/tier-list")).toBe("?tab=augments&sort=winRate.asc");
    go("/champions");
    setParams({ tab: "x" });
    expect(savedView("/champions")).toBe("");
    expect(REMEMBERED).toContain("/tier-list");
  });

  it("forgets views when the setting is off, and on request", () => {
    setParams({ tab: "augments" });
    expect(savedView("/tier-list")).toBe("?tab=augments");
    forgetViews();
    expect(savedView("/tier-list")).toBe("");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ remember: false }));
    setParams({ tab: "duos" });
    expect(savedView("/tier-list")).toBe("");
    expect(localStorage.getItem("deeparam-view:/tier-list")).toBeNull();
  });
});

describe("before-hydration view script", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reopens a remembered page's saved view on a bare address", () => {
    localStorage.setItem("deeparam-view:/tier-list", "?tab=augments&sort=deepScore.desc");
    go("/tier-list#top");
    new Function(VIEW_SCRIPT)();
    expect(location.pathname + location.search + location.hash).toBe("/tier-list?tab=augments&sort=deepScore.desc#top");
  });

  it("leaves a shared link, another page and a switched-off setting alone, and never throws", () => {
    localStorage.setItem("deeparam-view:/tier-list", "?tab=augments");
    go("/tier-list?tab=duos");
    new Function(VIEW_SCRIPT)();
    expect(location.search).toBe("?tab=duos");
    go("/champions");
    new Function(VIEW_SCRIPT)();
    expect(location.search).toBe("");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ remember: false }));
    go("/tier-list");
    new Function(VIEW_SCRIPT)();
    expect(location.search).toBe("");
    // A saved value that isn't a search string is ignored rather than put in the address.
    localStorage.setItem(SETTINGS_KEY, "{oops");
    localStorage.setItem("deeparam-view:/tier-list", "javascript:1");
    expect(() => new Function(VIEW_SCRIPT)()).not.toThrow();
    expect(location.search).toBe("");
  });
});
